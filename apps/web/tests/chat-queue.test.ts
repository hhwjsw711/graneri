import { describe, expect, it } from "vitest";
import {
	createQueuedUserMessageId,
	fromQueuedUserMessage,
	toQueuedUserMessageInput,
} from "@/lib/chat-queue";

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
