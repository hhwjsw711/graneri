import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";

const captureHealthTimeoutMs = 3_000;

const isLikelySystemAudioPermissionError = (error) => {
	const message = error instanceof Error ? error.message : String(error);

	return (
		message.includes("system-audio tap") ||
		message.includes("System audio capture exited before it became ready") ||
		message.includes("Timed out while starting macOS system audio capture")
	);
};

const clearCaptureHealthTimeout = (session) => {
	if (session?.healthTimeout) {
		clearTimeout(session.healthTimeout);
		session.healthTimeout = null;
	}
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

export const createNativeAudioCapture = ({
	runtimeDir,
	emitMicrophoneCaptureEvent,
	emitSystemAudioCaptureEvent,
	getSystemAudioPermissionState,
	logDesktopTurnDebug,
	markSystemAudioPermissionBlocked,
	markSystemAudioPermissionGranted,
	markSystemAudioPermissionPrompt,
}) => {
	let microphoneCaptureSession = null;
	let microphoneCaptureStartRequestId = 0;
	let systemAudioCaptureSession = null;
	let systemAudioCaptureStartRequestId = 0;

	const stopMicrophoneCapture = async () => {
		if (!microphoneCaptureSession) {
			return { ok: true };
		}

		const session = microphoneCaptureSession;
		microphoneCaptureSession = null;
		session.isStopping = true;
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

	const stopSystemAudioCapture = async () => {
		if (!systemAudioCaptureSession) {
			return { ok: true };
		}

		const session = systemAudioCaptureSession;
		systemAudioCaptureSession = null;
		session.isStopping = true;
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

	const startMicrophoneCapture = async () => {
		if (process.platform !== "darwin") {
			throw new Error("Native microphone capture is only available on macOS.");
		}

		const helperPath = resolveMicrophoneHelperPath({ runtimeDir });
		if (!helperPath) {
			throw new Error("The macOS microphone helper is missing.");
		}

		console.info("[microphone] starting macOS helper", { helperPath });

		const requestId = ++microphoneCaptureStartRequestId;
		await stopMicrophoneCapture();

		return await new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(helperPath, [], {
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
					console.info("[microphone] ignoring stale helper start failure", {
						requestId,
						currentRequestId: microphoneCaptureStartRequestId,
						message: error instanceof Error ? error.message : String(error),
					});
					return;
				}

				console.error(
					"[microphone] helper failed to start",
					error instanceof Error ? error.message : error,
				);
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
					console.info("[microphone] ignoring stale helper ready event", {
						requestId,
						currentRequestId: microphoneCaptureStartRequestId,
					});
					return;
				}

				if (didResolve) {
					return;
				}

				console.info("[microphone] helper reported ready", payload);
				logDesktopTurnDebug("microphone.helper_ready", {
					channels: payload?.channels ?? null,
					route:
						payload?.route && typeof payload.route === "object"
							? payload.route
							: null,
					sampleRate: payload?.sampleRate ?? null,
					voiceProcessingEnabled: payload?.voiceProcessingEnabled === true,
					voiceProcessingOutputEnabled:
						payload?.voiceProcessingOutputEnabled === true,
				});
				didResolve = true;
				resolvePromise(payload);
			};

			const cleanupTimeout = setTimeout(() => {
				if (requestId !== microphoneCaptureStartRequestId) {
					console.info("[microphone] cleared stale helper startup timeout", {
						requestId,
						currentRequestId: microphoneCaptureStartRequestId,
					});
					return;
				}

				console.error("[microphone] helper startup timed out after 5000ms");
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
					console.error("[microphone] helper stopped producing audio frames");

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
				lineReader,
				process: child,
				requestId,
				sampleRate: null,
			};
			microphoneCaptureSession = session;

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				const message = String(chunk).trim();
				if (message) {
					console.error("[microphone-helper]", message);
				}
			});

			lineReader.on("line", (line) => {
				let event;

				try {
					event = JSON.parse(line);
				} catch (error) {
					console.error("Failed to parse microphone helper event", error, line);
					return;
				}

				if (event?.type !== "chunk") {
					console.info("[microphone] helper event", event?.type ?? "unknown");
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
						voiceProcessingEnabled: event?.voiceProcessingEnabled === true,
						voiceProcessingOutputEnabled:
							event?.voiceProcessingOutputEnabled === true,
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
				console.error("[microphone] helper process error", error);
				rejectStart(error);
			});

			child.on("exit", (code, signal) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (microphoneCaptureSession === session) {
					microphoneCaptureSession = null;
				}

				console.info("[microphone] helper exited", {
					code,
					signal,
					didResolve,
					isStopping: session.isStopping,
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

		console.info("[system-audio] starting macOS helper", { helperPath });

		const requestId = ++systemAudioCaptureStartRequestId;
		await stopSystemAudioCapture();

		return await new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(helperPath, [], {
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
					console.info("[system-audio] ignoring stale helper start failure", {
						requestId,
						currentRequestId: systemAudioCaptureStartRequestId,
						message: error instanceof Error ? error.message : String(error),
					});
					return;
				}

				if (isLikelySystemAudioPermissionError(error)) {
					markSystemAudioPermissionBlocked();
				} else if (getSystemAudioPermissionState() !== "granted") {
					markSystemAudioPermissionPrompt();
				}

				console.error(
					"[system-audio] helper failed to start",
					error instanceof Error ? error.message : error,
				);
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
					console.info("[system-audio] ignoring stale helper ready event", {
						requestId,
						currentRequestId: systemAudioCaptureStartRequestId,
					});
					return;
				}

				if (didResolve) {
					return;
				}

				console.info("[system-audio] helper reported ready", payload);
				markSystemAudioPermissionGranted();
				didResolve = true;
				resolvePromise(payload);
			};

			const cleanupTimeout = setTimeout(() => {
				if (requestId !== systemAudioCaptureStartRequestId) {
					console.info("[system-audio] cleared stale helper startup timeout", {
						requestId,
						currentRequestId: systemAudioCaptureStartRequestId,
					});
					return;
				}

				console.error("[system-audio] helper startup timed out after 5000ms");
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
					console.error("[system-audio] helper stopped producing audio frames");

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
				lineReader,
				process: child,
				requestId,
				sampleRate: null,
			};
			systemAudioCaptureSession = session;

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				const message = String(chunk).trim();
				if (message) {
					console.error("[system-audio-helper]", message);
				}
			});

			lineReader.on("line", (line) => {
				let event;

				try {
					event = JSON.parse(line);
				} catch (error) {
					console.error(
						"Failed to parse system audio helper event",
						error,
						line,
					);
					return;
				}

				if (event?.type !== "chunk") {
					console.info("[system-audio] helper event", event?.type ?? "unknown");
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
				console.error("[system-audio] helper process error", error);
				rejectStart(error);
			});

			child.on("exit", (code, signal) => {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				if (systemAudioCaptureSession === session) {
					systemAudioCaptureSession = null;
				}

				console.info("[system-audio] helper exited", {
					code,
					signal,
					didResolve,
					isStopping: session.isStopping,
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
			const session =
				source === "microphone"
					? microphoneCaptureSession
					: systemAudioCaptureSession;
			return session?.sampleRate ?? null;
		},
		resolveMicrophoneHelperPath: () =>
			resolveMicrophoneHelperPath({ runtimeDir }),
		resolveSystemAudioHelperPath: () =>
			resolveSystemAudioHelperPath({ runtimeDir }),
		startMicrophoneCapture,
		startSystemAudioCapture,
		stopMicrophoneCapture,
		stopSystemAudioCapture,
	};
};
