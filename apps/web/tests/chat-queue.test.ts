import { describe, expect, it } from "vitest";
import {
	createQueuedUserMessageId,
	fromQueuedUserMessage,
	toQueuedUserMessageInput,
} from "@/lib/chat-queue";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	getQueuedFollowUpCacheKey,
	type QueuedFollowUpMessage,
	readQueuedFollowUpsCache,
	resetQueuedFollowUpsCacheForTest,
	shouldDrainQueuedFollowUp,
	subscribeQueuedFollowUpsCache,
	updateQueuedFollowUpsCache,
	writeQueuedFollowUpsCache,
} from "../src/lib/chat-queued-followups";

const workspaceId = "workspace-1" as Id<"workspaces">;

const createQueuedFollowUp = (
	id: string,
	overrides: Partial<QueuedFollowUpMessage> = {},
): QueuedFollowUpMessage =>
	({
		_id: id as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-1",
		claimedAt: undefined,
		createdAt: 1,
		messageId: id,
		metadataJson: undefined,
		requestBodyJson: "{}",
		runId: "run-1" as Id<"assistantRuns">,
		text: `message ${id}`,
		workspaceId,
		...overrides,
	}) as QueuedFollowUpMessage;

describe("chat queue serialization", () => {
	it("does not persist desktop local folder scope in durable queued messages", () => {
		expect(() =>
			toQueuedUserMessageInput({
				requestBody: {
					convexToken: "token",
					localFolders: [
						{
							id: "folder-1",
							name: "Documents",
							path: "/Users/example/Documents",
						},
					],
					model: "gpt-5",
					timezone: "UTC",
				},
				text: "Use this folder next",
			}),
		).toThrow(
			"Wait for the current answer before sending follow-ups that use local folders.",
		);
	});

	it("removes the cached Convex token before persisting queued request state", () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				convexToken: "token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			},
			text: "Follow up",
		});

		expect(JSON.parse(queuedMessage.requestBodyJson)).toMatchObject({
			convexToken: null,
			localFolders: [],
			model: "gpt-5",
		});
	});

	it("restores queued request state with a fresh Convex token", async () => {
		const queuedMessage = toQueuedUserMessageInput({
			metadata: { selectedModel: "gpt-5" },
			requestBody: {
				convexToken: "stale-token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			},
			text: "Follow up",
		});

		const prepared = await fromQueuedUserMessage({
			queuedMessage,
			resolveConvexToken: async () => "fresh-token",
		});

		expect(prepared.body).toMatchObject({
			convexToken: "fresh-token",
			model: "gpt-5",
		});
		expect(prepared.message.messageId).toBeUndefined();
		expect(prepared.message.metadata).toEqual({ selectedModel: "gpt-5" });
		expect(prepared.message.text).toBe("Follow up");
	});

	it("preserves explicit queued message ids for edit replays", async () => {
		const queuedMessage = toQueuedUserMessageInput({
			messageId: "existing-user-message",
			requestBody: {
				convexToken: "stale-token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			},
			text: "Edited follow up",
		});

		const prepared = await fromQueuedUserMessage({
			queuedMessage,
			resolveConvexToken: async () => "fresh-token",
		});

		expect(prepared.message.messageId).toBe("existing-user-message");
		expect(prepared.message.text).toBe("Edited follow up");
	});

	it("preserves generated queued message ids when they already exist locally", async () => {
		const messageId = createQueuedUserMessageId();
		const queuedMessage = toQueuedUserMessageInput({
			messageId,
			requestBody: {
				convexToken: "stale-token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			},
			text: "Visible follow up",
		});

		const prepared = await fromQueuedUserMessage({
			hasMessageId: (candidateMessageId) => candidateMessageId === messageId,
			queuedMessage,
			resolveConvexToken: async () => "fresh-token",
		});

		expect(prepared.message.messageId).toBe(messageId);
		expect(prepared.message.text).toBe("Visible follow up");
	});

	it("rejects invalid queued request body shapes at the boundary", async () => {
		await expect(
			fromQueuedUserMessage({
				queuedMessage: {
					messageId: "queued-1",
					requestBodyJson: "[]",
					text: "Follow up",
				},
				resolveConvexToken: async () => "fresh-token",
			}),
		).rejects.toThrow("Queued chat request body is invalid.");
	});
});

describe("queued follow-up lifecycle", () => {
	it("scopes visible queued messages by workspace and chat", () => {
		resetQueuedFollowUpsCacheForTest();
		const cacheKey = getQueuedFollowUpCacheKey({
			chatId: "chat-1",
			workspaceId,
		});
		const otherCacheKey = getQueuedFollowUpCacheKey({
			chatId: "chat-2",
			workspaceId,
		});
		const queuedMessage = createQueuedFollowUp("queued-1");

		writeQueuedFollowUpsCache(cacheKey, [queuedMessage]);

		expect(readQueuedFollowUpsCache(cacheKey)).toEqual([queuedMessage]);
		expect(readQueuedFollowUpsCache(otherCacheKey)).toEqual([]);
	});

	it("notifies visible queue subscribers when cached messages change", () => {
		resetQueuedFollowUpsCacheForTest();
		const cacheKey = getQueuedFollowUpCacheKey({
			chatId: "chat-1",
			workspaceId,
		});
		let notificationCount = 0;
		const unsubscribe = subscribeQueuedFollowUpsCache(cacheKey, () => {
			notificationCount += 1;
		});

		writeQueuedFollowUpsCache(cacheKey, [createQueuedFollowUp("queued-1")]);
		updateQueuedFollowUpsCache(cacheKey, (messages) => [
			...messages,
			createQueuedFollowUp("queued-2"),
		]);
		unsubscribe();
		writeQueuedFollowUpsCache(cacheKey, []);

		expect(notificationCount).toBe(2);
		expect(readQueuedFollowUpsCache(cacheKey)).toEqual([]);
	});

	it("drains only when a workspace has queued work and no active blocker", () => {
		expect(
			shouldDrainQueuedFollowUp({
				activeRun: null,
				hasQueuedMessage: true,
				isBlocked: false,
				isDraining: false,
				workspaceId,
			}),
		).toBe(true);
		expect(
			shouldDrainQueuedFollowUp({
				activeRun: { _id: "run-1" },
				hasQueuedMessage: true,
				isBlocked: false,
				isDraining: false,
				workspaceId,
			}),
		).toBe(false);
		expect(
			shouldDrainQueuedFollowUp({
				activeRun: null,
				hasQueuedMessage: false,
				isBlocked: false,
				isDraining: false,
				workspaceId,
			}),
		).toBe(false);
		expect(
			shouldDrainQueuedFollowUp({
				activeRun: null,
				hasQueuedMessage: true,
				isBlocked: true,
				isDraining: false,
				workspaceId,
			}),
		).toBe(false);
		expect(
			shouldDrainQueuedFollowUp({
				activeRun: null,
				hasQueuedMessage: true,
				isBlocked: false,
				isDraining: true,
				workspaceId,
			}),
		).toBe(false);
		expect(
			shouldDrainQueuedFollowUp({
				activeRun: null,
				hasQueuedMessage: true,
				isBlocked: false,
				isDraining: false,
				workspaceId: null,
			}),
		).toBe(false);
	});
});
