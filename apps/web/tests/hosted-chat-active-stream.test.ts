import { describe, expect, it, vi } from "vitest";
import {
	createHostedActiveStreamKey,
	HostedActiveChatStreamPersister,
	pipeHostedActiveStreamText,
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
