import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createAudioDebugRecorder } from "./audio-debug-recorder.mjs";
import { createCombinedAudioCaptureController } from "./combined-audio-capture-session.mjs";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";
import { isHelperStderrError } from "./line-event-helper-session.mjs";
import { logError, logInfo } from "./logger.mjs";

const captureHealthTimeoutMs = 3_000;

export const isLikelySystemAudioPermissionError = (error) => {
	const message = error instanceof Error ? error.message : String(error);
	const normalizedMessage = message.toLowerCase();

	return (
		message.includes("system-audio tap") ||
		normalizedMessage.includes("permission") ||
		normalizedMessage.includes("not authorized") ||
		normalizedMessage.includes("not permitted")
	);
};

const clearCaptureHealthTimeout = (session) => {
	if (session?.healthTimeout) {
		clearTimeout(session.healthTimeout);
		session.healthTimeout = null;
	}
};

const logNativeAudioHelperStderr = ({ label, message }) => {
	if (isHelperStderrError(message)) {
		logError({
			error: message,
			message: `[${label}]`,
		});
		return;
	}

	logInfo({
		details: message,
		event: "native_audio.helper_stderr",
		message: `[${label}]`,
	});
};

export const resolveSystemAudioHelperPath = ({ runtimeDir }) => {
	return resolveDesktopRuntimeExecutablePath({
		envPath: process.env.GRANERI_SYSTEM_AUDIO_HELPER_PATH,
		executableName: "graneri-system-audio-helper",
		runtimeDir,
	});
};

export const resolveMicrophoneHelperPath = ({ runtimeDir }) => {
	return resolveDesktopRuntimeExecutablePath({
		envPath: process.env.GRANERI_MICROPHONE_HELPER_PATH,
		executableName: "graneri-microphone-helper",
		runtimeDir,
	});
};

export const resolveCombinedAudioHelperPath = ({ runtimeDir }) => {
	return resolveDesktopRuntimeExecutablePath({
		envPath: process.env.GRANERI_COMBINED_AUDIO_HELPER_PATH,
		executableName: "graneri-combined-audio-helper",
		runtimeDir,
	});
};

