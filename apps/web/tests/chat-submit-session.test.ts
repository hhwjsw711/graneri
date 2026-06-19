import { describe, expect, it, vi } from "vitest";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import {
	removeChatMessageById,
	submitChatTurn,
} from "@/lib/chat-submit-session";
import type { Id } from "../../../convex/_generated/dataModel";

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;

const createQueuedFollowUpMessage = (text: string): QueuedFollowUpMessage =>
	({
		_id: "queued-message-1" as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-doc-1" as Id<"chats">,
		createdAt: 1,
		messageId: "queued-user-message-1",
		ownerTokenIdentifier: "owner",
		partsJson: JSON.stringify([{ type: "text", text }]),
		requestBodyJson: JSON.stringify({ model: "gpt-5" }),
		runId,
		status: "queued",
		text,
		updatedAt: 1,
		workspaceId,
	}) as QueuedFollowUpMessage;

describe("chat submit session", () => {
	it("sends a prepared turn with an optimistic message", async () => {
		const optimisticMessages: unknown[] = [];
		const preparedRequests: unknown[] = [];
		const events: string[] = [];
		const sendMessage = vi.fn(async () => undefined);

		const result = await submitChatTurn({
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
			onOptimisticMessage: (message) => {
				events.push("optimistic");
				optimisticMessages.push(message);
			},
			onRequestPrepared: (request) => {
				events.push("prepared");
				preparedRequests.push(request);
			},
			sendMessage,
			text: "Summarize this",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(events).toEqual(["prepared", "optimistic"]);
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
		const enqueueQueuedMessage = vi.fn(async ({ message }) =>
			createQueuedFollowUpMessage(message.text),
		);
		const sendMessage = vi.fn();
		const onOptimisticMessage = vi.fn();

		const result = await submitChatTurn({
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

	it("queues follow-ups while a local stream hides the active run", async () => {
		const enqueueQueuedMessage = vi.fn(async ({ message }) =>
			createQueuedFollowUpMessage(message.text),
		);
		const sendMessage = vi.fn();
		const onOptimisticMessage = vi.fn();
		const onQueuedMessageSaved = vi.fn();

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localFolders: [],
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			displayActiveRun: null,
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onQueuedMessageSaved,
			onRequestPrepared: () => undefined,
			queueActiveRun: { _id: runId },
			sendMessage,
			text: "Follow up while first answer streams",
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
					text: "Follow up while first answer streams",
				}),
			}),
		);
		expect(onQueuedMessageSaved).toHaveBeenCalledWith({
			optimisticMessageId: expect.stringMatching(/^queued-/),
			queuedMessage: expect.objectContaining({
				_id: "queued-message-1",
				runId,
				status: "queued",
				text: "Follow up while first answer streams",
			}),
		});
	});

	it("sends normally when active follow-up enqueue races with run completion", async () => {
		const enqueueQueuedMessage = vi.fn(async () => {
			throw new Error(
				'[Request ID: test] Server Error Uncaught ConvexError: {"code":"ASSISTANT_RUN_NOT_ACTIVE","message":"Assistant run is not active."}',
			);
		});
		const sendMessage = vi.fn(async () => undefined);
		const onOptimisticMessage = vi.fn();
		const onQueuedMessageSaved = vi.fn();

		const result = await submitChatTurn({
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
			onQueuedMessageSaved,
			onRequestPrepared: () => undefined,
			sendMessage,
			text: "Follow up after completion",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(enqueueQueuedMessage).toHaveBeenCalledOnce();
		expect(onQueuedMessageSaved).not.toHaveBeenCalled();
		expect(onOptimisticMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.stringMatching(/^queued-/),
				role: "user",
			}),
		);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				messageId: expect.stringMatching(/^queued-/),
				text: "Follow up after completion",
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

	it("preserves non-stale active enqueue failures", async () => {
		const enqueueError = new Error("Queued message belongs to another chat.");
		const enqueueQueuedMessage = vi.fn(async () => {
			throw enqueueError;
		});

		await expect(
			submitChatTurn({
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
				onOptimisticMessage: vi.fn(),
				onRequestPrepared: () => undefined,
				sendMessage: vi.fn(),
				text: "Invalid queued follow up",
				workspaceId,
			}),
		).rejects.toBe(enqueueError);
	});

	it("sends the canonical request body when active state is stale", async () => {
		const preparedRequests: unknown[] = [];
		const sendMessage = vi.fn(async () => undefined);

		const result = await submitChatTurn({
			attachedFiles: [],
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
			onOptimisticMessage: vi.fn(),
			onRequestPrepared: (request) => {
				preparedRequests.push(request);
			},
			sendMessage,
			text: "Send with the canonical request shape",
			workspaceId,
		});

		expect(result.status).toBe("sent");
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
				text: "Send with the canonical request shape",
			}),
			{ body: preparedRequests[0]?.requestBody },
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
