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

test("chat titles preserve organization and person name capitalization", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-1",
		title: "openAI acquisition of Cirrus Labs",
		preview: "Why did OpenAI acquire Cirrus Labs?",
		message: {
			id: "msg-1",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Why did OpenAI acquire Cirrus Labs?" },
			]),
			text: "Why did OpenAI acquire Cirrus Labs?",
			createdAt: 2_000,
		},
	});

	const session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-1",
	});

	expect(session).not.toBeNull();
	expect(session?.title).toBe("OpenAI acquisition of Cirrus Labs");
	expect(session?.preview).toBe("Why did OpenAI acquire Cirrus Labs?");
});

test("new chats use one placeholder title before generated title arrives", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-title-lifecycle",
		preview: "Summarize yesterday's meeting",
		message: {
			id: "msg-title-lifecycle-1",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Summarize yesterday's meeting" },
			]),
			text: "Summarize yesterday's meeting",
			createdAt: 2_000,
		},
	});

	let session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-title-lifecycle",
	});

	expect(session?.title).toBe("New chat");

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-title-lifecycle",
		title: "Meeting summary",
		preview: "Here is the summary.",
		message: {
			id: "msg-title-lifecycle-2",
			role: "assistant",
			partsJson: JSON.stringify([
				{ type: "text", text: "Here is the summary." },
			]),
			text: "Here is the summary.",
			createdAt: 3_000,
		},
	});

	session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-title-lifecycle",
	});

	expect(session?.title).toBe("Meeting summary");
});

test("explicit chat renames persist after saving", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-rename",
		title: "Original chat title",
		preview: "Original preview",
		message: {
			id: "msg-rename-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Original message" }]),
			text: "Original message",
			createdAt: 2_000,
		},
	});

	const result = await asOwner.mutation(api.chats.updateTitle, {
		workspaceId,
		chatId: "chat-rename",
		title: "Renamed chat title",
	});

	expect(result.title).toBe("Renamed chat title");

	const session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-rename",
	});

	expect(session).not.toBeNull();
	expect(session?.title).toBe("Renamed chat title");
});

test("chat star state toggles and persists", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-star",
		preview: "Prompt",
		message: {
			id: "msg-star-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});

	const firstToggle = await asOwner.mutation(api.chats.toggleStar, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(firstToggle.isStarred).toBe(true);

	let session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(session?.isStarred).toBe(true);

	const secondToggle = await asOwner.mutation(api.chats.toggleStar, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(secondToggle.isStarred).toBe(false);

	session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(session?.isStarred).toBe(false);
});

test("truncating from an edited message removes that branch of the chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-edit",
		preview: "First prompt",
		message: {
			id: "msg-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "First prompt" }]),
			text: "First prompt",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-edit",
		preview: "First answer",
		message: {
			id: "msg-2",
			role: "assistant",
			partsJson: JSON.stringify([{ type: "text", text: "First answer" }]),
			text: "First answer",
			createdAt: 2_100,
		},
	});
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-edit",
		preview: "Second prompt",
		message: {
			id: "msg-3",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Second prompt" }]),
			text: "Second prompt",
			createdAt: 2_200,
		},
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId: "chat-edit",
		messageId: "stream-1",
	});
	await asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
		workspaceId,
		chatId: "chat-edit",
		messageId: "stream-1",
		toolCallId: "tool-call-1",
		toolName: "search",
		inputJson: JSON.stringify({ query: "Second prompt" }),
	});

	const result = await asOwner.mutation(api.chats.truncateFromMessage, {
		workspaceId,
		chatId: "chat-edit",
		messageId: "msg-1",
	});

	expect(result.deletedCount).toBe(3);

	const messages = await asOwner.query(api.chats.getMessages, {
		workspaceId,
		chatId: "chat-edit",
	});

	expect(messages).toHaveLength(0);

	const relatedRows = await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", "chat-edit"),
			)
			.unique();

		if (!chat) {
			throw new Error("Expected chat to exist.");
		}

		const activeStream = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		const toolCalls = await ctx.db
			.query("chatToolCalls")
			.withIndex("by_chatId_and_messageId", (q) =>
				q.eq("chatId", chat._id).eq("messageId", "stream-1"),
			)
			.collect();

		return {
			activeStream,
			toolCallCount: toolCalls.length,
		};
	});

	expect(relatedRows.activeStream).toBeNull();
	expect(relatedRows.toolCallCount).toBe(0);
});

test("removing a chat deletes active stream and tool call runtime records", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-remove-runtime",
		preview: "Search",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Search" }]),
			text: "Search",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId: "chat-remove-runtime",
		messageId: "stream-1",
	});
	await asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
		workspaceId,
		chatId: "chat-remove-runtime",
		messageId: "stream-1",
		toolCallId: "tool-call-1",
		toolName: "search",
	});

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "chat-remove-runtime",
	});

	const rows = await t.run(async (ctx) => ({
		activeStreams: await ctx.db.query("chatActiveStreams").collect(),
		toolCalls: await ctx.db.query("chatToolCalls").collect(),
	}));

	expect(rows.activeStreams).toHaveLength(0);
	expect(rows.toolCalls).toHaveLength(0);
});

test("removing a chat skips malformed legacy attachment storage ids", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-with-legacy-attachment",
		preview: "Legacy attachment",
		message: {
			id: "msg-legacy-attachment",
			role: "user",
			partsJson: JSON.stringify([
				{
					type: "file",
					mediaType: "text/plain",
					filename: "legacy.txt",
					url: "https://example.convex.site/api/storage/not-valid",
				},
			]),
			text: "Legacy attachment",
			createdAt: 2_000,
		},
	});

	await expect(
		asOwner.mutation(api.chats.remove, {
			workspaceId,
			chatId: "chat-with-legacy-attachment",
		}),
	).resolves.toBeNull();

	const session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-with-legacy-attachment",
	});

	expect(session).toBeNull();
});

test("message snapshots return only replay fields", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-snapshot",
		preview: "Prompt",
		message: {
			id: "msg-snapshot-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			metadataJson: JSON.stringify({ source: "test" }),
			text: "Prompt",
			createdAt: 2_500,
		},
	});

	const snapshots = await asOwner.query(api.chats.getMessagesSnapshot, {
		workspaceId,
		chatId: "chat-snapshot",
	});

	expect(snapshots).toEqual([
		{
			id: "msg-snapshot-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			metadataJson: JSON.stringify({ source: "test" }),
			createdAt: 2_500,
		},
	]);
	expect("text" in snapshots[0]).toBe(false);
	expect(snapshots[0]?.createdAt).toBe(2_500);
});
