import WebSocket from "ws";
import { createPcm16Resampler } from "../../../packages/ai/src/pcm16-resampler.mjs";
import {
	normalizeTranscriptionLanguage,
	resolveDesktopRealtimeProfile,
} from "../../../packages/ai/src/transcription.mjs";
import { createDesktopRealtimeClientSecret } from "./desktop-realtime-client-secret.mjs";
import { parseDesktopRealtimeTransportEvent } from "./desktop-realtime-events.mjs";
import { logError, logInfo } from "./logger.mjs";

const desktopRealtimeConnectTimeoutMs = 10_000;
const desktopRealtimePendingAudioChunkLimit = 50;
const desktopRealtimeManualCommitIntervalMs = 2_500;
const desktopRealtimeAudioBatchDurationMs = 100;
const desktopRealtimeAudioBatchStatsIntervalMs = 30_000;
const desktopRealtimeOutputSampleRate = 24_000;
const desktopRealtimePcm16BytesPerSample = 2;
const desktopRealtimePcm16BytesPerMillisecond =
	(desktopRealtimeOutputSampleRate * desktopRealtimePcm16BytesPerSample) / 1000;
const desktopRealtimeAudioBatchBytes =
	(desktopRealtimeOutputSampleRate *
		desktopRealtimePcm16BytesPerSample *
		desktopRealtimeAudioBatchDurationMs) /
	1000;
const desktopRealtimeStopFlushTimeoutMs = 1_500;
const desktopRealtimeStopFlushSettleTimeoutMs = 750;

const getPcm16Rms = (base64Pcm16) => {
	const buffer = Buffer.from(base64Pcm16, "base64");

	if (buffer.byteLength < Int16Array.BYTES_PER_ELEMENT) {
		return 0;
	}

	const samples = new Int16Array(
		buffer.buffer,
		buffer.byteOffset,
		Math.floor(buffer.byteLength / Int16Array.BYTES_PER_ELEMENT),
	);
	let sumOfSquares = 0;

	for (const sample of samples) {
		const normalizedSample = sample / 32768;
		sumOfSquares += normalizedSample * normalizedSample;
	}

	return Math.sqrt(sumOfSquares / samples.length);
};

const createAudioDiagnostics = () => ({
	firstAcceptedLogged: false,
	lastRms: 0,
	maxRms: 0,
	nonSilentChunks: 0,
	queuedChunks: 0,
	receivedChunks: 0,
	sentChunks: 0,
});

const createAudioBatchStats = () => ({
	count: 0,
	lastLogTime: Date.now(),
	totalBytes: 0,
});

const getAudioDurationMs = (byteLength) =>
	byteLength / desktopRealtimePcm16BytesPerMillisecond;

const mergeAudioInterval = (currentInterval, nextInterval) => {
	if (!nextInterval) {
		return currentInterval;
	}

	if (!currentInterval) {
		return nextInterval;
	}

	return {
		endedAt: Math.max(currentInterval.endedAt, nextInterval.endedAt),
		startedAt: Math.min(currentInterval.startedAt, nextInterval.startedAt),
	};
};

