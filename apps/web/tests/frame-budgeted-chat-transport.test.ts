import type { ChatTransport, UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
	createFrameBudgetedStream,
	FrameBudgetedChatTransport,
} from "../src/lib/frame-budgeted-chat-transport";

const collectStream = async <T>(stream: ReadableStream<T>) => {
	const reader = stream.getReader();
	const values: T[] = [];

	while (true) {
		const result = await reader.read();
		if (result.done) {
			return values;
		}

		values.push(result.value);
	}
};

const createControlledScheduler = () => {
	const callbacks: Array<() => void> = [];
	return {
		scheduleFrame: (callback: () => void) => {
			callbacks.push(callback);
			return () => {
				const index = callbacks.indexOf(callback);
				if (index >= 0) {
					callbacks.splice(index, 1);
				}
			};
		},
		runFrame: () => {
			const callback = callbacks.shift();
			callback?.();
		},
		get pendingFrames() {
			return callbacks.length;
		},
	};
};

const flushMicrotasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("createFrameBudgetedStream", () => {
	it("drains queued chunks over frame-sized slices", async () => {
		const scheduler = createControlledScheduler();
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				start(controller) {
					controller.enqueue(1);
					controller.enqueue(2);
					controller.enqueue(3);
					controller.close();
				},
			}),
			{
				maxItemsPerFrame: 2,
				maxFrameMs: 100,
				scheduleFrame: scheduler.scheduleFrame,
				now: () => 0,
			},
		);
		const collected = collectStream(stream);

		await flushMicrotasks();
		expect(scheduler.pendingFrames).toBe(1);

		scheduler.runFrame();
		await flushMicrotasks();
		expect(scheduler.pendingFrames).toBe(1);

		scheduler.runFrame();
		await expect(collected).resolves.toEqual([1, 2, 3]);
	});

	it("keeps source reads bounded until queued chunks drain", async () => {
		const scheduler = createControlledScheduler();
		const totalValues = 20;
		let nextValue = 1;
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				pull(controller) {
					controller.enqueue(nextValue);
					nextValue += 1;

					if (nextValue > totalValues) {
						controller.close();
					}
				},
			}),
			{
				maxBufferedItems: 2,
				maxItemsPerFrame: 1,
				maxFrameMs: 100,
				scheduleFrame: scheduler.scheduleFrame,
				now: () => 0,
			},
		);
		const collected = collectStream(stream);

		await flushMicrotasks();
		expect(nextValue).toBeLessThan(totalValues);

		scheduler.runFrame();
		await flushMicrotasks();
		expect(nextValue).toBeLessThan(totalValues);

		while (scheduler.pendingFrames > 0) {
			scheduler.runFrame();
			await flushMicrotasks();
		}

		await expect(collected).resolves.toEqual(
			Array.from({ length: totalValues }, (_, index) => index + 1),
		);
	});
});

describe("FrameBudgetedChatTransport", () => {
	it("paces send and reconnect streams", async () => {
		const scheduler = createControlledScheduler();
		const chunk = (delta: string): UIMessageChunk => ({
			type: "text-delta",
			id: "part-1",
			delta,
		});
		const createChunkStream = () =>
			new ReadableStream<UIMessageChunk>({
				start(controller) {
					controller.enqueue(chunk("a"));
					controller.enqueue(chunk("b"));
					controller.close();
				},
			});
		const baseTransport = {
			sendMessages: vi.fn(async () => createChunkStream()),
			reconnectToStream: vi.fn(async () => createChunkStream()),
		} satisfies ChatTransport;
		const transport = new FrameBudgetedChatTransport(baseTransport, {
			maxItemsPerFrame: 1,
			maxFrameMs: 100,
			scheduleFrame: scheduler.scheduleFrame,
			now: () => 0,
		});

		const sent = collectStream(
			await transport.sendMessages({
				abortSignal: undefined,
				chatId: "chat-1",
				messageId: undefined,
				messages: [],
				trigger: "submit-message",
			}),
		);
		await flushMicrotasks();
		scheduler.runFrame();
		await flushMicrotasks();
		scheduler.runFrame();

		await expect(sent).resolves.toEqual([chunk("a"), chunk("b")]);

		const reconnected = collectStream(
			(await transport.reconnectToStream({ chatId: "chat-1" })) ??
				new ReadableStream<UIMessageChunk>(),
		);
		await flushMicrotasks();
		scheduler.runFrame();
		await flushMicrotasks();
		scheduler.runFrame();

		await expect(reconnected).resolves.toEqual([chunk("a"), chunk("b")]);
	});
});
