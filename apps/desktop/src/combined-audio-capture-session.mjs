import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { logError, logInfo } from "./logger.mjs";

const captureHealthTimeoutMs = 3_000;
const combinedAudioInterruptionReason = "combined_audio_interrupted";

const clearCaptureHealthTimeout = (session) => {
	if (session?.healthTimeout) {
		clearTimeout(session.healthTimeout);
		session.healthTimeout = null;
	}
};

const normalizeReadyEvent = ({ event, session }) => ({
	audioProcessing:
		event?.audioProcessing && typeof event.audioProcessing === "object"
			? event.audioProcessing
			: null,
	microphone: {
		channels: Number(event?.microphone?.channels) || 1,
		route:
			event?.microphone?.route && typeof event.microphone.route === "object"
				? event.microphone.route
				: null,
		sampleRate: session.sampleRates.microphone,
		voiceProcessingDuckingEnabled:
			event?.microphone?.voiceProcessingDuckingEnabled === true,
		voiceProcessingDuckingLevel:
			typeof event?.microphone?.voiceProcessingDuckingLevel === "string"
				? event.microphone.voiceProcessingDuckingLevel
				: null,
		voiceProcessingEnabled: event?.microphone?.voiceProcessingEnabled === true,
		voiceProcessingMode:
			typeof event?.microphone?.route?.voiceProcessingMode === "string"
				? event.microphone.route.voiceProcessingMode
				: null,
		voiceProcessingOutputEnabled:
			event?.microphone?.voiceProcessingOutputEnabled === true,
		voiceProcessingRouteAllowed:
			event?.microphone?.route?.voiceProcessingRouteAllowed === true,
	},
	systemAudio: {
		channels: Number(event?.systemAudio?.channels) || 1,
		sampleRate: session.sampleRates.systemAudio,
	},
});

