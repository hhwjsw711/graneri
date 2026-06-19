import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createHostedAssistantRunFinalizationQueue } from "../../../packages/ai/src/hosted-chat-run-finalization-queue.mjs";
import { createHostedAssistantRunFinalizer } from "../../../packages/ai/src/hosted-chat-run-finalizer.mjs";

const createMessage = (): UIMessage => ({
	id: "assistant-message-1",
	role: "assistant",
	parts: [{ type: "text", text: "Done." }],
});

const createConvexError = (code: string) =>
	Object.assign(new Error(code), {
		data: { code },
	});

const createSerializedConvexError = (code: string) =>
	new Error(`Uncaught ConvexError: {"code":"${code}"} at mutation`);

const createFinalizerHarness = () => {
	const calls: string[] = [];
	const activeStreamSession = {
		abortSignal: new AbortController().signal,
		cleanup: vi.fn(() => {
			calls.push("cleanup");
		}),
		closePersistence: vi.fn(async () => {
			calls.push("closePersistence");
		}),
	};
	const saveAssistantMessageForRun = vi.fn(async () => {
		calls.push("saveAssistantMessageForRun");
		return { saved: true };
	});
	const finishAssistantRun = vi.fn(async () => {
		calls.push("finishAssistantRun");
	});
	const failAssistantRun = vi.fn(async () => {
		calls.push("failAssistantRun");
	});
	const onCompleted = vi.fn(() => {
		calls.push("onCompleted");
	});
	const onFailed = vi.fn(() => {
		calls.push("onFailed");
	});
	const onFinalizeError = vi.fn();
	const logError = vi.fn();
	const logLatency = vi.fn();

	const finalizeAssistantRun = createHostedAssistantRunFinalizer({
		activeStreamSession,
		assistantMessageId: "assistant-message-1",
		assistantRunId: "assistant-run-1",
		chatId: "chat-1",
		failAssistantRun,
		finishAssistantRun,
		lastUserMessage: null,
		logError,
		logLatency,
		model: "gpt-test",
		noteId: null,
		onCompleted,
		onFailed,
		onFinalizeError,
		reasoningEffort: "low",
		saveAssistantMessageForRun,
		shouldGenerateChatTitle: false,
		updateChatTitle: vi.fn(),
		workspaceId: "workspace-1",
	});

	return {
		activeStreamSession,
		calls,
		failAssistantRun,
		finalizeAssistantRun,
		finishAssistantRun,
		logError,
		onCompleted,
		onFailed,
		onFinalizeError,
		saveAssistantMessageForRun,
	};
};

