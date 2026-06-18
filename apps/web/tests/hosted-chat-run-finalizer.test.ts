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
		expect(harness.activeStreamSession.closePersistence).not.toHaveBeenCalled();
		expect(harness.calls).toEqual(["saveAssistantMessageForRun", "cleanup"]);
	});

	it("finishes completed runs when stream persistence was already removed", async () => {
		const harness = createFinalizerHarness();
		harness.activeStreamSession.closePersistence.mockImplementationOnce(
			async () => {
				harness.calls.push("closePersistence");
				throw createConvexError("ACTIVE_STREAM_NOT_FOUND");
			},
		);

		await harness.finalizeAssistantRun({
			responseMessage: createMessage(),
			status: "completed",
		});

		expect(harness.finishAssistantRun).toHaveBeenCalledWith({
			runId: "assistant-run-1",
		});
		expect(harness.failAssistantRun).not.toHaveBeenCalled();
		expect(harness.logError).not.toHaveBeenCalled();
		expect(harness.calls).toEqual([
			"saveAssistantMessageForRun",
			"closePersistence",
			"finishAssistantRun",
			"onCompleted",
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
});
