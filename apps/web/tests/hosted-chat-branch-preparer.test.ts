import { describe, expect, it } from "vitest";
import {
	getHostedInterruptedAssistantMessageIds,
	prepareHostedChatTurnBranch,
} from "../../../packages/ai/src/hosted-chat-branch-preparer.mjs";

describe("hosted chat branch preparer", () => {
	it("extracts interrupted assistant message ids from run events", () => {
		expect(
			getHostedInterruptedAssistantMessageIds([
				{
					event: {
						type: "assistant.message.created",
					},
				},
				{
					event: {
						type: "assistant.message.interrupted",
						assistantMessageId: "assistant-1",
					},
				},
			]),
		).toEqual(["assistant-1"]);
	});

	it("loads stored messages, removes interrupted assistant messages, and appends pending input", async () => {
		const latencyStages: string[] = [];
		const result = await prepareHostedChatTurnBranch({
			attachableRunId: "run-1",
			chatId: "chat-1",
			continueRunId: "run-1",
			getMessagesSnapshot: async () => [
				{
					id: "user-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Start" }]),
				},
				{
					id: "assistant-1",
					role: "assistant",
					partsJson: JSON.stringify([{ type: "text", text: "Old answer" }]),
				},
			],
			listRunEventsAfter: async () => [
				{
					event: {
						type: "assistant.message.interrupted",
						assistantMessageId: "assistant-1",
					},
				},
			],
			logLatency: (stage) => latencyStages.push(stage),
			message: {
				id: "user-2",
				role: "user",
				parts: [{ type: "text", text: "Continue" }],
			},
			pendingMessages: [
				{
					id: "steer-1",
					role: "user",
					parts: [{ type: "text", text: "Steer" }],
				},
			],
			trigger: "submit-message",
			truncateFromMessage: async () => undefined,
			workspaceId: "workspace-1",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(
			result.preparedBranch.incomingMessages.map((message) => message.id),
		).toEqual(["user-1", "steer-1", "user-2"]);
		expect(latencyStages).toEqual([
			"convex.messages_loaded",
			"chat.branch_ready",
		]);
	});

	it("supports stateless branches without loading stored messages", async () => {
		let loadedMessages = false;
		const result = await prepareHostedChatTurnBranch({
			chatId: "chat-1",
			getMessagesSnapshot: async () => {
				loadedMessages = true;
				return [];
			},
			listRunEventsAfter: async () => {
				throw new Error("run events should not load");
			},
			messages: [
				{
					id: "existing-1",
					role: "user",
					parts: [{ type: "text", text: "Existing" }],
				},
			],
			shouldLoadStoredMessages: false,
			truncateFromMessage: async () => undefined,
			workspaceId: "workspace-1",
		});

		expect(loadedMessages).toBe(false);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(
			result.preparedBranch.incomingMessages.map((message) => message.id),
		).toEqual(["existing-1"]);
	});

	it("lets routes handle truncate failures without continuing the run", async () => {
		const handledMessageIds: string[] = [];
		const result = await prepareHostedChatTurnBranch({
			chatId: "chat-1",
			getMessagesSnapshot: async () => [
				{
					id: "user-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Original" }]),
				},
			],
			listRunEventsAfter: async () => [],
			message: {
				id: "user-2",
				role: "user",
				parts: [{ type: "text", text: "Edited" }],
			},
			messageId: "user-1",
			onTruncateError: ({ messageId }) => {
				handledMessageIds.push(messageId);
				return true;
			},
			trigger: "submit-message",
			truncateFromMessage: async () => {
				throw new Error("truncate failed");
			},
			workspaceId: "workspace-1",
		});

		expect(result).toEqual({
			ok: false,
			reason: "truncate_error_handled",
		});
		expect(handledMessageIds).toEqual(["user-1"]);
	});
});
