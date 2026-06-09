import { describe, expect, it, vi } from "vitest";
import {
	createHostedActiveChatStreamSession,
	createHostedActiveStreamKey,
	createHostedActiveStreamSession,
	HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS,
	HostedActiveChatStreamPersister,
	pipeHostedActiveStreamText,
	stopHostedActiveChatStream,
} from "../../../packages/ai/src/hosted-chat-active-stream.mjs";

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
		const persister = new HostedActiveChatStreamPersister({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			startActiveStream,
			appendActiveStreamText,
			finishActiveStream,
		});

		await persister.start();
		persister.append("hello");
		persister.append(" world");
		await persister.flush();
		await persister.finish("done");

		expect(startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
		});
		expect(appendActiveStreamText).toHaveBeenCalledTimes(1);
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			delta: "hello world",
		});
		expect(finishActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			status: "done",
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
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("hello");
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await Promise.resolve();
			await Promise.resolve();

			await expect(persister.finish("done")).rejects.toThrow("append failed");
			expect(finishActiveStream).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("owns active stream controller replacement and cleanup", async () => {
		const controllers = new Map<string, AbortController>();
		const existingController = new AbortController();
		const start = vi.fn().mockResolvedValue(undefined);
		const append = vi.fn();
		const finish = vi.fn().mockResolvedValue(undefined);
		const streamKey = "workspace-1:chat-1";
		controllers.set(streamKey, existingController);
		const session = createHostedActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start,
				append,
				finish,
			},
		});

		await session.start();
		expect(controllers.get(streamKey)?.signal).toBe(session.abortSignal);
		session.append("hello");
		await session.finish("done");

		expect(existingController.signal.aborted).toBe(true);
		expect(start).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledWith("hello");
		expect(finish).toHaveBeenCalledWith("done");

		expect(controllers.has(streamKey)).toBe(false);
	});

	it("cleans active stream controllers when session finish fails", async () => {
		const controllers = new Map<string, AbortController>();
		const streamKey = "workspace-1:chat-1";
		const finish = vi.fn().mockRejectedValue(new Error("finish failed"));
		const session = createHostedActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				finish,
			},
		});

		await session.start();

		await expect(session.finish("error")).rejects.toThrow("finish failed");
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("creates chat-scoped active stream sessions through adapter callbacks", async () => {
		const controllers = new Map<string, AbortController>();
		const startActiveStream = vi.fn().mockResolvedValue(undefined);
		const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
		const finishActiveStream = vi.fn().mockResolvedValue(undefined);
		const session = createHostedActiveChatStreamSession({
			controllers,
			workspaceId: "workspace-1",
			chatId: "chat-1",
			callbacks: {
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			},
		});

		await session.start();
		expect(controllers.get("workspace-1:chat-1")?.signal).toBe(
			session.abortSignal,
		);
		session.append("hello");
		await session.finish("done");

		expect(controllers.has("workspace-1:chat-1")).toBe(false);
		expect(startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: expect.stringMatching(/^stream-/),
		});
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: expect.stringMatching(/^stream-/),
			delta: "hello",
		});
		expect(finishActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: expect.stringMatching(/^stream-/),
			status: "done",
		});
	});

	it("stops chat-scoped active streams atomically", async () => {
		const controllers = new Map<string, AbortController>();
		const activeController = new AbortController();
		const stopActiveStream = vi.fn().mockResolvedValue(undefined);
		controllers.set("workspace-1:chat-1", activeController);

		await stopHostedActiveChatStream({
			controllers,
			workspaceId: "workspace-1",
			chatId: "chat-1",
			stopActiveStream,
		});

		expect(activeController.signal.aborted).toBe(true);
		expect(controllers.has("workspace-1:chat-1")).toBe(false);
		expect(stopActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
		});
	});

	it("keeps active stream controllers alive when backend stop fails", async () => {
		const controllers = new Map<string, AbortController>();
		const activeController = new AbortController();
		const stopActiveStream = vi
			.fn()
			.mockRejectedValue(new Error("stop failed"));
		controllers.set("workspace-1:chat-1", activeController);

		await expect(
			stopHostedActiveChatStream({
				controllers,
				workspaceId: "workspace-1",
				chatId: "chat-1",
				stopActiveStream,
			}),
		).rejects.toThrow("stop failed");

		expect(activeController.signal.aborted).toBe(false);
		expect(controllers.get("workspace-1:chat-1")).toBe(activeController);
	});

	it("pipes stream chunks while persisting text deltas only", async () => {
		const append = vi.fn();
		const inputChunks = [
			{ type: "text-delta", delta: "hello" },
			{ type: "reasoning-delta", delta: "hidden" },
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
			persister: { append },
		})) {
			outputChunks.push(chunk);
		}

		expect(outputChunks).toEqual(inputChunks);
		expect(append).toHaveBeenCalledTimes(2);
		expect(append).toHaveBeenNthCalledWith(1, "hello");
		expect(append).toHaveBeenNthCalledWith(2, " world");
	});
});
