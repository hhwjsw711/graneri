import { describe, expect, it, vi } from "vitest";
import {
	removeChatMessageById,
	submitChatTurn,
} from "@/lib/chat-submit-session";
import type { Id } from "../../../convex/_generated/dataModel";

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;

describe("chat submit session", () => {
	it("sends a prepared turn with an optimistic message", async () => {
		const optimisticMessages: unknown[] = [];
		const preparedRequests: unknown[] = [];
		const sendMessage = vi.fn(async () => undefined);

		const result = await submitChatTurn({
			activeRun: null,
			attachedFiles: [
				{
					id: "attachment-1",
					type: "file",
					mediaType: "text/plain",
					filename: "notes.txt",
					url: "convex://file",
					uploadStatus: "ready",
				},
			],
			buildRequestBody: async () => ({
				convexToken: "token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			displayActiveRun: null,
			editingMessageId: null,
			enqueueQueuedMessage: vi.fn(),
			metadata: { source: "test" },
			onOptimisticMessage: (message) => optimisticMessages.push(message),
			onRequestPrepared: (request) => preparedRequests.push(request),
			sendMessage,
			text: "Summarize this",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(optimisticMessages).toHaveLength(1);
		expect(preparedRequests).toEqual([
			{
				localFolders: [],
				requestBody: {
					convexToken: "token",
					localFolders: [],
					model: "gpt-5",
					timezone: "UTC",
				},
			},
		]);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [
					expect.objectContaining({
						filename: "notes.txt",
						mediaType: "text/plain",
						type: "file",
						url: "convex://file",
					}),
				],
				metadata: { source: "test" },
				text: "Summarize this",
			}),
			{
				body: {
					convexToken: "token",
					localFolders: [],
					model: "gpt-5",
					timezone: "UTC",
				},
			},
		);
	});

	it("queues follow-ups against the visible active run", async () => {
		const enqueueQueuedMessage = vi.fn(async () => undefined);
		const sendMessage = vi.fn();
		const onOptimisticMessage = vi.fn();

		const result = await submitChatTurn({
			activeRun: { _id: runId },
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			displayActiveRun: { _id: runId },
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onRequestPrepared: () => undefined,
			optimisticQueuedMessage: false,
			sendMessage,
			text: "Follow up",
			workspaceId,
		});

		expect(result.status).toBe("queued");
		expect(sendMessage).not.toHaveBeenCalled();
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(enqueueQueuedMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: "chat-1",
				runId,
				workspaceId,
				message: expect.objectContaining({
					text: "Follow up",
				}),
			}),
		);
	});

	it("removes optimistic messages by id", () => {
		expect(
			removeChatMessageById(
				[
					{ id: "keep", role: "user", parts: [] },
					{ id: "remove", role: "user", parts: [] },
				],
				"remove",
			),
		).toEqual([{ id: "keep", role: "user", parts: [] }]);
	});
});
