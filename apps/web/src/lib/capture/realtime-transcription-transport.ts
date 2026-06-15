import type { TranscriptSpeaker } from "@/lib/transcript";
import type { TranscriptionLogger } from "@/lib/transcription-logger";
import { normalizeTranscriptionLanguage } from "../../../../../packages/ai/src/transcription.mjs";

type RealtimeTranscriptionLogprob = {
	bytes?: number[];
	logprob?: number;
	token?: string;
};

type RealtimeSessionPayload = {
	clientSecret: string;
};

type OpenAIRealtimeTranscriptionEvent =
	| {
			type: "conversation.item.input_audio_transcription.completed";
			item_id?: string;
			logprobs?: RealtimeTranscriptionLogprob[];
			transcript?: string;
			text?: string;
	  }
	| {
			type: "conversation.item.input_audio_transcription.delta";
			item_id?: string;
			delta?: string;
			logprobs?: RealtimeTranscriptionLogprob[];
	  }
	| {
			type: "conversation.item.input_audio_transcription.failed";
			item_id?: string;
			error?: {
				message?: string;
			};
	  }
	| {
			type: "input_audio_buffer.committed";
			item_id?: string;
			previous_item_id?: string | null;
	  }
	| {
			type: "error";
			error?: {
				message?: string;
			};
	  };

export type RealtimeTranscriptionTransportEvent =
	| {
			type: "committed";
			itemId: string;
			previousItemId: string | null;
			speaker: TranscriptSpeaker;
	  }
	| {
			type: "partial";
			itemId: string;
			logprobs?: RealtimeTranscriptionLogprob[];
			textDelta: string;
			speaker: TranscriptSpeaker;
	  }
	| {
			type: "final";
			itemId: string;
			logprobs?: RealtimeTranscriptionLogprob[];
			text: string;
			speaker: TranscriptSpeaker;
	  }
	| {
			type: "turn_failed";
			itemId: string;
			message: string;
			speaker: TranscriptSpeaker;
	  }
	| {
			type: "transport_error";
			message: string;
			speaker: TranscriptSpeaker;
	  };

export type RealtimeTranscriptionTransport = {
	close: () => Promise<void>;
};

export type RealtimeTranscriptionSource = "microphone" | "systemAudio";

const createRealtimeSession = async (
	lang?: string,
	source?: RealtimeTranscriptionSource,
	speaker?: TranscriptSpeaker,
): Promise<RealtimeSessionPayload> => {
	const language = normalizeTranscriptionLanguage(lang);

	const response = await fetch("/api/realtime-transcription-session", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			...(language ? { lang: language } : {}),
			...(source ? { source } : {}),
			...(speaker ? { speaker } : {}),
		}),
	});

	const payload = (await response.json().catch(() => ({}))) as {
		clientSecret?: string;
		error?: string;
	};

	if (!response.ok || !payload.clientSecret) {
		throw new Error(payload.error || "Failed to create transcription session.");
	}

	return {
		clientSecret: payload.clientSecret,
	};
};

const waitForConnectedPeer = async (
	peerConnection: RTCPeerConnection,
	logger: TranscriptionLogger,
) =>
	await new Promise<void>((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			cleanup();
			reject(new Error("Realtime transcription connection timed out."));
		}, 10_000);

		const cleanup = () => {
			window.clearTimeout(timeoutId);
			peerConnection.removeEventListener(
				"connectionstatechange",
				handleConnectionStateChange,
			);
		};

		const handleConnectionStateChange = () => {
			logger.info("transport.connection_state_change", {
				connectionState: peerConnection.connectionState,
			});

			if (peerConnection.connectionState === "connected") {
				cleanup();
				resolve();
				return;
			}

			if (
				peerConnection.connectionState === "failed" ||
				peerConnection.connectionState === "closed"
			) {
				cleanup();
				reject(new Error("Realtime transcription connection was interrupted."));
			}
		};

		peerConnection.addEventListener(
			"connectionstatechange",
			handleConnectionStateChange,
		);
		handleConnectionStateChange();
	});

