export const parseDesktopRealtimeTransportEvent = ({ event, speaker }) => {
	if (!event || typeof event !== "object" || typeof event.type !== "string") {
		return null;
	}

	if (event.type === "input_audio_buffer.committed" && event.item_id) {
		return {
			speaker,
			type: "committed",
			itemId: event.item_id,
			previousItemId: event.previous_item_id ?? null,
		};
	}

	if (
		event.type === "conversation.item.input_audio_transcription.delta" &&
		event.item_id &&
		typeof event.delta === "string"
	) {
		return {
			logprobs: event.logprobs ?? null,
			speaker,
			type: "partial",
			itemId: event.item_id,
			textDelta: event.delta,
		};
	}

	if (
		event.type === "conversation.item.input_audio_transcription.completed" &&
		event.item_id
	) {
		return {
			logprobs: event.logprobs ?? null,
			speaker,
			type: "final",
			itemId: event.item_id,
			text: event.transcript ?? event.text ?? "",
		};
	}

	if (event.type === "conversation.item.input_audio_transcription.failed") {
		if (!event.item_id) {
			return null;
		}

		return {
			itemId: event.item_id,
			message:
				event.error?.message ??
				"Realtime transcription failed for the current turn.",
			speaker,
			type: "turn_failed",
		};
	}

	if (event.type === "error") {
		return {
			speaker,
			type: "interrupted",
			message: event.error?.message ?? "Realtime transcription failed.",
		};
	}

	return null;
};