export const createDesktopRealtimeTransport = ({
	canUseHostedDesktopAi,
	fetchImpl = fetch,
	getCaptureSampleRate,
	getOpenAIApiKey,
	getHostedSiteUrl,
	handleTransportEvent,
	logDesktopTurnDebug,
	subscribeToCaptureEvents,
	WebSocketImpl = WebSocket,
}) => {
	const sessions = new Map();

	const resolveStopFlush = (session) => {
		const stopFlush = session.stopFlush;

		if (!stopFlush) {
			return;
		}

		clearTimeout(stopFlush.timeoutId);
		clearTimeout(stopFlush.settleTimeoutId);
		session.stopFlush = null;
		stopFlush.resolve();
	};

	const settleStopFlush = (session) => {
		const stopFlush = session.stopFlush;

		if (!stopFlush) {
			return;
		}

		clearTimeout(stopFlush.settleTimeoutId);
		stopFlush.settleTimeoutId = setTimeout(() => {
			resolveStopFlush(session);
		}, desktopRealtimeStopFlushSettleTimeoutMs);
	};

	const clearManualCommitTimer = (session) => {
		if (!session.manualCommitTimeoutId) {
			return;
		}

		clearTimeout(session.manualCommitTimeoutId);
		session.manualCommitTimeoutId = null;
	};

	const commitAudioBuffer = (session) => {
		if (
			!session.isClosing &&
			session.socket.readyState === WebSocketImpl.OPEN &&
			session.audioBatch.byteLength > 0
		) {
			flushAudioBatch(session, { force: true });
		}

		if (
			session.isClosing ||
			session.socket.readyState !== WebSocketImpl.OPEN ||
			!session.hasPendingAudioCommit
		) {
			return false;
		}

		session.socket.send(
			JSON.stringify({
				type: "input_audio_buffer.commit",
			}),
		);
		session.inFlightCommitIntervals.push(session.pendingCommitInterval);
		session.pendingCommitInterval = null;
		session.hasPendingAudioCommit = false;
		clearManualCommitTimer(session);

		return true;
	};

	const scheduleManualCommit = (session) => {
		if (
			session.isClosing ||
			session.manualCommitTimeoutId ||
			session.socket.readyState !== WebSocketImpl.OPEN ||
			(!session.hasPendingAudioCommit && session.audioBatch.byteLength === 0)
		) {
			return;
		}

		session.manualCommitTimeoutId = setTimeout(() => {
			session.manualCommitTimeoutId = null;
			commitAudioBuffer(session);
		}, desktopRealtimeManualCommitIntervalMs);
	};

	const notifyStopFlushEvent = (session, transportEvent) => {
		const stopFlush = session?.stopFlush;

		if (!stopFlush || !transportEvent) {
			return;
		}

		if (transportEvent.type === "committed") {
			stopFlush.targetItemId ??= transportEvent.itemId;
			settleStopFlush(session);
			return;
		}

		if (
			(transportEvent.type === "final" ||
				transportEvent.type === "turn_failed") &&
			(!stopFlush.targetItemId ||
				transportEvent.itemId === stopFlush.targetItemId)
		) {
			resolveStopFlush(session);
		}
	};

	const flushOnStop = async (session, getLiveItemId) => {
		if (session.socket.readyState !== WebSocketImpl.OPEN || session.stopFlush) {
			return;
		}

		const targetItemId = getLiveItemId(session.speaker);
		if (!session.hasPendingAudioCommit && session.audioBatch.byteLength === 0) {
			return;
		}

		logInfo({
			message: "[desktop-realtime] flushing transport before stop",
			details: {
				profile: session.profile,
				source: session.source,
				speaker: session.speaker,
				targetItemId,
			},
		});

		await new Promise((resolvePromise) => {
			session.stopFlush = {
				resolve: resolvePromise,
				settleTimeoutId: null,
				targetItemId: null,
				timeoutId: setTimeout(() => {
					resolveStopFlush(session);
				}, desktopRealtimeStopFlushTimeoutMs),
			};

			try {
				flushAudioBatch(session, { force: true });
				session.socket.send(
					JSON.stringify({
						type: "input_audio_buffer.commit",
					}),
				);
				session.inFlightCommitIntervals.push(session.pendingCommitInterval);
				session.pendingCommitInterval = null;
				session.hasPendingAudioCommit = false;
				clearManualCommitTimer(session);
				settleStopFlush(session);
			} catch (error) {
				logError({
					error: {
						message: error instanceof Error ? error.message : String(error),
						profile: session.profile,
						source: session.source,
						speaker: session.speaker,
					},
					message: "[desktop-realtime] failed to flush transport on stop",
				});
				resolveStopFlush(session);
			}
		});
	};

	const stop = async (speaker, { getLiveItemId = () => null } = {}) => {
		const session = sessions.get(speaker);

		if (!session) {
			return { ok: true };
		}

		sessions.delete(speaker);
		clearManualCommitTimer(session);
		clearTimeout(session.openTimeout);
		await flushOnStop(session, getLiveItemId);
		session.unsubscribeCapture?.();
		session.unsubscribeCapture = null;
		session.isClosing = true;

		await new Promise((resolvePromise) => {
			const finalize = () => {
				resolvePromise();
			};

			session.socket.once("close", finalize);
			session.socket.close();

			setTimeout(() => {
				if (session.socket.readyState !== WebSocketImpl.CLOSED) {
					session.socket.terminate();
				}
				finalize();
			}, 1_000);
		});

		return { ok: true };
	};

	const sendAudioChunk = ({ audio, socket }) => {
		socket.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio,
			}),
		);
	};

	const logAudioBatchStatsIfReady = (session) => {
		const now = Date.now();
		const elapsedMs = now - session.audioBatchStats.lastLogTime;
		if (elapsedMs < desktopRealtimeAudioBatchStatsIntervalMs) {
			return;
		}

		if (session.audioBatchStats.count > 0) {
			const avgBytesPerBatch = Math.round(
				session.audioBatchStats.totalBytes / session.audioBatchStats.count,
			);
			logInfo({
				message: "[desktop-realtime] audio batch stats",
				details: {
					avgAudioDurationMsPerBatch: Math.round(
						getAudioDurationMs(avgBytesPerBatch),
					),
					avgBytesPerBatch,
					batchCount: session.audioBatchStats.count,
					intervalMs: elapsedMs,
					profile: session.profile,
					sampleRate: desktopRealtimeOutputSampleRate,
					source: session.source,
					speaker: session.speaker,
					targetAudioDurationMs: desktopRealtimeAudioBatchDurationMs,
					targetBytesPerBatch: desktopRealtimeAudioBatchBytes,
					totalBytes: session.audioBatchStats.totalBytes,
				},
			});
		}

		session.audioBatchStats = createAudioBatchStats();
	};

	const flushAudioBatch = (session, { force = false } = {}) => {
		if (
			session.isClosing ||
			session.socket.readyState !== WebSocketImpl.OPEN ||
			session.audioBatch.byteLength === 0
		) {
			return 0;
		}

		const bytesToSend = force
			? session.audioBatch.byteLength
			: Math.floor(
					session.audioBatch.byteLength / desktopRealtimeAudioBatchBytes,
				) * desktopRealtimeAudioBatchBytes;

		if (bytesToSend === 0) {
			return 0;
		}

		const sentStartedAt = session.audioBatchStartedAt;
		const sentEndedAt =
			force || bytesToSend === session.audioBatch.byteLength
				? session.audioBatchEndedAt
				: sentStartedAt == null
					? null
					: sentStartedAt + getAudioDurationMs(bytesToSend);

		let sentChunks = 0;
		for (
			let offset = 0;
			offset < bytesToSend;
			offset += desktopRealtimeAudioBatchBytes
		) {
			const endOffset = Math.min(
				offset + desktopRealtimeAudioBatchBytes,
				bytesToSend,
			);
			const chunkBytes = endOffset - offset;
			sendAudioChunk({
				audio: session.audioBatch
					.subarray(offset, endOffset)
					.toString("base64"),
				socket: session.socket,
			});
			session.audioBatchStats.count += 1;
			session.audioBatchStats.totalBytes += chunkBytes;
			sentChunks += 1;
		}
		logAudioBatchStatsIfReady(session);

		session.audioBatch = session.audioBatch.subarray(bytesToSend);
		if (sentStartedAt != null && sentEndedAt != null) {
			session.pendingCommitInterval = mergeAudioInterval(
				session.pendingCommitInterval,
				{
					endedAt: sentEndedAt,
					startedAt: sentStartedAt,
				},
			);
		}
		if (session.audioBatch.byteLength === 0) {
			session.audioBatchStartedAt = null;
			session.audioBatchEndedAt = null;
		} else {
			session.audioBatchStartedAt = sentEndedAt;
		}
		session.audioDiagnostics.sentChunks += sentChunks;
		session.hasPendingAudioCommit = true;
		return sentChunks;
	};

	const appendAudioToBatch = (session, { audio, capturedAt }) => {
		const chunk = Buffer.from(audio, "base64");

		if (chunk.byteLength === 0) {
			return 0;
		}

		session.audioBatch =
			session.audioBatch.byteLength === 0
				? chunk
				: Buffer.concat([session.audioBatch, chunk]);
		const chunkEndedAt = capturedAt;
		const chunkStartedAt = chunkEndedAt - getAudioDurationMs(chunk.byteLength);
		session.audioBatchStartedAt ??= chunkStartedAt;
		session.audioBatchEndedAt = chunkEndedAt;

		return flushAudioBatch(session);
	};

	const start = async ({ lang, source, speaker }) => {
		if (process.platform !== "darwin") {
			throw new Error(
				"Desktop realtime transcription transport is only available on macOS.",
			);
		}
		const language = normalizeTranscriptionLanguage(lang);

		if (!getOpenAIApiKey() && !canUseHostedDesktopAi()) {
			throw new Error(
				"Realtime transcription is not configured for this desktop build.",
			);
		}

		const captureSampleRate = getCaptureSampleRate(source);

		if (!captureSampleRate) {
			throw new Error("Desktop audio capture is not active.");
		}

		await stop(speaker);
		const clientSecret = await createDesktopRealtimeClientSecret({
			fetchImpl,
			getHostedSiteUrl,
			getOpenAIApiKey,
			lang,
			source,
			speaker,
		});
		const profile = resolveDesktopRealtimeProfile({
			source,
			speaker,
		});

		return await new Promise((resolvePromise, rejectPromise) => {
			let didResolve = false;
			const resampleChunk = createPcm16Resampler(captureSampleRate, 24_000);
			const socket = new WebSocketImpl(
				"wss://api.openai.com/v1/realtime?intent=transcription",
				{
					headers: {
						Authorization: `Bearer ${clientSecret}`,
					},
				},
			);
			const session = {
				audioBatch: Buffer.alloc(0),
				audioBatchEndedAt: null,
				audioBatchStartedAt: null,
				audioBatchStats: createAudioBatchStats(),
				audioDiagnostics: createAudioDiagnostics(),
				hasPendingAudioCommit: false,
				inFlightCommitIntervals: [],
				isClosing: false,
				manualCommitTimeoutId: null,
				openTimeout: setTimeout(() => {
					if (didResolve) {
						return;
					}

					rejectPromise(
						new Error(
							"Timed out while connecting desktop realtime transcription.",
						),
					);
					socket.terminate();
				}, desktopRealtimeConnectTimeoutMs),
				pendingAudio: [],
				pendingCommitInterval: null,
				profile,
				socket,
				source,
				speaker,
				language,
				startFailed: false,
				unsubscribeCapture: null,
			};

			logDesktopTurnDebug("transport.session_started", {
				language,
				profile,
				source,
				speaker,
			});

			logInfo({
				message: "[desktop-realtime] starting transport",
				details: {
					language,
					profile,
					source,
					speaker,
				},
			});

			const flushPendingAudio = () => {
				if (socket.readyState !== WebSocketImpl.OPEN) {
					return;
				}

				for (const pendingAudio of session.pendingAudio) {
					appendAudioToBatch(session, pendingAudio);
				}
				session.pendingAudio = [];
				scheduleManualCommit(session);
			};

			const finalizeStartError = (error) => {
				session.startFailed = true;
				logError({
					error: {
						didResolve,
						message: error instanceof Error ? error.message : String(error),
						profile,
						source,
						speaker,
					},
					message: "[desktop-realtime] transport start failed",
				});

				if (didResolve) {
					return;
				}

				didResolve = true;
				rejectPromise(error);
			};

			session.unsubscribeCapture = subscribeToCaptureEvents(source, (event) => {
				if (session.isClosing) {
					return;
				}

				if (event.type === "chunk" && event.pcm16) {
					const audio = resampleChunk(event.pcm16);
					const capturedAt =
						typeof event.capturedAt === "number"
							? event.capturedAt
							: Date.now();

					if (!audio) {
						return;
					}

					const rms = getPcm16Rms(audio);
					session.audioDiagnostics.receivedChunks += 1;
					session.audioDiagnostics.lastRms = rms;
					session.audioDiagnostics.maxRms = Math.max(
						session.audioDiagnostics.maxRms,
						rms,
					);
					if (rms >= 0.0001) {
						session.audioDiagnostics.nonSilentChunks += 1;
					}

					if (socket.readyState !== WebSocketImpl.OPEN) {
						session.pendingAudio.push({ audio, capturedAt });
						session.audioDiagnostics.queuedChunks += 1;
						if (
							session.pendingAudio.length >
							desktopRealtimePendingAudioChunkLimit
						) {
							session.pendingAudio.shift();
						}
						return;
					}

					const sentChunks = appendAudioToBatch(session, {
						audio,
						capturedAt,
					});
					if (sentChunks > 0 && !session.audioDiagnostics.firstAcceptedLogged) {
						session.audioDiagnostics.firstAcceptedLogged = true;
						logDesktopTurnDebug("transport.audio_accepted", {
							profile,
							rms,
							source,
							speaker,
						});
					}
					scheduleManualCommit(session);
					return;
				}

				if (event.type === "error" || event.type === "stopped") {
					void handleTransportEvent({
						speaker,
						type: "interrupted",
						message: event.message ?? "Desktop audio capture was interrupted.",
					});
					void stop(speaker);
				}
			});

			sessions.set(speaker, session);

			socket.on("open", () => {
				logDesktopTurnDebug("transport.session_open", {
					language,
					profile,
					source,
					speaker,
				});
				logInfo({
					message: "[desktop-realtime] transport open",
					details: {
						language,
						profile,
						source,
						speaker,
					},
				});
				clearTimeout(session.openTimeout);
				flushPendingAudio();

				if (!didResolve) {
					didResolve = true;
					resolvePromise({
						ok: true,
					});
				}
			});

			socket.on("message", (rawValue) => {
				try {
					const payload = JSON.parse(String(rawValue));

					if (payload?.type === "error" && !didResolve) {
						finalizeStartError(
							new Error(
								payload.error?.message ??
									"Realtime transcription failed during session initialization.",
							),
						);
						return;
					}

					const transportEvent = parseDesktopRealtimeTransportEvent({
						event: payload,
						speaker,
					});

					if (transportEvent) {
						if (transportEvent.type === "committed") {
							const commitInterval =
								session.inFlightCommitIntervals.shift() ?? null;
							if (commitInterval) {
								transportEvent.startedAt = commitInterval.startedAt;
								transportEvent.endedAt = commitInterval.endedAt;
							}
						}
						notifyStopFlushEvent(session, transportEvent);
						void handleTransportEvent(transportEvent);
					}
				} catch (error) {
					logError({
						error: error,
						message: "[desktop-realtime] failed to parse websocket event",
					});
				}
			});

			socket.on("error", (error) => {
				clearTimeout(session.openTimeout);
				logError({
					error: {
						didResolve,
						isClosing: session.isClosing,
						message: error instanceof Error ? error.message : String(error),
						profile,
						socketState: socket.readyState,
						source,
						speaker,
					},
					message: "[desktop-realtime] socket error",
				});
				finalizeStartError(error);
			});

			socket.on("close", (code, reasonBuffer) => {
				clearTimeout(session.openTimeout);
				session.unsubscribeCapture?.();
				session.unsubscribeCapture = null;
				clearManualCommitTimer(session);

				const reason = Buffer.isBuffer(reasonBuffer)
					? reasonBuffer.toString("utf8")
					: String(reasonBuffer ?? "");

				const closeDetails = {
					audioDiagnostics: session.audioDiagnostics,
					code,
					didResolve,
					isClosing: session.isClosing,
					profile,
					reason,
					socketState: socket.readyState,
					source,
					speaker,
				};

				if (session.isClosing) {
					logInfo({
						details: closeDetails,
						event: "socket_close",
						message: "[desktop-realtime] socket close",
					});
				} else {
					logError({
						error: closeDetails,
						message: "[desktop-realtime] socket close",
					});
				}

				if (sessions.get(speaker) === session) {
					sessions.delete(speaker);
				}

				if (!didResolve) {
					finalizeStartError(
						new Error(
							reason || "Realtime transcription connection closed before open.",
						),
					);
					return;
				}

				if (!session.isClosing && !session.startFailed) {
					void handleTransportEvent({
						speaker,
						type: "interrupted",
						message: "Realtime transcription connection was interrupted.",
					});
				}
			});
		});
	};

	return {
		start,
		stop,
	};
};