export const connectRealtimeTranscriptionTransport = async ({
	stream,
	lang,
	logger,
	onEvent,
	onInterrupted,
	source,
	speaker,
}: {
	stream: MediaStream;
	lang?: string;
	logger: TranscriptionLogger;
	onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
	onInterrupted: (message: string) => void;
	source: RealtimeTranscriptionSource;
	speaker: TranscriptSpeaker;
}): Promise<RealtimeTranscriptionTransport> => {
	const [{ clientSecret }, peerConnection] = await Promise.all([
		createRealtimeSession(lang, source, speaker),
		Promise.resolve(new RTCPeerConnection()),
	]);
	let hasClosed = false;
	let disconnectTimeoutId: number | null = null;

	const clearDisconnectTimeout = () => {
		if (disconnectTimeoutId == null) {
			return;
		}

		window.clearTimeout(disconnectTimeoutId);
		disconnectTimeoutId = null;
	};

	const close = async () => {
		if (hasClosed) {
			return;
		}

		hasClosed = true;
		clearDisconnectTimeout();
		peerConnection.close();
	};

	for (const track of stream.getTracks()) {
		peerConnection.addTrack(track, stream);
	}

	const dataChannel = peerConnection.createDataChannel("oai-events");

	dataChannel.addEventListener("message", (event) => {
		try {
			const realtimeEvent = JSON.parse(
				String(event.data),
			) as OpenAIRealtimeTranscriptionEvent;

			if (realtimeEvent.type === "input_audio_buffer.committed") {
				if (realtimeEvent.item_id) {
					onEvent({
						type: "committed",
						itemId: realtimeEvent.item_id,
						previousItemId: realtimeEvent.previous_item_id ?? null,
						speaker,
					});
				}
				return;
			}

			if (
				realtimeEvent.type ===
				"conversation.item.input_audio_transcription.delta"
			) {
				if (realtimeEvent.item_id && realtimeEvent.delta) {
					onEvent({
						type: "partial",
						itemId: realtimeEvent.item_id,
						logprobs: realtimeEvent.logprobs,
						textDelta: realtimeEvent.delta,
						speaker,
					});
				}
				return;
			}

			if (
				realtimeEvent.type ===
				"conversation.item.input_audio_transcription.completed"
			) {
				if (!realtimeEvent.item_id) {
					return;
				}

				onEvent({
					type: "final",
					itemId: realtimeEvent.item_id,
					logprobs: realtimeEvent.logprobs,
					text: realtimeEvent.transcript ?? realtimeEvent.text ?? "",
					speaker,
				});
				return;
			}

			if (
				realtimeEvent.type ===
				"conversation.item.input_audio_transcription.failed"
			) {
				if (!realtimeEvent.item_id) {
					return;
				}

				onEvent({
					type: "turn_failed",
					itemId: realtimeEvent.item_id,
					message:
						realtimeEvent.error?.message ??
						"Realtime transcription failed for the current turn.",
					speaker,
				});
				return;
			}

			if (realtimeEvent.type === "error") {
				onEvent({
					type: "transport_error",
					message:
						realtimeEvent.error?.message ?? "Realtime transcription failed.",
					speaker,
				});
			}
		} catch (error) {
			logger.error("transport.event_parse_failed", {
				error:
					error instanceof Error
						? error.message
						: "Unknown event parsing error.",
			});
		}
	});

	peerConnection.addEventListener("connectionstatechange", () => {
		if (hasClosed) {
			return;
		}

		if (
			peerConnection.connectionState === "connected" ||
			peerConnection.connectionState === "connecting"
		) {
			clearDisconnectTimeout();
			return;
		}

		if (peerConnection.connectionState === "disconnected") {
			if (disconnectTimeoutId != null) {
				return;
			}

			disconnectTimeoutId = window.setTimeout(() => {
				disconnectTimeoutId = null;
				if (peerConnection.connectionState !== "disconnected" || hasClosed) {
					return;
				}
				onInterrupted("Realtime transcription connection was interrupted.");
			}, 1_500);
			return;
		}

		if (
			peerConnection.connectionState === "failed" ||
			peerConnection.connectionState === "closed"
		) {
			onInterrupted("Realtime transcription connection was interrupted.");
		}
	});

	const offer = await peerConnection.createOffer();
	await peerConnection.setLocalDescription(offer);

	const response = await fetch("https://api.openai.com/v1/realtime/calls", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${clientSecret}`,
			"Content-Type": "application/sdp",
		},
		body: offer.sdp,
	});

	if (!response.ok) {
		await close();
		throw new Error("Failed to connect realtime transcription.");
	}

	const answerSdp = await response.text();

	await Promise.all([
		peerConnection.setRemoteDescription({
			type: "answer",
			sdp: answerSdp,
		}),
		waitForConnectedPeer(peerConnection, logger),
	]);

	return {
		close,
	};
};
