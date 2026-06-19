import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedChatDrain } from "../src/hooks/use-queued-chat-drain";
import { resetQueuedFollowUpsCacheForTest } from "../src/lib/chat-queued-followups";

const convexMocks = vi.hoisted(() => ({
	claimNextForChat: vi.fn(),
	discardClaimed: vi.fn(),
	listQueuedForChat: [] as unknown,
	mutationCallIndex: 0,
}));

const tokenMocks = vi.hoisted(() => ({
	getCachedConvexToken: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: () => {
		const mutationCallIndex = convexMocks.mutationCallIndex;
		convexMocks.mutationCallIndex += 1;
		if (mutationCallIndex % 2 === 0) {
			return convexMocks.claimNextForChat;
		}
		return convexMocks.discardClaimed;
	},
	useQuery: () => convexMocks.listQueuedForChat,
}));

vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: tokenMocks.getCachedConvexToken,
}));

describe("useQueuedChatDrain", () => {
	beforeEach(() => {
		convexMocks.claimNextForChat.mockReset();
		convexMocks.discardClaimed.mockReset();
		convexMocks.mutationCallIndex = 0;
		tokenMocks.getCachedConvexToken.mockReset();
		resetQueuedFollowUpsCacheForTest();
		convexMocks.listQueuedForChat = [
			{
				_id: "queued-1",
				_creationTime: 1,
				chatId: "chat-doc-1",
				claimedAt: undefined,
				createdAt: 1,
				messageId: "queued-message-1",
				ownerTokenIdentifier: "owner",
				partsJson: JSON.stringify([{ type: "text", text: "Queued" }]),
				requestBodyJson: JSON.stringify({ model: "gpt-5" }),
				runId: "run-1",
				status: "queued",
				text: "Queued",
				updatedAt: 1,
				workspaceId: "workspace-1",
			},
		];
	});

	afterEach(() => {
		resetQueuedFollowUpsCacheForTest();
	});

	it("does not claim queued messages until a Convex token is available", async () => {
		tokenMocks.getCachedConvexToken.mockResolvedValue(null);

		renderHook(() =>
			useQueuedChatDrain({
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage: vi.fn(),
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(tokenMocks.getCachedConvexToken).toHaveBeenCalled();
		});
		expect(convexMocks.claimNextForChat).not.toHaveBeenCalled();
		expect(convexMocks.discardClaimed).not.toHaveBeenCalled();
	});

	it("claims and sends queued messages after token preflight", async () => {
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		const queuedMessage = (
			convexMocks.listQueuedForChat as Array<{
				_id: Id<"assistantQueuedMessages">;
			}>
		)[0];
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		convexMocks.claimNextForChat.mockResolvedValue(queuedMessage);
		convexMocks.discardClaimed.mockResolvedValue(null);

		renderHook(() =>
			useQueuedChatDrain({
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalled();
		});
		expect(convexMocks.claimNextForChat).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
		});
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Queued",
			}),
			{
				body: {
					convexToken: "fresh-token",
					model: "gpt-5",
					replayQueuedMessageId: "queued-1",
				},
			},
		);
		expect(convexMocks.discardClaimed).not.toHaveBeenCalled();
	});

	it("retries failed claimed cleanup before claiming another queued message", async () => {
		const sendMessage = vi.fn().mockRejectedValue(new Error("send failed"));
		const queuedMessage = (
			convexMocks.listQueuedForChat as Array<{
				_id: Id<"assistantQueuedMessages">;
			}>
		)[0];
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		convexMocks.claimNextForChat.mockResolvedValue(queuedMessage);
		convexMocks.discardClaimed
			.mockRejectedValueOnce(new Error("discard failed"))
			.mockResolvedValueOnce(null);

		renderHook(() =>
			useQueuedChatDrain({
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(convexMocks.discardClaimed).toHaveBeenCalledTimes(1);
		});

		convexMocks.listQueuedForChat = [];

		await waitFor(
			() => {
				expect(convexMocks.discardClaimed).toHaveBeenCalledTimes(2);
			},
			{ timeout: 1500 },
		);
		expect(convexMocks.claimNextForChat).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(convexMocks.discardClaimed).toHaveBeenLastCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			queuedMessageId: "queued-1",
		});
	});
});
