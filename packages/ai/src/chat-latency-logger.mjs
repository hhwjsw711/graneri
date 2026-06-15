import { aiLogger } from "./logger.mjs";

export const createChatLatencyLogger = ({
	chatId,
	enabled,
	model,
	reasoningEffort,
}) => {
	const startedAt = performance.now();
	let previousMarkAt = startedAt;

	return (event, details = {}) => {
		if (!enabled) {
			return;
		}

		const now = performance.now();
		const elapsedMs = Math.round(now - startedAt);
		const deltaMs = Math.round(now - previousMarkAt);
		previousMarkAt = now;

		aiLogger.info({
			event: `chat_latency.${event}`,
			elapsedMs,
			deltaMs,
			chatId: chatId ?? null,
			model: model ?? null,
			reasoningEffort: reasoningEffort ?? null,
			...details,
		});
	};
};

export const createChatStreamLatencyTracker = (logLatency) => {
	const state = {
		sawFirstReasoningChunk: false,
		sawFirstTextChunk: false,
	};
	let sawFirstChunk = false;

	return {
		getFinishDetails: () => state,
		wrapStream: (stream) =>
			stream.pipeThrough(
				new TransformStream({
					transform(chunk, controller) {
						if (!sawFirstChunk) {
							sawFirstChunk = true;
							logLatency("stream.first_chunk", {
								chunkType: chunk.type,
							});
						}

						if (!state.sawFirstReasoningChunk && chunk.type === "reasoning-delta") {
							state.sawFirstReasoningChunk = true;
							logLatency("stream.first_reasoning_delta");
						}

						if (!state.sawFirstTextChunk && chunk.type === "text-delta") {
							state.sawFirstTextChunk = true;
							logLatency("stream.first_text_delta");
						}

						controller.enqueue(chunk);
					},
				}),
			),
	};
};