export const createCombinedAudioCaptureController = ({
	emitMicrophoneCaptureEvent,
	emitSystemAudioCaptureEvent,
	getSystemAudioPermissionState,
	isLikelySystemAudioPermissionError,
	logDesktopTurnDebug,
	logNativeAudioHelperStderr,
	markSystemAudioPermissionBlocked,
	markSystemAudioPermissionGranted,
	markSystemAudioPermissionPrompt,
	resolveHelperPath,
	spawnImpl = nodeSpawn,
	stopExistingCapture,
}) => {
	let activeSession = null;
	let startRequestId = 0;

	const stop = async () => {
		if (!activeSession) {
			return { ok: true };
		}

		const session = activeSession;
		activeSession = null;
		session.isStopping = true;
		if (!session.hasStarted) {
			session.rejectStart?.(
				new Error(
					"macOS combined audio capture stopped before it became ready.",
				),
			);
		}
		clearTimeout(session.cleanupTimeout);
		session.cleanupTimeout = null;
		clearCaptureHealthTimeout(session);

		await new Promise((resolvePromise) => {
			const finish = () => resolvePromise();
			session.process.once("exit", finish);
			session.process.once("error", finish);
			session.process.kill("SIGTERM");
			setTimeout(() => {
				if (!session.process.killed) {
					session.process.kill("SIGKILL");
				}
				resolvePromise();
			}, 1_000);
		});

		session.lineReader.close();
		emitMicrophoneCaptureEvent({ type: "stopped" });
		emitSystemAudioCaptureEvent({ type: "stopped" });
		return { ok: true };
	};

	const start = async () => {
		if (process.platform !== "darwin") {
			throw new Error(
				"Native combined audio capture is only available on macOS.",
			);
		}

		const helperPath = resolveHelperPath();
		if (!helperPath) {
			throw new Error("The macOS combined audio helper is missing.");
		}

		logInfo({
			message: "[combined-audio] starting macOS helper",
			details: { helperPath },
		});

		const requestId = ++startRequestId;
		await stopExistingCapture();
		await stop();

		return await new Promise((resolvePromise, rejectPromise) => {
			const child = spawnImpl(helperPath, [], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			const lineReader = createInterface({
				input: child.stdout,
				crlfDelay: Infinity,
			});
			let didResolve = false;
			let session;

			const rejectStart = (error) => {
				if (requestId !== startRequestId) {
					logInfo({
						message: "[combined-audio] ignoring stale helper start failure",
						details: {
							requestId,
							currentRequestId: startRequestId,
							message: error instanceof Error ? error.message : String(error),
						},
					});
					return;
				}

				if (isLikelySystemAudioPermissionError(error)) {
					markSystemAudioPermissionBlocked();
				} else if (getSystemAudioPermissionState() !== "granted") {
					markSystemAudioPermissionPrompt();
				}

				logError({
					error: error instanceof Error ? error.message : error,
					message: "[combined-audio] helper failed to start",
				});
				if (didResolve) {
					const message =
						error instanceof Error ? error.message : String(error);
					emitMicrophoneCaptureEvent({
						type: "error",
						message,
						reason: combinedAudioInterruptionReason,
					});
					emitSystemAudioCaptureEvent({
						type: "error",
						message,
						reason: combinedAudioInterruptionReason,
					});
					return;
				}

				didResolve = true;
				rejectPromise(error);
			};

			const resolveStart = (payload) => {
				if (requestId !== startRequestId) {
					logInfo({
						message: "[combined-audio] ignoring stale helper ready event",
						details: {
							requestId,
							currentRequestId: startRequestId,
						},
					});
					return;
				}

				if (didResolve) {
					return;
				}

				logInfo({
					message: "[combined-audio] helper reported ready",
					details: payload,
				});
				session.hasStarted = true;
				logDesktopTurnDebug("combined_audio.helper_ready", {
					audioProcessing: payload?.audioProcessing ?? null,
					microphone: payload?.microphone ?? null,
					systemAudio: payload?.systemAudio ?? null,
				});
				markSystemAudioPermissionGranted();
				didResolve = true;
				resolvePromise(payload);
			};

			const cleanupTimeout = setTimeout(() => {
				if (requestId !== startRequestId) {
					logInfo({
						message: "[combined-audio] cleared stale helper startup timeout",
						details: {
							requestId,
							currentRequestId: startRequestId,
						},
					});
					return;
				}

				logError({
					event: "combined_audio.helper_startup_timeout",
					message: "[combined-audio] helper startup timed out after 5000ms",
					startup_timeout_ms: 5_000,
				});
				rejectStart(
					new Error("Timed out while starting macOS combined audio capture."),
				);
				child.kill("SIGKILL");
			}, 5_000);

			const resetHealthTimeout = () => {
				if (!session || session.isStopping) {
					return;
				}

				clearCaptureHealthTimeout(session);
				session.healthTimeout = setTimeout(() => {
					if (activeSession !== session || session.isStopping) {
						return;
					}

					const timeoutError = new Error(
						"Timed out while receiving macOS combined audio frames.",
					);
					logError({
						event: "combined_audio.helper_audio_timeout",
						message: "[combined-audio] helper stopped producing audio frames",
					});

					if (didResolve) {
						emitMicrophoneCaptureEvent({
							type: "error",
							message: timeoutError.message,
							reason: combinedAudioInterruptionReason,
						});
						emitSystemAudioCaptureEvent({
							type: "error",
							message: timeoutError.message,
							reason: combinedAudioInterruptionReason,
						});
					} else {
						rejectStart(timeoutError);
					}

					child.kill("SIGKILL");
				}, captureHealthTimeoutMs);
			};

			session = {
				isStopping: false,
				cleanupTimeout,
				healthTimeout: null,
				hasStarted: false,
				lineReader,
				process: child,
				rejectStart,
				requestId,
				sampleRates: {
					microphone: null,
					systemAudio: null,
				},
				sourceChunkCounts: {
					microphone: 0,
					systemAudio: 0,
				},
			};
			activeSession = session;

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				const message = String(chunk).trim();
				if (message) {
					logNativeAudioHelperStderr({
						label: "combined-audio-helper",
						message,
					});
				}
			});

			lineReader.on("line", (line) => {
				let event;

				try {
					event = JSON.parse(line);
				} catch (error) {
					logError({
						error,
						message: "Failed to parse combined audio helper event",
						details: line,
					});
					return;
				}

				if (event?.type !== "chunk") {
					logInfo({
						message: "[combined-audio] helper event",
						details: event?.type ?? "unknown",
					});
				}

				if (event?.type === "ready") {
					clearTimeout(cleanupTimeout);
					session.cleanupTimeout = null;
					session.sampleRates.microphone =
						Number(event?.microphone?.sampleRate) || 48_000;
					session.sampleRates.systemAudio =
						Number(event?.systemAudio?.sampleRate) || 48_000;
					resetHealthTimeout();
					resolveStart(normalizeReadyEvent({ event, session }));
					return;
				}

				if (event?.type === "error") {
					const nextError = new Error(
						typeof event.message === "string"
							? event.message
							: "Combined audio capture failed.",
					);
					clearTimeout(cleanupTimeout);
					session.cleanupTimeout = null;
					clearCaptureHealthTimeout(session);
					rejectStart(nextError);
					return;
				}

				if (event?.type === "processing_diagnostics") {
					logDesktopTurnDebug("combined_audio.processing_diagnostics", {
						audioProcessing: event,
						requestId,
					});
					return;
				}

				if (event?.type === "chunk") {
					resetHealthTimeout();
					if (event.source === "microphone") {
						session.sourceChunkCounts.microphone += 1;
						if (session.sourceChunkCounts.microphone === 1) {
							logDesktopTurnDebug("combined_audio.source_chunk_started", {
								pcm16Length:
									typeof event.pcm16 === "string" ? event.pcm16.length : 0,
								requestId,
								sampleRate: session.sampleRates.microphone,
								source: "microphone",
							});
						}
						emitMicrophoneCaptureEvent({
							...(typeof event.capturedAt === "number"
								? { capturedAt: event.capturedAt }
								: {}),
							pcm16: event.pcm16,
							type: "chunk",
						});
						return;
					}

					if (event.source === "systemAudio") {
						session.sourceChunkCounts.systemAudio += 1;
						if (session.sourceChunkCounts.systemAudio === 1) {
							logDesktopTurnDebug("combined_audio.source_chunk_started", {
								pcm16Length:
									typeof event.pcm16 === "string" ? event.pcm16.length : 0,
								requestId,
								sampleRate: session.sampleRates.systemAudio,
								source: "systemAudio",
							});
						}
						emitSystemAudioCaptureEvent({
							...(typeof event.capturedAt === "number"
								? { capturedAt: event.capturedAt }
								: {}),
							pcm16: event.pcm16,
							type: "chunk",
						});
						return;
					}

					logError({
						error: event,
						message:
							"[combined-audio] helper emitted chunk without a supported source",
					});
					return;
				}

				emitMicrophoneCaptureEvent(event);
				emitSystemAudioCaptureEvent(event);
			});

			child.on("error", (error) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (activeSession === session) {
					activeSession = null;
				}
				logError({
					error,
					message: "[combined-audio] helper process error",
				});
				rejectStart(error);
			});

			child.on("exit", (code, signal) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (activeSession === session) {
					activeSession = null;
				}

				logInfo({
					message: "[combined-audio] helper exited",
					details: {
						code,
						signal,
						didResolve,
						isStopping: session.isStopping,
					},
				});

				if (!session.isStopping && !didResolve) {
					rejectStart(
						new Error(
							`Combined audio capture exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
						),
					);
					return;
				}

				if (!session.isStopping) {
					emitMicrophoneCaptureEvent({
						type: "stopped",
						code,
						reason: combinedAudioInterruptionReason,
						signal,
					});
					emitSystemAudioCaptureEvent({
						type: "stopped",
						code,
						reason: combinedAudioInterruptionReason,
						signal,
					});
				}
			});
		});
	};

	return {
		getSampleRate: (source) => activeSession?.sampleRates?.[source] ?? null,
		isActive: () => activeSession !== null,
		start,
		stop,
	};
};
