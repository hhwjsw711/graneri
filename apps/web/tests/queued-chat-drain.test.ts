import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { drainQueuedChatMessage } from "../src/lib/queued-chat-intent";

const workspaceId = "workspace-1" as Id<"workspaces">;
const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;

const createQueuedMessage = () => ({
	_id: queuedMessageId,
	_creationTime: 1,
	chatId: "chat-1",
	claimedAt: undefined,
	createdAt: 1,
	messageId: "queued-message-1",
	ownerTokenIdentifier: "owner",
	partsJson: JSON.stringify([{ type: "text", text: "Queued" }]),
	requestBodyJson: JSON.stringify({ model: "gpt-5" }),
	runId: "run-1" as Id<"assistantRuns">,
	status: "claimed" as const,
	text: "Queued",
	updatedAt: 1,
	workspaceId,
});

const createDrainArgs = (
	overrides: Partial<Parameters<typeof drainQueuedChatMessage>[0]> = {},
) => ({
	workspaceId,
	chatId: "chat-1",
	claimQueuedMessage: vi.fn().mockResolvedValue(createQueuedMessage()),
	discardClaimedMessage: vi.fn().mockResolvedValue(null),
	hasMessageId: vi.fn().mockReturnValue(false),
	pendingDiscardClaimedMessageId: null,
	queuedMessageCount: 1,
	resolveConvexToken: vi.fn().mockResolvedValue("fresh-token"),
	sendMessage: vi.fn().mockResolvedValue(null),
	setLatestRequestBody: vi.fn(),
	...overrides,
});

describe("queued chat drain", () => {
	it("waits for a Convex token before claiming queued messages", async () => {
		const args = createDrainArgs({
			resolveConvexToken: vi.fn().mockResolvedValue(null),
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			pendingDiscardClaimedMessageId: null,
			status: "retry",
		});
		expect(args.claimQueuedMessage).not.toHaveBeenCalled();
		expect(args.discardClaimedMessage).not.toHaveBeenCalled();
	});

	it("claims, prepares, and sends a queued message", async () => {
		const args = createDrainArgs();

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			pendingDiscardClaimedMessageId: null,
			status: "sent",
		});
		expect(args.claimQueuedMessage).toHaveBeenCalledWith({
			workspaceId,
			chatId: "chat-1",
		});
		expect(args.setLatestRequestBody).toHaveBeenCalledWith({
			convexToken: "fresh-token",
			model: "gpt-5",
			replayQueuedMessageId: queuedMessageId,
		});
		expect(args.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Queued",
			}),
			{
				body: {
					convexToken: "fresh-token",
					model: "gpt-5",
					replayQueuedMessageId: queuedMessageId,
				},
			},
		);
		expect(args.discardClaimedMessage).not.toHaveBeenCalled();
	});

	it("retries pending claimed cleanup before claiming more work", async () => {
		const cleanupError = new Error("discard failed");
		const args = createDrainArgs({
			discardClaimedMessage: vi.fn().mockRejectedValue(cleanupError),
			pendingDiscardClaimedMessageId: queuedMessageId,
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			error: cleanupError,
			pendingDiscardClaimedMessageId: queuedMessageId,
			status: "cleanup_failed",
		});
		expect(args.discardClaimedMessage).toHaveBeenCalledWith({
			workspaceId,
			chatId: "chat-1",
			queuedMessageId,
		});
		expect(args.claimQueuedMessage).not.toHaveBeenCalled();
	});

	it("discards a claimed queued message after send failure", async () => {
		const sendError = new Error("send failed");
		const args = createDrainArgs({
			sendMessage: vi.fn().mockRejectedValue(sendError),
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			error: sendError,
			pendingDiscardClaimedMessageId: null,
			status: "send_failed",
		});
		expect(args.discardClaimedMessage).toHaveBeenCalledWith({
			workspaceId,
			chatId: "chat-1",
			queuedMessageId,
		});
	});

	it("keeps claimed cleanup pending when send-failure cleanup fails", async () => {
		const discardError = new Error("discard failed");
		const args = createDrainArgs({
			sendMessage: vi.fn().mockRejectedValue(new Error("send failed")),
			discardClaimedMessage: vi.fn().mockRejectedValue(discardError),
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			error: discardError,
			pendingDiscardClaimedMessageId: queuedMessageId,
			status: "cleanup_failed",
		});
	});
});
