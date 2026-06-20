import { describe, expect, it, vi } from "vitest";
import { createHostedChatTurnController } from "../../../packages/ai/src/hosted-chat-turn-controller.mjs";

const userMessage = (id: string, text: string) => ({
	id,
	role: "user",
	parts: [{ type: "text", text }],
});

const createQueuedInput = ({
	claimSteer = vi.fn(),
	cleanupClaimed = vi.fn(async () => ({ ok: true })),
	loadClaimedReplay = vi.fn(),
} = {}) => ({
	claimSteer,
	cleanupClaimed,
	loadClaimedReplay,
});

const createController = ({
	attachableRun = { _id: "run-1", status: "running" },
	interruptActiveRun = vi.fn(async () => []),
	queuedInput = createQueuedInput(),
	validateInput = vi.fn(() => ({ ok: true })),
} = {}) =>
	createHostedChatTurnController({
		attachableRun,
		chatId: "chat-1",
		interruptActiveRun,
		queuedInput,
		validateInput,
		workspaceId: "workspace-1",
	});

describe("hosted chat turn controller", () => {
	it("claims and interrupts running turns before returning steered input", async () => {
		const firstMessage = userMessage("queued-1", "First");
		const secondMessage = userMessage("queued-2", "Second");
		const pendingMessage = userMessage("queued-pending", "Pending");
		const queuedInput = createQueuedInput({
			claimSteer: vi.fn(async () => ({
				claimedMessages: [{ _id: "queued-1" }, { _id: "queued-2" }],
				userMessage: secondMessage,
				userMessages: [firstMessage, secondMessage],
			})),
		});
		const interruptActiveRun = vi.fn(async () => [pendingMessage]);
		const controller = createController({ interruptActiveRun, queuedInput });

		const result = await controller.prepareInput({
			continueRunId: "run-1",
			steerQueuedMessageId: "queued-1",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected turn input preparation to succeed");
		}
		expect(queuedInput.claimSteer).toHaveBeenCalledWith({
			runId: "run-1",
			queuedMessageId: "queued-1",
		});
		expect(interruptActiveRun).toHaveBeenCalledWith({
			chatId: "chat-1",
			pendingInput: [firstMessage, secondMessage],
			runId: "run-1",
			workspaceId: "workspace-1",
		});
		expect(result.effectiveMessage).toBe(secondMessage);
		expect(result.pendingSteerMessages).toEqual([pendingMessage]);
		expect(result.steeredUserMessages).toEqual([firstMessage, secondMessage]);
	});

	it("does not interrupt waiting turns", async () => {
		const message = userMessage("queued-1", "Waiting input");
		const queuedInput = createQueuedInput({
			claimSteer: vi.fn(async () => ({
				claimedMessages: [{ _id: "queued-1" }],
				userMessage: message,
				userMessages: [message],
			})),
		});
		const interruptActiveRun = vi.fn();
		const controller = createController({
			attachableRun: { _id: "run-1", status: "waiting_for_user" },
			interruptActiveRun,
			queuedInput,
		});

		const result = await controller.prepareInput({
			continueRunId: "run-1",
			steerQueuedMessageId: "queued-1",
		});

		expect(result.ok).toBe(true);
		expect(interruptActiveRun).not.toHaveBeenCalled();
		if (!result.ok) {
			throw new Error("expected turn input preparation to succeed");
		}
		expect(result.pendingSteerMessages).toEqual([message]);
	});

	it("loads claimed replay input without steering an active turn", async () => {
		const message = userMessage("queued-replay", "Replay");
		const queuedInput = createQueuedInput({
			loadClaimedReplay: vi.fn(async () => message),
		});
		const controller = createController({
			attachableRun: null,
			queuedInput,
		});

		const result = await controller.prepareInput({
			replayQueuedMessageId: "queued-replay",
		});

		expect(result.ok).toBe(true);
		expect(queuedInput.loadClaimedReplay).toHaveBeenCalledWith({
			queuedMessageId: "queued-replay",
		});
		if (!result.ok) {
			throw new Error("expected replay input preparation to succeed");
		}
		expect(result.effectiveMessage).toBe(message);
		expect(result.pendingSteerMessages).toEqual([]);
	});

	it("cleans claimed steer input when interruption fails", async () => {
		const message = userMessage("queued-1", "Steer");
		const interruptError = new Error("interrupt failed");
		const queuedInput = createQueuedInput({
			claimSteer: vi.fn(async () => ({
				claimedMessages: [{ _id: "queued-1" }],
				userMessage: message,
				userMessages: [message],
			})),
			cleanupClaimed: vi.fn(async () => ({ ok: true })),
		});
		const controller = createController({
			interruptActiveRun: vi.fn(async () => {
				throw interruptError;
			}),
			queuedInput,
		});

		const result = await controller.prepareInput({
			continueRunId: "run-1",
			steerQueuedMessageId: "queued-1",
		});

		expect(result).toMatchObject({
			ok: false,
			cause: interruptError,
			error: "Failed to interrupt active assistant run.",
			phase: "active_run_interrupt_failed",
			statusCode: 500,
		});
		expect(queuedInput.cleanupClaimed).toHaveBeenCalledWith({
			tolerateMissing: false,
		});
	});

	it("reports cleanup failure instead of hiding claimed steer leftovers", async () => {
		const message = userMessage("queued-1", "Steer");
		const cleanupError = new Error("cleanup failed");
		const queuedInput = createQueuedInput({
			claimSteer: vi.fn(async () => ({
				claimedMessages: [{ _id: "queued-1" }],
				userMessage: message,
				userMessages: [message],
			})),
			cleanupClaimed: vi.fn(async () => ({
				error: cleanupError,
				ok: false,
				queuedMessageIds: ["queued-1"],
			})),
		});
		const controller = createController({
			interruptActiveRun: vi.fn(async () => {
				throw new Error("interrupt failed");
			}),
			queuedInput,
		});

		const result = await controller.prepareInput({
			continueRunId: "run-1",
			steerQueuedMessageId: "queued-1",
		});

		expect(result).toMatchObject({
			cleanupError,
			error: "Failed to clean up claimed steered message.",
			ok: false,
			phase: "steer_queue_cleanup_failed",
			statusCode: 500,
		});
	});
});
