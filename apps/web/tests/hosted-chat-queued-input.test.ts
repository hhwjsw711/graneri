import { describe, expect, it, vi } from "vitest";
import { createHostedChatQueuedInput } from "../../../packages/ai/src/hosted-chat-queued-input.mjs";

const queuedMessage = ({
	id,
	messageId,
	text,
}: {
	id: string;
	messageId: string;
	text: string;
}) => ({
	_id: id,
	messageId,
	partsJson: JSON.stringify([{ type: "text", text }]),
});

describe("hosted chat queued input", () => {
	it("claims steered queued messages and exposes the accepted batch", async () => {
		const claimReadyForRun = vi.fn().mockResolvedValue([
			queuedMessage({
				id: "queued-1",
				messageId: "message-1",
				text: "first",
			}),
			queuedMessage({
				id: "queued-2",
				messageId: "message-2",
				text: "second",
			}),
		]);
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimReadyForRun,
			discardClaimed: vi.fn(),
			getClaimedForChat: vi.fn(),
		});

		const claimed = await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-2",
		});

		expect(claimReadyForRun).toHaveBeenCalledWith({
			runId: "run-1",
			queuedMessageId: "queued-2",
		});
		expect(queuedInput.hasClaimed).toBe(true);
		expect(queuedInput.claimedQueuedMessageId).toBe("queued-1");
		expect(queuedInput.claimedQueuedMessageIds).toEqual([
			"queued-1",
			"queued-2",
		]);
		expect(claimed.userMessages).toMatchObject([
			{
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "first" }],
			},
			{
				id: "message-2",
				role: "user",
				parts: [{ type: "text", text: "second" }],
			},
		]);
		expect(claimed.userMessage).toMatchObject({
			id: "message-2",
			role: "user",
		});
	});

	it("loads a claimed replay message for the same workspace and chat", async () => {
		const getClaimedForChat = vi.fn().mockResolvedValue(
			queuedMessage({
				id: "queued-1",
				messageId: "message-1",
				text: "replay me",
			}),
		);
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimReadyForRun: vi.fn(),
			discardClaimed: vi.fn(),
			getClaimedForChat,
		});

		await expect(
			queuedInput.loadClaimedReplay({ queuedMessageId: "queued-1" }),
		).resolves.toMatchObject({
			id: "message-1",
			role: "user",
			parts: [{ type: "text", text: "replay me" }],
		});
		expect(getClaimedForChat).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			queuedMessageId: "queued-1",
		});
	});

	it("discards every claimed queued message and clears local claim state", async () => {
		const discardClaimed = vi.fn().mockResolvedValue(null);
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimReadyForRun: vi.fn().mockResolvedValue([
				queuedMessage({
					id: "queued-1",
					messageId: "message-1",
					text: "first",
				}),
				queuedMessage({
					id: "queued-2",
					messageId: "message-2",
					text: "second",
				}),
			]),
			discardClaimed,
			getClaimedForChat: vi.fn(),
		});

		await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-2",
		});

		await expect(queuedInput.cleanupClaimed()).resolves.toEqual({
			ok: true,
			cleaned: true,
		});
		expect(discardClaimed).toHaveBeenCalledTimes(2);
		expect(discardClaimed).toHaveBeenNthCalledWith(1, {
			workspaceId: "workspace-1",
			chatId: "chat-1",
			queuedMessageId: "queued-1",
		});
		expect(discardClaimed).toHaveBeenNthCalledWith(2, {
			workspaceId: "workspace-1",
			chatId: "chat-1",
			queuedMessageId: "queued-2",
		});
		expect(queuedInput.hasClaimed).toBe(false);
	});

	it("can tolerate missing queued messages during cleanup", async () => {
		const discardError = new Error(
			'Uncaught ConvexError: {"code":"QUEUED_MESSAGE_NOT_FOUND","message":"Queued message is no longer available."} at handler',
		);
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimReadyForRun: vi.fn().mockResolvedValue([
				queuedMessage({
					id: "queued-1",
					messageId: "message-1",
					text: "first",
				}),
			]),
			discardClaimed: vi.fn().mockRejectedValue(discardError),
			getClaimedForChat: vi.fn(),
		});

		await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-1",
		});

		await expect(
			queuedInput.cleanupClaimed({ tolerateMissing: true }),
		).resolves.toEqual({
			ok: true,
			cleaned: true,
		});
		expect(queuedInput.hasClaimed).toBe(false);
	});
});
