import { describe, expect, it } from "vitest";
import { createHostedChatRunResponseStream } from "../../../packages/ai/src/hosted-chat-stream-lifecycle.mjs";

const createActiveStreamSession = () => {
	const abortController = new AbortController();
	const persistedText: string[] = [];
	let cleanedUp = false;
	let persistenceClosed = false;
	let broadcastStarted = false;

	return {
		get broadcastStarted() {
			return broadcastStarted;
		},
		get cleanedUp() {
			return cleanedUp;
		},
		get persistedText() {
			return persistedText;
		},
		get persistenceClosed() {
			return persistenceClosed;
		},
		session: {
			abortSignal: abortController.signal,
			append: (delta: string) => persistedText.push(delta),
			cleanup: () => {
				cleanedUp = true;
			},
			closePersistence: async () => {
				persistenceClosed = true;
			},
			startBroadcast: (stream: ReadableStream<{ type: string }>) => {
				broadcastStarted = true;
				return stream;
			},
		},
	};
};

const createStreamLatencyTracker = () => ({
	getFinishDetails: () => ({ finished: true }),
	wrapStream: (stream: ReadableStream<{ type: string }>) => stream,
});

describe("hosted chat stream lifecycle", () => {
	it("creates a broadcast stream and flushes completed finalization after the stream is consumed", async () => {
		const activeStream = createActiveStreamSession();
		const finalized: unknown[] = [];
		const latencyStages: string[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Hello" }],
				},
			],
			createUiStream: async ({ onFinish }) => {
				onFinish({
					isAborted: false,
					responseMessage: {
						id: "assistant-message-1",
						role: "assistant",
						parts: [{ type: "text", text: "Hi" }],
					},
				});
				return new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "text-delta", delta: "Hi" });
						controller.close();
					},
				});
			},
			failAssistantRun: async () => {
				throw new Error("run should not fail");
			},
			finalizeAssistantRun: async (terminalization) => {
				finalized.push(terminalization);
			},
			finalizedToolSet: { hasTools: true },
			logLatency: (stage) => latencyStages.push(stage),
			streamLatencyTracker: createStreamLatencyTracker(),
			systemPrompt: "system",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		const chunks = [];
		for await (const chunk of result.responseStream) {
			chunks.push(chunk);
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(activeStream.broadcastStarted).toBe(true);
		expect(chunks).toEqual([{ type: "text-delta", delta: "Hi" }]);
		expect(finalized).toEqual([
			{
				responseMessage: {
					id: "assistant-message-1",
					role: "assistant",
					parts: [{ type: "text", text: "Hi" }],
				},
				status: "completed",
			},
		]);
		expect(latencyStages).toContain("ai.agent_created");
		expect(latencyStages).toContain("stream.finish");
		expect(latencyStages).toContain("ai.stream_created");
	});

	it("fails the assistant run and cleans up when stream creation fails", async () => {
		const activeStream = createActiveStreamSession();
		const failedRuns: unknown[] = [];
		const errors: unknown[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [],
			createUiStream: async () => {
				throw new Error("stream failed");
			},
			failAssistantRun: async (args) => {
				failedRuns.push(args);
			},
			finalizeAssistantRun: async () => {
				throw new Error("run should not finalize");
			},
			finalizedToolSet: { hasTools: false },
			logLatency: () => undefined,
			onStreamCreateError: (error) => {
				errors.push(error);
			},
			streamLatencyTracker: createStreamLatencyTracker(),
			systemPrompt: "system",
		});

		expect(result.ok).toBe(false);
		expect(activeStream.cleanedUp).toBe(true);
		expect(activeStream.broadcastStarted).toBe(false);
		expect(failedRuns).toEqual([
			{
				errorText: "stream failed",
				runId: "run-1",
			},
		]);
		expect(errors).toHaveLength(1);
	});
});
