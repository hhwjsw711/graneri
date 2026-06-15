import { describe, expect, it } from "vitest";
import { toQueuedUserMessageInput } from "@/lib/chat-queue";

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
});