describe("hosted assistant run finalizer", () => {
	it("saves, closes, finishes, and cleans up completed runs", async () => {
		const harness = createFinalizerHarness();

		await harness.finalizeAssistantRun({
			responseMessage: createMessage(),
			status: "completed",
		});

		expect(harness.saveAssistantMessageForRun).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: "chat-1",
				runId: "assistant-run-1",
				workspaceId: "workspace-1",
			}),
		);
		expect(harness.finishAssistantRun).toHaveBeenCalledWith({
			runId: "assistant-run-1",
		});
		expect(harness.failAssistantRun).not.toHaveBeenCalled();
		expect(harness.calls).toEqual([
			"saveAssistantMessageForRun",
			"closePersistence",
			"finishAssistantRun",
			"onCompleted",
			"cleanup",
		]);
	});

	it("saves completed responses with the assistant run message id", async () => {
		const harness = createFinalizerHarness();

		await harness.finalizeAssistantRun({
			responseMessage: {
				...createMessage(),
				id: "ai-sdk-response-message",
			},
			status: "completed",
		});

		expect(harness.saveAssistantMessageForRun).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.objectContaining({
					id: "assistant-message-1",
				}),
				runId: "assistant-run-1",
			}),
		);
		expect(harness.finishAssistantRun).toHaveBeenCalledWith({
			runId: "assistant-run-1",
		});
	});

	it("cleans up without finishing when the assistant message was already terminal", async () => {
		const harness = createFinalizerHarness();
		harness.saveAssistantMessageForRun.mockImplementationOnce(async () => {
			harness.calls.push("saveAssistantMessageForRun");
			return null;
		});

		await harness.finalizeAssistantRun({
			responseMessage: createMessage(),
			status: "completed",
		});

		expect(harness.finishAssistantRun).not.toHaveBeenCalled();
		expect(harness.failAssistantRun).not.toHaveBeenCalled();
		expect(harness.activeStreamSession.closePersistence).toHaveBeenCalledOnce();
		expect(harness.calls).toEqual([
			"saveAssistantMessageForRun",
			"closePersistence",
			"cleanup",
		]);
	});

	it("fails closed when completed-run stream persistence is missing", async () => {
		const harness = createFinalizerHarness();
		harness.activeStreamSession.closePersistence.mockImplementationOnce(
			async () => {
				harness.calls.push("closePersistence");
				throw createConvexError("ACTIVE_STREAM_NOT_FOUND");
			},
		);

		await expect(
			harness.finalizeAssistantRun({
				responseMessage: createMessage(),
				status: "completed",
			}),
		).rejects.toThrow("ACTIVE_STREAM_NOT_FOUND");

		expect(harness.finishAssistantRun).not.toHaveBeenCalled();
		expect(harness.failAssistantRun).toHaveBeenCalledWith({
			errorText: "ACTIVE_STREAM_NOT_FOUND",
			runId: "assistant-run-1",
		});
		expect(harness.logError).toHaveBeenCalledOnce();
		expect(harness.onFinalizeError).toHaveBeenCalledOnce();
		expect(harness.calls).toEqual([
			"saveAssistantMessageForRun",
			"closePersistence",
			"failAssistantRun",
			"cleanup",
		]);
	});

	it("closes, fails, and cleans up failed runs", async () => {
		const harness = createFinalizerHarness();

		await harness.finalizeAssistantRun({
			errorText: "stream failed",
			status: "failed",
		});

		expect(harness.saveAssistantMessageForRun).not.toHaveBeenCalled();
		expect(harness.failAssistantRun).toHaveBeenCalledWith({
			errorText: "stream failed",
			runId: "assistant-run-1",
		});
		expect(harness.finishAssistantRun).not.toHaveBeenCalled();
		expect(harness.calls).toEqual([
			"closePersistence",
			"failAssistantRun",
			"onFailed",
			"cleanup",
		]);
	});

	it("does not throw when finalize error cleanup races with a terminal run", async () => {
		const harness = createFinalizerHarness();
		harness.activeStreamSession.closePersistence.mockImplementationOnce(
			async () => {
				harness.calls.push("closePersistence");
				throw new Error("persistence failed");
			},
		);
		harness.failAssistantRun.mockImplementationOnce(async () => {
			harness.calls.push("failAssistantRun");
			throw createConvexError("INVALID_ASSISTANT_RUN_TRANSITION");
		});

		await harness.finalizeAssistantRun({
			responseMessage: createMessage(),
			status: "completed",
		});

		expect(harness.onFinalizeError).toHaveBeenCalledOnce();
		expect(harness.failAssistantRun).toHaveBeenCalledWith({
			errorText: "persistence failed",
			runId: "assistant-run-1",
		});
		expect(harness.calls).toEqual([
			"saveAssistantMessageForRun",
			"closePersistence",
			"failAssistantRun",
			"cleanup",
		]);
	});

	it("does not throw when terminal-run race arrives as a serialized Convex error", async () => {
		const harness = createFinalizerHarness();
		harness.activeStreamSession.closePersistence.mockImplementationOnce(
			async () => {
				harness.calls.push("closePersistence");
				throw new Error("persistence failed");
			},
		);
		harness.failAssistantRun.mockImplementationOnce(async () => {
			harness.calls.push("failAssistantRun");
			throw createSerializedConvexError("INVALID_ASSISTANT_RUN_TRANSITION");
		});

		await harness.finalizeAssistantRun({
			responseMessage: createMessage(),
			status: "completed",
		});

		expect(harness.onFinalizeError).toHaveBeenCalledOnce();
		expect(harness.failAssistantRun).toHaveBeenCalledWith({
			errorText: "persistence failed",
			runId: "assistant-run-1",
		});
		expect(harness.calls).toEqual([
			"saveAssistantMessageForRun",
			"closePersistence",
			"failAssistantRun",
			"cleanup",
		]);
	});
});

