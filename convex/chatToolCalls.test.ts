import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return {
		asOwner,
		t,
		workspaceId,
	};
};

test("active stream tool calls persist lifecycle for the current stream", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-tools",
		preview: "Search for a note",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Search for a note" }]),
			text: "Search for a note",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId: "chat-tools",
		messageId: "stream-1",
	});

	const startedToolCall = await asOwner.mutation(
		api.chatToolCalls.startActiveStreamToolCall,
		{
			workspaceId,
			chatId: "chat-tools",
			messageId: "stream-1",
			toolCallId: "tool-call-1",
			toolName: "search",
			inputJson: JSON.stringify({ query: "note" }),
		},
	);

	expect(startedToolCall.status).toBe("pending");
	expect(startedToolCall.toolName).toBe("search");
	expect(startedToolCall.inputJson).toBe(JSON.stringify({ query: "note" }));

	const completedToolCall = await asOwner.mutation(
		api.chatToolCalls.finishActiveStreamToolCall,
		{
			workspaceId,
			chatId: "chat-tools",
			messageId: "stream-1",
			toolCallId: "tool-call-1",
			status: "completed",
			outputJson: JSON.stringify({ result: "found" }),
		},
	);

	expect(completedToolCall.status).toBe("completed");
	expect(completedToolCall.outputJson).toBe(JSON.stringify({ result: "found" }));

	const storedToolCalls = await t.run(async (ctx) =>
		ctx.db
			.query("chatToolCalls")
			.withIndex("by_chatId_and_createdAt", (q) =>
				q.eq("chatId", startedToolCall.chatId),
			)
			.take(10),
	);
	expect(storedToolCalls).toHaveLength(1);
	expect(storedToolCalls[0]?.messageId).toBe("stream-1");
});

test("active stream tool calls reject stale stream message ids", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-tools-stale",
		preview: "Search for a note",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Search for a note" }]),
			text: "Search for a note",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId: "chat-tools-stale",
		messageId: "stream-current",
	});

	await expect(
		asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
			workspaceId,
			chatId: "chat-tools-stale",
			messageId: "stream-stale",
			toolCallId: "tool-call-1",
			toolName: "search",
		}),
	).rejects.toThrow("Active chat stream not found.");
});
