import { describe, expect, it, vi } from "vitest";
import {
	createHostedActiveChatStreamSession,
	createHostedActiveStreamKey,
	createHostedActiveStreamSession,
	HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS,
	HostedActiveChatStreamPersister,
	pipeHostedActiveStreamText,
} from "../../../packages/ai/src/hosted-chat-active-stream.mjs";

const collectStream = async <T>(stream: ReadableStream<T>) => {
	const reader = stream.getReader();
	const chunks: T[] = [];

	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return chunks;
		}
		chunks.push(value);
	}
};

describe("hosted active chat stream", () => {
	it("creates stable stream keys for active stream controllers", () => {
		expect(
			createHostedActiveStreamKey({
				workspaceId: "workspace-1",
				chatId: "chat-1",
			}),
		).toBe("workspace-1:chat-1");
	});

	it("batches active stream deltas and finishes through adapter callbacks", async () => {
		const startActiveStream = vi.fn().mockResolvedValue(undefined);
		const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
		const finishActiveStream = vi.fn().mockResolvedValue(undefined);
		const startActiveStreamToolCall = vi.fn().mockResolvedValue(undefined);
		const finishActiveStreamToolCall = vi.fn().mockResolvedValue(undefined);
		const persister = new HostedActiveChatStreamPersister({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			runId: "run-1",
			startActiveStream,
			appendActiveStreamText,
			finishActiveStream,
			startActiveStreamToolCall,
			finishActiveStreamToolCall,
		});

		await persister.start();
		persister.append("hello");
		persister.append(" world");
		await persister.startToolCall({
			toolCallId: "tool-call-1",
			toolName: "search",
			input: { query: "graneri" },
		});
		await persister.finishToolCall({
			toolCallId: "tool-call-1",
			status: "completed",
			output: { result: "ok" },
		});
		await persister.flush();
		await persister.finish();

		expect(startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
		expect(appendActiveStreamText).toHaveBeenCalledTimes(1);
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			delta: "hello world",
		});
		expect(finishActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
		expect(startActiveStreamToolCall).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			toolCallId: "tool-call-1",
			toolName: "search",
			inputJson: JSON.stringify({ query: "graneri" }),
		});
		expect(finishActiveStreamToolCall).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			toolCallId: "tool-call-1",
			status: "completed",
			outputJson: JSON.stringify({ result: "ok" }),
			errorText: undefined,
		});
	});

	it("surfaces scheduled active stream append failures through finish", async () => {
		vi.useFakeTimers();
		try {
			const startActiveStream = vi.fn().mockResolvedValue(undefined);
			const appendActiveStreamText = vi
				.fn()
				.mockRejectedValue(new Error("append failed"));
			const finishActiveStream = vi.fn().mockResolvedValue(undefined);
			const persister = new HostedActiveChatStreamPersister({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				messageId: "stream-1",
				runId: "run-1",
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("hello");
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await Promise.resolve();
			await Promise.resolve();

			await expect(persister.finish()).rejects.toThrow("append failed");
			expect(finishActiveStream).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops pending active stream text after cleanup closes persistence", async () => {
		vi.useFakeTimers();
		try {
			const startActiveStream = vi.fn().mockResolvedValue(undefined);
			const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
			const finishActiveStream = vi.fn().mockResolvedValue(undefined);
			const persister = new HostedActiveChatStreamPersister({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				messageId: "stream-1",
				runId: "run-1",
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("hello");
			persister.discardPending();
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await persister.flush();
			await persister.finish();

			expect(appendActiveStreamText).not.toHaveBeenCalled();
			expect(finishActiveStream).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("closes active stream persistence by flushing accepted text and rejecting later appends", async () => {
		vi.useFakeTimers();
		try {
			const startActiveStream = vi.fn().mockResolvedValue(undefined);
			const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
			const finishActiveStream = vi.fn().mockResolvedValue(undefined);
			const persister = new HostedActiveChatStreamPersister({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				messageId: "stream-1",
				runId: "run-1",
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("accepted");
			await persister.closePersistence();
			persister.append(" ignored");
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await persister.flush();

			expect(appendActiveStreamText).toHaveBeenCalledOnce();
			expect(appendActiveStreamText).toHaveBeenCalledWith({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				runId: "run-1",
				delta: "accepted",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("owns active stream controller replacement and cleanup", async () => {
		const controllers = new Map();
		const existingController = new AbortController();
		const start = vi.fn().mockResolvedValue(undefined);
		const append = vi.fn();
		const closePersistence = vi.fn().mockResolvedValue(undefined);
		const finish = vi.fn().mockResolvedValue(undefined);
		const streamKey = "workspace-1:chat-1";
		controllers.set(streamKey, existingController);
		const session = createHostedActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start,
				append,
				closePersistence,
				finish,
			},
		});

		await session.start();
		expect(controllers.get(streamKey)).toBe(session);
		session.append("hello");
		await session.finish();

		expect(existingController.signal.aborted).toBe(true);
		expect(start).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledWith("hello");
		expect(finish).toHaveBeenCalledWith();

		expect(controllers.has(streamKey)).toBe(false);
	});

	it("cleans active stream controllers when session finish fails", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const finish = vi.fn().mockRejectedValue(new Error("finish failed"));
		const session = createHostedActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish,
			},
		});

		await session.start();

		await expect(session.finish()).rejects.toThrow("finish failed");
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("broadcasts active stream chunks to original and reconnect subscribers", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const session = createHostedActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});
		const source = new ReadableStream<{ type: string; value: string }>({
			start(controller) {
				queueMicrotask(() => {
					controller.enqueue({ type: "text-delta", value: "one" });
					controller.enqueue({ type: "text-delta", value: "two" });
					controller.close();
				});
			},
		});

		await session.start();
		const originalStream = session.startBroadcast(source);
		const reconnectStream = session.subscribe();
		const [originalChunks, reconnectChunks] = await Promise.all([
			collectStream(originalStream),
			collectStream(reconnectStream),
		]);

		expect(originalChunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
		expect(reconnectChunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("replays prior stream chunks to late reconnect subscribers", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const session = createHostedActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});
		let sourceController:
			| ReadableStreamDefaultController<{
					type: string;
					id: string;
					delta?: string;
			  }>
			| undefined;
		const source = new ReadableStream<{
			type: string;
			id: string;
			delta?: string;
		}>({
			start(controller) {
				sourceController = controller;
			},
		});

		await session.start();
		const originalStream = session.startBroadcast(source);
		sourceController?.enqueue({ type: "text-start", id: "text-1" });
		sourceController?.enqueue({
			type: "text-delta",
			id: "text-1",
			delta: "hello",
		});
		await Promise.resolve();

		const reconnectStream = session.subscribe();
		sourceController?.enqueue({
			type: "text-delta",
			id: "text-1",
			delta: " world",
		});
		sourceController?.close();

		const [originalChunks, reconnectChunks] = await Promise.all([
			collectStream(originalStream),
			collectStream(reconnectStream),
		]);

		expect(originalChunks).toEqual([
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "hello" },
			{ type: "text-delta", id: "text-1", delta: " world" },
		]);
		expect(reconnectChunks).toEqual(originalChunks);
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("creates chat-scoped active stream sessions through adapter callbacks", async () => {
		const controllers = new Map();
		const startActiveStream = vi.fn().mockResolvedValue(undefined);
		const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
		const finishActiveStream = vi.fn().mockResolvedValue(undefined);
		const session = createHostedActiveChatStreamSession({
			controllers,
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			runId: "run-1",
			callbacks: {
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			},
		});

		await session.start();
		expect(controllers.get("workspace-1:chat-1")).toBe(session);
		session.append("hello");
		await session.finish();

		expect(controllers.has("workspace-1:chat-1")).toBe(false);
		expect(startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			delta: "hello",
		});
		expect(finishActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
	});

	it("pipes stream chunks while updating text snapshots and tool lifecycle state", async () => {
		const append = vi.fn();
		const startToolCall = vi.fn().mockResolvedValue(undefined);
		const finishToolCall = vi.fn().mockResolvedValue(undefined);
		const inputChunks = [
			{ type: "text-delta", delta: "hello" },
			{
				type: "tool-input-available",
				toolCallId: "tool-call-1",
				toolName: "search",
				input: { query: "graneri" },
			},
			{
				type: "tool-output-error",
				toolCallId: "tool-call-1",
				errorText: "search failed",
			},
			{ type: "text-delta", delta: " world" },
		];
		const stream = new ReadableStream<(typeof inputChunks)[number]>({
			start(controller) {
				for (const chunk of inputChunks) {
					controller.enqueue(chunk);
				}
				controller.close();
			},
		});

		const outputChunks = [];
		for await (const chunk of pipeHostedActiveStreamText({
			stream,
			persister: { append, startToolCall, finishToolCall },
		})) {
			outputChunks.push(chunk);
		}

		expect(outputChunks).toEqual(inputChunks);
		expect(append).toHaveBeenCalledTimes(2);
		expect(append).toHaveBeenNthCalledWith(1, "hello");
		expect(append).toHaveBeenNthCalledWith(2, " world");
		expect(startToolCall).toHaveBeenCalledWith({
			toolCallId: "tool-call-1",
			toolName: "search",
			input: { query: "graneri" },
		});
		expect(finishToolCall).toHaveBeenCalledWith({
			toolCallId: "tool-call-1",
			status: "failed",
			errorText: "search failed",
		});
	});

	it("runs stream terminalization after pending active stream text flushes", async () => {
		const events: string[] = [];
		const stream = new ReadableStream<{ type: string; delta: string }>({
			start(controller) {
				controller.enqueue({ type: "text-delta", delta: "hello" });
				controller.close();
			},
		});

		const outputChunks = [];
		for await (const chunk of pipeHostedActiveStreamText({
			onFlush: () => {
				events.push("terminalize");
			},
			stream,
			persister: {
				append: () => {
					events.push("append");
				},
				async flush() {
					events.push("flush");
				},
			},
		})) {
			outputChunks.push(chunk);
		}

		expect(outputChunks).toEqual([{ type: "text-delta", delta: "hello" }]);
		expect(events).toEqual(["append", "flush", "terminalize"]);
	});
});