describe("hosted assistant run finalization queue", () => {
	it("records terminalization without finalizing before flush", async () => {
		const finalizeAssistantRun = vi.fn(async () => {});
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});
		const terminalization = {
			responseMessage: createMessage(),
			status: "completed" as const,
		};

		queue.setTerminalization(terminalization);

		expect(queue.hasTerminalization()).toBe(true);
		expect(finalizeAssistantRun).not.toHaveBeenCalled();

		await queue.flush();

		expect(finalizeAssistantRun).toHaveBeenCalledOnce();
		expect(finalizeAssistantRun).toHaveBeenCalledWith(terminalization);
	});

	it("returns the same finalization promise for repeated flushes", async () => {
		let resolveFinalize: (() => void) | null = null;
		const finalizeAssistantRun = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveFinalize = resolve;
				}),
		);
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});

		queue.setTerminalization({
			responseMessage: createMessage(),
			status: "completed",
		});

		const firstFlush = queue.flush();
		const secondFlush = queue.flush();

		expect(firstFlush).toBe(secondFlush);
		expect(finalizeAssistantRun).toHaveBeenCalledOnce();

		resolveFinalize?.();
		await firstFlush;
	});

	it("clears pending terminalization after a successful flush", async () => {
		const finalizeAssistantRun = vi.fn(async () => {});
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});

		queue.setTerminalization({
			responseMessage: createMessage(),
			status: "completed",
		});

		await queue.flush();
		await queue.flush();

		expect(queue.hasTerminalization()).toBe(false);
		expect(finalizeAssistantRun).toHaveBeenCalledOnce();
	});

	it("keeps failed terminalization pending so a later flush can retry", async () => {
		const finalizeAssistantRun = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient finalize failure"))
			.mockResolvedValueOnce(undefined);
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});
		const terminalization = {
			responseMessage: createMessage(),
			status: "completed" as const,
		};

		queue.setTerminalization(terminalization);

		await expect(queue.flush()).rejects.toThrow("transient finalize failure");
		expect(queue.hasTerminalization()).toBe(true);

		await queue.flush();

		expect(queue.hasTerminalization()).toBe(false);
		expect(finalizeAssistantRun).toHaveBeenCalledTimes(2);
		expect(finalizeAssistantRun).toHaveBeenNthCalledWith(2, terminalization);
	});

	it("awaits completed terminalization before the client stream closes", async () => {
		let resolveFinalize: (() => void) | null = null;
		let didFinalize = false;
		const finalizeAssistantRun = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveFinalize = () => {
						didFinalize = true;
						resolve();
					};
				}),
		);
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});
		const terminalization = {
			responseMessage: createMessage(),
			status: "completed" as const,
		};

		queue.setTerminalization(terminalization);

		const flushPromise = queue.flushAfterClientStream();
		expect(finalizeAssistantRun).toHaveBeenCalledOnce();
		expect(finalizeAssistantRun).toHaveBeenCalledWith(terminalization);
		expect(didFinalize).toBe(false);

		resolveFinalize?.();
		await flushPromise;
		expect(didFinalize).toBe(true);
	});

	it("propagates completed finalization failures before the client stream closes", async () => {
		const finalizeAssistantRun = vi.fn(async () => {
			throw new Error("finalize failed");
		});
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});

		queue.setTerminalization({
			responseMessage: createMessage(),
			status: "completed",
		});

		await expect(queue.flushAfterClientStream()).rejects.toThrow(
			"finalize failed",
		);
		expect(finalizeAssistantRun).toHaveBeenCalledOnce();
	});

	it("awaits failed terminalization before the client stream closes", async () => {
		let didFinalize = false;
		const finalizeAssistantRun = vi.fn(async () => {
			await Promise.resolve();
			didFinalize = true;
		});
		const queue = createHostedAssistantRunFinalizationQueue({
			finalizeAssistantRun,
			logLatency: vi.fn(),
			runId: "assistant-run-1",
		});
		const terminalization = {
			errorText: "stream failed",
			status: "failed" as const,
		};

		queue.setTerminalization(terminalization);

		await queue.flushAfterClientStream();

		expect(didFinalize).toBe(true);
		expect(finalizeAssistantRun).toHaveBeenCalledWith(terminalization);
	});
});