export const createNativeAudioCapture = ({
	audioDebugBaseDir,
	runtimeDir,
	emitMicrophoneCaptureEvent,
	emitSystemAudioCaptureEvent,
	getSystemAudioPermissionState,
	logDesktopTurnDebug,
	markSystemAudioPermissionBlocked,
	markSystemAudioPermissionGranted,
	markSystemAudioPermissionPrompt,
	spawnImpl = nodeSpawn,
}) => {
	let combinedAudioCaptureController;
	let microphoneCaptureSession = null;
	let microphoneCaptureStartRequestId = 0;
	let systemAudioCaptureSession = null;
	let systemAudioCaptureStartRequestId = 0;
	const audioDebugRecorder = createAudioDebugRecorder({
		baseDir: audioDebugBaseDir,
	});

	const stopCombinedAudioCapture = async () =>
		await combinedAudioCaptureController.stop();

	const stopStandaloneMicrophoneCapture = async () => {
		if (!microphoneCaptureSession) {
			return { ok: true };
		}

		const session = microphoneCaptureSession;
		microphoneCaptureSession = null;
		session.isStopping = true;
		if (!session.hasStarted) {
			session.rejectStart?.(
				new Error("macOS microphone capture stopped before it became ready."),
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
		return { ok: true };
	};

	const stopStandaloneSystemAudioCapture = async () => {
		if (!systemAudioCaptureSession) {
			return { ok: true };
		}

		const session = systemAudioCaptureSession;
		systemAudioCaptureSession = null;
		session.isStopping = true;
		if (!session.hasStarted) {
			session.rejectStart?.(
				new Error("macOS system audio capture stopped before it became ready."),
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
		emitSystemAudioCaptureEvent({ type: "stopped" });
		return { ok: true };
	};

	const stopMicrophoneCapture = async () => {
		if (combinedAudioCaptureController.isActive()) {
			return await stopCombinedAudioCapture();
		}

		return await stopStandaloneMicrophoneCapture();
	};

	const stopSystemAudioCapture = async () => {
		if (combinedAudioCaptureController.isActive()) {
			return await stopCombinedAudioCapture();
		}

		return await stopStandaloneSystemAudioCapture();
	};

	combinedAudioCaptureController = createCombinedAudioCaptureController({
		emitMicrophoneCaptureEvent,
		emitSystemAudioCaptureEvent,
		getSystemAudioPermissionState,
		isLikelySystemAudioPermissionError,
		logDesktopTurnDebug,
		logNativeAudioHelperStderr,
		markSystemAudioPermissionBlocked,
		markSystemAudioPermissionGranted,
		markSystemAudioPermissionPrompt,
		audioDebugRecorder,
		resolveHelperPath: () => resolveCombinedAudioHelperPath({ runtimeDir }),
		spawnImpl,
		stopExistingCapture: async () => {
			await Promise.all([
				stopStandaloneMicrophoneCapture(),
				stopStandaloneSystemAudioCapture(),
			]);
		},
	});

	const startCombinedAudioCapture = async () =>
		await combinedAudioCaptureController.start();

	const startMicrophoneCapture = async () => {
		if (process.platform !== "darwin") {
			throw new Error("Native microphone capture is only available on macOS.");
		}

		const helperPath = resolveMicrophoneHelperPath({ runtimeDir });
		if (!helperPath) {
			throw new Error("The macOS microphone helper is missing.");
		}

		logInfo({
			message: "[microphone] starting macOS helper",
			details: { helperPath },
		});

		const requestId = ++microphoneCaptureStartRequestId;
		await stopCombinedAudioCapture();
		await stopStandaloneMicrophoneCapture();

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
				if (requestId !== microphoneCaptureStartRequestId) {
					logInfo({
						message: "[microphone] ignoring stale helper start failure",
						details: {
							requestId,
							currentRequestId: microphoneCaptureStartRequestId,
							message: error instanceof Error ? error.message : String(error),
						},
					});
					return;
				}

				logError({
					error: error instanceof Error ? error.message : error,
					message: "[microphone] helper failed to start",
				});
				if (didResolve) {
					emitMicrophoneCaptureEvent({
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
					return;
				}

				didResolve = true;
				rejectPromise(error);
			};

			const resolveStart = (payload) => {
				if (requestId !== microphoneCaptureStartRequestId) {
					logInfo({
						message: "[microphone] ignoring stale helper ready event",
						details: {
							requestId,
							currentRequestId: microphoneCaptureStartRequestId,
						},
					});
					return;
				}

				if (didResolve) {
					return;
				}

				logInfo({
					message: "[microphone] helper reported ready",
					details: payload,
				});
				session.hasStarted = true;
				logDesktopTurnDebug("microphone.helper_ready", {
					channels: payload?.channels ?? null,
					route:
						payload?.route && typeof payload.route === "object"
							? payload.route
							: null,
					sampleRate: payload?.sampleRate ?? null,
					voiceProcessingDuckingEnabled:
						payload?.voiceProcessingDuckingEnabled === true,
					voiceProcessingDuckingLevel:
						typeof payload?.voiceProcessingDuckingLevel === "string"
							? payload.voiceProcessingDuckingLevel
							: null,
					voiceProcessingEnabled: payload?.voiceProcessingEnabled === true,
					voiceProcessingOutputEnabled:
						payload?.voiceProcessingOutputEnabled === true,
				});
				didResolve = true;
				resolvePromise(payload);
			};

			const cleanupTimeout = setTimeout(() => {
				if (requestId !== microphoneCaptureStartRequestId) {
					logInfo({
						message: "[microphone] cleared stale helper startup timeout",
						details: {
							requestId,
							currentRequestId: microphoneCaptureStartRequestId,
						},
					});
					return;
				}

				logError({
					event: "microphone.helper_startup_timeout",
					message: "[microphone] helper startup timed out after 5000ms",
					startup_timeout_ms: 5_000,
				});
				rejectStart(
					new Error("Timed out while starting macOS microphone capture."),
				);
				child.kill("SIGKILL");
			}, 5_000);

			const resetHealthTimeout = () => {
				if (!session || session.isStopping) {
					return;
				}

				clearCaptureHealthTimeout(session);
				session.healthTimeout = setTimeout(() => {
					if (microphoneCaptureSession !== session || session.isStopping) {
						return;
					}

					const timeoutError = new Error(
						"Timed out while receiving macOS microphone audio frames.",
					);
					logError({
						event: "microphone.helper_audio_timeout",
						message: "[microphone] helper stopped producing audio frames",
					});

					if (didResolve) {
						emitMicrophoneCaptureEvent({
							type: "error",
							message: timeoutError.message,
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
				sampleRate: null,
			};
			microphoneCaptureSession = session;

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				const message = String(chunk).trim();
				if (message) {
					logNativeAudioHelperStderr({
						label: "microphone-helper",
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
						error: error,
						message: "Failed to parse microphone helper event",
						details: line,
					});
					return;
				}

				if (event?.type !== "chunk") {
					logInfo({
						message: "[microphone] helper event",
						details: event?.type ?? "unknown",
					});
				}

				if (event?.type === "ready") {
					clearTimeout(cleanupTimeout);
					session.cleanupTimeout = null;
					session.sampleRate = Number(event.sampleRate) || 48_000;
					resetHealthTimeout();
					resolveStart({
						channels: Number(event.channels) || 1,
						route:
							event?.route && typeof event.route === "object"
								? event.route
								: null,
						sampleRate: session.sampleRate,
						voiceProcessingDuckingEnabled:
							event?.voiceProcessingDuckingEnabled === true,
						voiceProcessingDuckingLevel:
							typeof event?.voiceProcessingDuckingLevel === "string"
								? event.voiceProcessingDuckingLevel
								: null,
						voiceProcessingEnabled: event?.voiceProcessingEnabled === true,
						voiceProcessingMode:
							typeof event?.route?.voiceProcessingMode === "string"
								? event.route.voiceProcessingMode
								: null,
						voiceProcessingOutputEnabled:
							event?.voiceProcessingOutputEnabled === true,
						voiceProcessingRouteAllowed:
							event?.route?.voiceProcessingRouteAllowed === true,
					});
					return;
				}

				if (event?.type === "error") {
					const nextError = new Error(
						typeof event.message === "string"
							? event.message
							: "Microphone capture failed.",
					);
					clearTimeout(cleanupTimeout);
					session.cleanupTimeout = null;
					clearCaptureHealthTimeout(session);
					rejectStart(nextError);
					return;
				}

				if (event?.type === "chunk") {
					resetHealthTimeout();
				}

				emitMicrophoneCaptureEvent(event);
			});

			child.on("error", (error) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (microphoneCaptureSession === session) {
					microphoneCaptureSession = null;
				}
				logError({
					error: error,
					message: "[microphone] helper process error",
				});
				rejectStart(error);
			});

			child.on("exit", (code, signal) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (microphoneCaptureSession === session) {
					microphoneCaptureSession = null;
				}

				logInfo({
					message: "[microphone] helper exited",
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
							`Microphone capture exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
						),
					);
					return;
				}

				if (!session.isStopping) {
					emitMicrophoneCaptureEvent({ type: "stopped", code, signal });
				}
			});
		});
	};

	const startSystemAudioCapture = async () => {
		if (process.platform !== "darwin") {
			throw new Error(
				"Native system audio capture is only available on macOS.",
			);
		}

		const helperPath = resolveSystemAudioHelperPath({ runtimeDir });
		if (!helperPath) {
			throw new Error("The macOS system-audio helper is missing.");
		}

		logInfo({
			message: "[system-audio] starting macOS helper",
			details: { helperPath },
		});

		const requestId = ++systemAudioCaptureStartRequestId;
		await stopCombinedAudioCapture();
		await stopStandaloneSystemAudioCapture();

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
				if (requestId !== systemAudioCaptureStartRequestId) {
					logInfo({
						message: "[system-audio] ignoring stale helper start failure",
						details: {
							requestId,
							currentRequestId: systemAudioCaptureStartRequestId,
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
					message: "[system-audio] helper failed to start",
				});
				if (didResolve) {
					emitSystemAudioCaptureEvent({
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
					return;
				}

				didResolve = true;
				rejectPromise(error);
			};

			const resolveStart = (payload) => {
				if (requestId !== systemAudioCaptureStartRequestId) {
					logInfo({
						message: "[system-audio] ignoring stale helper ready event",
						details: {
							requestId,
							currentRequestId: systemAudioCaptureStartRequestId,
						},
					});
					return;
				}

				if (didResolve) {
					return;
				}

				logInfo({
					message: "[system-audio] helper reported ready",
					details: payload,
				});
				markSystemAudioPermissionGranted();
				session.hasStarted = true;
				didResolve = true;
				resolvePromise(payload);
			};

			const cleanupTimeout = setTimeout(() => {
				if (requestId !== systemAudioCaptureStartRequestId) {
					logInfo({
						message: "[system-audio] cleared stale helper startup timeout",
						details: {
							requestId,
							currentRequestId: systemAudioCaptureStartRequestId,
						},
					});
					return;
				}

				logError({
					event: "system_audio.helper_startup_timeout",
					message: "[system-audio] helper startup timed out after 5000ms",
					startup_timeout_ms: 5_000,
				});
				rejectStart(
					new Error("Timed out while starting macOS system audio capture."),
				);
				child.kill("SIGKILL");
			}, 5_000);

			const resetHealthTimeout = () => {
				if (!session || session.isStopping) {
					return;
				}

				clearCaptureHealthTimeout(session);
				session.healthTimeout = setTimeout(() => {
					if (systemAudioCaptureSession !== session || session.isStopping) {
						return;
					}

					const timeoutError = new Error(
						"Timed out while receiving macOS system audio frames.",
					);
					logError({
						event: "system_audio.helper_audio_timeout",
						message: "[system-audio] helper stopped producing audio frames",
					});

					if (didResolve) {
						emitSystemAudioCaptureEvent({
							type: "error",
							message: timeoutError.message,
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
				sampleRate: null,
			};
			systemAudioCaptureSession = session;

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				const message = String(chunk).trim();
				if (message) {
					logNativeAudioHelperStderr({
						label: "system-audio-helper",
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
						error: error,
						message: "Failed to parse system audio helper event",
						details: line,
					});
					return;
				}

				if (event?.type !== "chunk") {
					logInfo({
						message: "[system-audio] helper event",
						details: event?.type ?? "unknown",
					});
				}

				if (event?.type === "ready") {
					clearTimeout(cleanupTimeout);
					session.cleanupTimeout = null;
					session.sampleRate = Number(event.sampleRate) || 48_000;
					resetHealthTimeout();
					resolveStart({
						channels: Number(event.channels) || 1,
						sampleRate: session.sampleRate,
					});
					return;
				}

				if (event?.type === "error") {
					const nextError = new Error(
						typeof event.message === "string"
							? event.message
							: "System audio capture failed.",
					);
					clearTimeout(cleanupTimeout);
					session.cleanupTimeout = null;
					clearCaptureHealthTimeout(session);
					rejectStart(nextError);
					return;
				}

				if (event?.type === "chunk") {
					resetHealthTimeout();
				}

				emitSystemAudioCaptureEvent(event);
			});

			child.on("error", (error) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (systemAudioCaptureSession === session) {
					systemAudioCaptureSession = null;
				}
				logError({
					error: error,
					message: "[system-audio] helper process error",
				});
				rejectStart(error);
			});

			child.on("exit", (code, signal) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (systemAudioCaptureSession === session) {
					systemAudioCaptureSession = null;
				}

				logInfo({
					message: "[system-audio] helper exited",
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
							`System audio capture exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
						),
					);
					return;
				}

				if (!session.isStopping) {
					emitSystemAudioCaptureEvent({ type: "stopped", code, signal });
				}
			});
		});
	};

	return {
		getCaptureSampleRate: (source) => {
			const combinedSampleRate =
				combinedAudioCaptureController.getSampleRate(source);
			if (combinedSampleRate) {
				return combinedSampleRate;
			}

			const session =
				source === "microphone"
					? microphoneCaptureSession
					: systemAudioCaptureSession;
			return session?.sampleRate ?? null;
		},
		resolveCombinedAudioHelperPath: () =>
			resolveCombinedAudioHelperPath({ runtimeDir }),
		resolveMicrophoneHelperPath: () =>
			resolveMicrophoneHelperPath({ runtimeDir }),
		resolveSystemAudioHelperPath: () =>
			resolveSystemAudioHelperPath({ runtimeDir }),
		startCombinedAudioCapture,
		startMicrophoneCapture,
		startSystemAudioCapture,
		stopCombinedAudioCapture,
		stopMicrophoneCapture,
		stopSystemAudioCapture,
	};
};
