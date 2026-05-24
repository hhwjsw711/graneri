export declare function createChatLatencyLogger(args: {
	chatId?: string;
	enabled?: boolean;
	model?: string;
	reasoningEffort?: string;
}): (
	event: string,
	details?: Record<string, boolean | number | string | null | undefined>,
) => void;

export type ChatLatencyLogger = ReturnType<typeof createChatLatencyLogger>;

export declare function createChatStreamLatencyTracker<
	TChunk extends { type: string },
>(
	logLatency: ChatLatencyLogger,
): {
	getFinishDetails: () => {
		sawFirstReasoningChunk: boolean;
		sawFirstTextChunk: boolean;
	};
	wrapStream: (stream: ReadableStream<TChunk>) => ReadableStream<TChunk>;
};
