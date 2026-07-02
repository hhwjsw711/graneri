import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createAudioVolumeStats } from "./audio-volume-stats.mjs";
import { logError, logInfo } from "./logger.mjs";

const captureHealthTimeoutMs = 3_000;
const combinedAudioInterruptionReason = "combined_audio_interrupted";
const maxHelperRestartAttempts = 20;
const helperRestartCounterResetMs = 5 * 60 * 1_000;

const clearCaptureHealthTimeout = (session) => {
	if (session?.healthTimeout) {
		clearTimeout(session.healthTimeout);
		session.healthTimeout = null;
	}
};

const clearHelperRestartResetTimeout = (session) => {
	if (session?.restartResetTimeout) {
		clearTimeout(session.restartResetTimeout);
		session.restartResetTimeout = null;
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
	audioDebugRecorder,
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
		clearHelperRestartResetTimeout(session);
		audioDebugRecorder.stop();

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

		const requestId = ++startRequestId;
		await stopExistingCapture();
		await stop();

		return await new Promise((resolvePromise, rejectPromise) => {
			const audioVolumeStats = createAudioVolumeStats();
			let didResolve = false;
			let didStartDebugRecorder = false;
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
				audioDebugRecorder.stop();
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
				if (activeSession === session) {
					activeSession = null;
				}
				clearCaptureHealthTimeout(session);
				clearHelperRestartResetTimeout(session);
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
				if (!didStartDebugRecorder) {
					didStartDebugRecorder = true;
					void audioDebugRecorder.cleanupExpiredFiles();
					session.audioDebugStartPromise = audioDebugRecorder
						.start({
							microphoneSampleRate: session.sampleRates.microphone,
							systemAudioSampleRate: session.sampleRates.systemAudio,
						})
						.catch((error) => {
							logError({
								error,
								message:
									"[combined-audio] failed to start audio debug recorder",
							});
						});
				}
				didResolve = true;
				resolvePromise(payload);
			};

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

					if (!didResolve) {
						rejectStart(timeoutError);
					}

					session.process?.kill("SIGKILL");
				}, captureHealthTimeoutMs);
			};

			session = {
				isStopping: false,
				cleanupTimeout: null,
				healthTimeout: null,
				hasStarted: false,
				lineReader: null,
				process: null,
				rejectStart,
				restartAttempts: 0,
				restartResetTimeout: null,
				requestId,
				sampleRates: {
					microphone: null,
					systemAudio: null,
				},
				sourceChunkCounts: {
					microphone: 0,
					systemAudio: 0,
				},
				audioDebugStartPromise: null,
			};
			activeSession = session;

			const emitFinalInterruption = ({ code, signal }) => {
				audioDebugRecorder.stop();
				clearHelperRestartResetTimeout(session);
				if (activeSession === session) {
					activeSession = null;
				}
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
			};

			const scheduleRestartCounterReset = () => {
				clearHelperRestartResetTimeout(session);
				session.restartResetTimeout = setTimeout(() => {
					if (activeSession !== session || session.isStopping) {
						return;
					}
					if (session.restartAttempts > 0) {
						logInfo({
							message: "[combined-audio] helper restart counter reset",
							details: {
								restartAttempts: session.restartAttempts,
							},
						});
					}
					session.restartAttempts = 0;
					session.restartResetTimeout = null;
				}, helperRestartCounterResetMs);
			};

			const handleLine = (line) => {
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
					clearTimeout(session.cleanupTimeout);
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
					clearTimeout(session.cleanupTimeout);
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
					const microphonePcm16 =
						typeof event.microphonePcm16 === "string"
							? event.microphonePcm16
							: null;
					const systemAudioPcm16 =
						typeof event.systemAudioPcm16 === "string"
							? event.systemAudioPcm16
							: null;
					const capturedAt =
						typeof event.capturedAt === "number" ? event.capturedAt : undefined;
					audioVolumeStats.update({
						microphonePcm16,
						systemAudioPcm16,
					});
					audioVolumeStats.logIfReady((details) => {
						logInfo({
							message: "[combined-audio] volume stats",
							details,
						});
					});

					const appendAudioDebugChunk = () => {
						if (activeSession !== session || session.isStopping) {
							return;
						}

						audioDebugRecorder.append({
							microphonePcm16,
							systemAudioPcm16,
						});
					};
					if (session.audioDebugStartPromise) {
						void session.audioDebugStartPromise.then(appendAudioDebugChunk);
					} else {
						appendAudioDebugChunk();
					}

					if (microphonePcm16) {
						session.sourceChunkCounts.microphone += 1;
						if (session.sourceChunkCounts.microphone === 1) {
							logDesktopTurnDebug("combined_audio.source_chunk_started", {
								pcm16Length: microphonePcm16.length,
								requestId,
								sampleRate: session.sampleRates.microphone,
								source: "microphone",
							});
						}
						emitMicrophoneCaptureEvent({
							...(capturedAt !== undefined ? { capturedAt } : {}),
							pcm16: microphonePcm16,
							type: "chunk",
						});
					}

					if (systemAudioPcm16) {
						session.sourceChunkCounts.systemAudio += 1;
						if (session.sourceChunkCounts.systemAudio === 1) {
							logDesktopTurnDebug("combined_audio.source_chunk_started", {
								pcm16Length: systemAudioPcm16.length,
								requestId,
								sampleRate: session.sampleRates.systemAudio,
								source: "systemAudio",
							});
						}
						emitSystemAudioCaptureEvent({
							...(capturedAt !== undefined ? { capturedAt } : {}),
							pcm16: systemAudioPcm16,
							type: "chunk",
						});
					}

					if (!microphonePcm16 && !systemAudioPcm16) {
						logError({
							error: event,
							message:
								"[combined-audio] helper emitted paired chunk without audio",
						});
					}
					return;
				}

				emitMicrophoneCaptureEvent(event);
				emitSystemAudioCaptureEvent(event);
			};

			const spawnHelper = ({ reason }) => {
				if (activeSession !== session || session.isStopping) {
					return;
				}

				logInfo({
					message: "[combined-audio] starting macOS helper",
					details: {
						helperPath,
						reason,
						restartAttempts: session.restartAttempts,
					},
				});

				const child = spawnImpl(helperPath, [], {
					stdio: ["ignore", "pipe", "pipe"],
				});
				const lineReader = createInterface({
					input: child.stdout,
					crlfDelay: Infinity,
				});

				session.process = child;
				session.lineReader = lineReader;
				session.cleanupTimeout = setTimeout(() => {
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

					const timeoutError = new Error(
						"Timed out while starting macOS combined audio capture.",
					);
					logError({
						event: "combined_audio.helper_startup_timeout",
						message: "[combined-audio] helper startup timed out after 5000ms",
						restartAttempts: session.restartAttempts,
						startup_timeout_ms: 5_000,
					});
					if (!didResolve) {
						rejectStart(timeoutError);
					}
					child.kill("SIGKILL");
				}, 5_000);

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

				lineReader.on("line", handleLine);

				child.on("error", (error) => {
					clearTimeout(session.cleanupTimeout);
					session.cleanupTimeout = null;
					clearCaptureHealthTimeout(session);
					logError({
						error,
						message: "[combined-audio] helper process error",
					});
					if (!didResolve) {
						rejectStart(error);
						return;
					}
					child.kill("SIGKILL");
				});

				child.on("exit", (code, signal) => {
					clearTimeout(session.cleanupTimeout);
					session.cleanupTimeout = null;
					clearCaptureHealthTimeout(session);
					lineReader.close();
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
						if (activeSession === session) {
							activeSession = null;
						}
						rejectStart(
							new Error(
								`Combined audio capture exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
							),
						);
						return;
					}

					if (!session.isStopping) {
						if (session.restartAttempts < maxHelperRestartAttempts) {
							session.restartAttempts += 1;
							logError({
								error: {
									code,
									restartAttempts: session.restartAttempts,
									signal,
								},
								message:
									"[combined-audio] helper exited unexpectedly; restarting",
							});
							scheduleRestartCounterReset();
							spawnHelper({ reason: "restart" });
							return;
						}

						logError({
							error: {
								code,
								maxHelperRestartAttempts,
								signal,
							},
							message: "[combined-audio] helper restart limit reached",
						});
						emitFinalInterruption({
							code,
							signal,
						});
					}
				});
			};

			spawnHelper({ reason: "start" });
		});
	};

	return {
		getSampleRate: (source) => activeSession?.sampleRates?.[source] ?? null,
		isActive: () => activeSession !== null,
		start,
		stop,
	};
};
