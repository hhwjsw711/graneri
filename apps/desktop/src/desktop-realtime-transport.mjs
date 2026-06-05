import WebSocket from "ws";
import { createPcm16Resampler } from "../../../packages/ai/src/pcm16-resampler.mjs";
import {
	normalizeTranscriptionLanguage,
	resolveDesktopRealtimeProfile,
} from "../../../packages/ai/src/transcription.mjs";
import { createDesktopRealtimeClientSecret } from "./desktop-realtime-client-secret.mjs";
import { parseDesktopRealtimeTransportEvent } from "./desktop-realtime-events.mjs";

const desktopRealtimeConnectTimeoutMs = 10_000;
const desktopRealtimePendingAudioChunkLimit = 50;
const desktopRealtimeStopFlushTimeoutMs = 1_500;
const desktopRealtimeStopFlushSettleTimeoutMs = 750;

export const createDesktopRealtimeTransport = ({
	canUseHostedDesktopAi,
	fetchImpl = fetch,
	getCaptureSampleRate,
	getOpenAIApiKey,
	getHostedConvexSiteUrl,
	handleTransportEvent,
	logDesktopTurnDebug,
	subscribeToCaptureEvents,
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
		if (session.socket.readyState !== WebSocket.OPEN || session.stopFlush) {
			return;
		}

		const targetItemId = getLiveItemId(session.speaker);

		console.info("[desktop-realtime] flushing transport before stop", {
			profile: session.profile,
			source: session.source,
			speaker: session.speaker,
			targetItemId,
		});

		await new Promise((resolvePromise) => {
			session.stopFlush = {
				resolve: resolvePromise,
				settleTimeoutId: null,
				targetItemId,
				timeoutId: setTimeout(() => {
					resolveStopFlush(session);
				}, desktopRealtimeStopFlushTimeoutMs),
			};

			try {
				session.socket.send(
					JSON.stringify({
						type: "input_audio_buffer.commit",
					}),
				);
				settleStopFlush(session);
			} catch (error) {
				console.warn("[desktop-realtime] failed to flush transport on stop", {
					message: error instanceof Error ? error.message : String(error),
					profile: session.profile,
					source: session.source,
					speaker: session.speaker,
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
		session.isClosing = true;
		session.unsubscribeCapture?.();
		session.unsubscribeCapture = null;
		clearTimeout(session.openTimeout);
		await flushOnStop(session, getLiveItemId);

		await new Promise((resolvePromise) => {
			const finalize = () => {
				resolvePromise();
			};

			session.socket.once("close", finalize);
			session.socket.close();

			setTimeout(() => {
				if (session.socket.readyState !== WebSocket.CLOSED) {
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
			getHostedConvexSiteUrl,
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
			const socket = new WebSocket(
				"wss://api.openai.com/v1/realtime?intent=transcription",
				{
					headers: {
						Authorization: `Bearer ${clientSecret}`,
					},
				},
			);
			const session = {
				isClosing: false,
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
				profile,
				socket,
				source,
				speaker,
				language,
				unsubscribeCapture: null,
			};

			logDesktopTurnDebug("transport.session_started", {
				language,
				profile,
				source,
				speaker,
			});

			console.info("[desktop-realtime] starting transport", {
				language,
				profile,
				source,
				speaker,
			});

			const flushPendingAudio = () => {
				if (socket.readyState !== WebSocket.OPEN) {
					return;
				}

				for (const pendingAudio of session.pendingAudio) {
					sendAudioChunk({
						audio: pendingAudio,
						socket,
					});
				}
				session.pendingAudio = [];
			};

			const finalizeStartError = (error) => {
				console.warn("[desktop-realtime] transport start failed", {
					didResolve,
					message: error instanceof Error ? error.message : String(error),
					profile,
					source,
					speaker,
				});

				if (didResolve) {
					void handleTransportEvent({
						speaker,
						type: "interrupted",
						message:
							error instanceof Error
								? error.message
								: "Realtime transcription failed.",
					});
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

					if (!audio) {
						return;
					}

					if (socket.readyState !== WebSocket.OPEN) {
						session.pendingAudio.push(audio);
						if (
							session.pendingAudio.length >
							desktopRealtimePendingAudioChunkLimit
						) {
							session.pendingAudio.shift();
						}
						return;
					}

					sendAudioChunk({
						audio,
						socket,
					});
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
				console.info("[desktop-realtime] transport open", {
					language,
					profile,
					source,
					speaker,
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
						notifyStopFlushEvent(session, transportEvent);
						void handleTransportEvent(transportEvent);
					}
				} catch (error) {
					console.error(
						"[desktop-realtime] failed to parse websocket event",
						error,
					);
				}
			});

			socket.on("error", (error) => {
				clearTimeout(session.openTimeout);
				console.warn("[desktop-realtime] socket error", {
					didResolve,
					isClosing: session.isClosing,
					message: error instanceof Error ? error.message : String(error),
					profile,
					socketState: socket.readyState,
					source,
					speaker,
				});
				finalizeStartError(error);
			});

			socket.on("close", (code, reasonBuffer) => {
				clearTimeout(session.openTimeout);
				session.unsubscribeCapture?.();
				session.unsubscribeCapture = null;

				const reason = Buffer.isBuffer(reasonBuffer)
					? reasonBuffer.toString("utf8")
					: String(reasonBuffer ?? "");

				console.warn("[desktop-realtime] socket close", {
					code,
					didResolve,
					isClosing: session.isClosing,
					profile,
					reason,
					socketState: socket.readyState,
					source,
					speaker,
				});

				if (sessions.get(speaker) === session) {
					sessions.delete(speaker);
				}

				if (!session.isClosing) {
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
