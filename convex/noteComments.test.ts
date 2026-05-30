import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://opengran.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

afterEach(() => {
	vi.useRealTimers();
});

const createWorkspaceAndNote = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { noteId, workspaceId } = await t.run(async (ctx) => {
		const createdAt = 1_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt,
			updatedAt: createdAt,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			authorName: "Owner",
			starredSortOrder: 0,
			title: "Draft note",
			content: JSON.stringify({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "Review this section" }],
					},
				],
			}),
			searchableText: "Review this section",
			visibility: "private",
			isArchived: false,
			createdAt,
			updatedAt: createdAt,
		});

		return { noteId, workspaceId };
	});

	return {
		asOwner,
		noteId,
		workspaceId,
	};
};

test("noteComments.createThread stores the thread and first comment", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Can you clarify the decision here?",
	});

	const threads = await asOwner.query(api.noteComments.listThreads, {
		workspaceId,
		noteId,
		view: "all",
	});
	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(threads).toHaveLength(1);
	expect(threads[0]).toMatchObject({
		_id: threadId,
		createdByName: "Owner",
		excerpt: "Review this section",
		isResolved: false,
		isRead: false,
		commentCount: 1,
		latestCommentPreview: "Can you clarify the decision here?",
		latestCommentIsReply: false,
	});
	expect(thread).not.toBeNull();
	expect(thread?.comments).toHaveLength(1);
	expect(thread?.comments[0]).toMatchObject({
		threadId,
		authorName: "Owner",
		body: "Can you clarify the decision here?",
	});
	expect(inboxItems).toEqual([]);
});

test("noteComments.addComment reopens a resolved thread", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "First pass",
	});

	vi.setSystemTime(new Date("2026-04-12T10:05:00.000Z"));
	await asOwner.mutation(api.noteComments.setResolved, {
		workspaceId,
		noteId,
		threadId,
		resolved: true,
	});

	vi.setSystemTime(new Date("2026-04-12T10:10:00.000Z"));
	await asOwner.mutation(api.noteComments.addComment, {
		workspaceId,
		noteId,
		threadId,
		body: "Added more context.",
	});

	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(thread).not.toBeNull();
	expect(thread).toMatchObject({
		isResolved: false,
		isRead: false,
		commentCount: 2,
		latestCommentPreview: "Added more context.",
		latestCommentIsReply: true,
	});
	expect(thread?.comments.map((comment) => comment.body)).toEqual([
		"First pass",
		"Added more context.",
	]);
	expect(inboxItems).toEqual([]);
});

test("noteComments.markRead marks the thread as read", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Unread thread",
	});

	vi.setSystemTime(new Date("2026-04-12T10:03:00.000Z"));
	await asOwner.mutation(api.noteComments.markRead, {
		workspaceId,
		noteId,
		threadId,
	});

	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(thread).not.toBeNull();
	expect(thread).toMatchObject({
		isRead: true,
		readAt: new Date("2026-04-12T10:03:00.000Z").getTime(),
	});
	expect(inboxItems).toEqual([]);
});

test("noteComments.markRead does not reorder threads", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const firstThreadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "First thread",
		body: "First body",
	});

	vi.setSystemTime(new Date("2026-04-12T10:05:00.000Z"));
	const secondThreadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Second thread",
		body: "Second body",
	});

	const threadsBeforeMarkRead = await asOwner.query(api.noteComments.listThreads, {
		workspaceId,
		noteId,
		view: "all",
	});

	expect(threadsBeforeMarkRead.map((thread) => thread._id)).toEqual([
		secondThreadId,
		firstThreadId,
	]);

	vi.setSystemTime(new Date("2026-04-12T10:10:00.000Z"));
	await asOwner.mutation(api.noteComments.markRead, {
		workspaceId,
		noteId,
		threadId: firstThreadId,
	});

	const threadsAfterMarkRead = await asOwner.query(api.noteComments.listThreads, {
		workspaceId,
		noteId,
		view: "all",
	});

	expect(threadsAfterMarkRead.map((thread) => thread._id)).toEqual([
		secondThreadId,
		firstThreadId,
	]);
	expect(threadsAfterMarkRead[1]).toMatchObject({
		_id: firstThreadId,
		isRead: true,
		readAt: new Date("2026-04-12T10:10:00.000Z").getTime(),
	});
});

test("noteComments.addComment chains replies to the latest comment by default", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Root comment",
	});

	vi.setSystemTime(new Date("2026-04-12T10:01:00.000Z"));
	const firstReplyId = await asOwner.mutation(api.noteComments.addComment, {
		workspaceId,
		noteId,
		threadId,
		body: "First reply",
	});

	vi.setSystemTime(new Date("2026-04-12T10:02:00.000Z"));
	await asOwner.mutation(api.noteComments.addComment, {
		workspaceId,
		noteId,
		threadId,
		body: "Second reply",
	});

	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});

	expect(thread).not.toBeNull();
	expect(thread?.comments).toHaveLength(3);
	expect(thread?.comments[0]?.body).toBe("Root comment");
	expect(thread?.comments[0]).not.toHaveProperty("parentCommentId");
	expect(thread?.comments[1]).toMatchObject({
		_id: firstReplyId,
		body: "First reply",
		parentCommentId: thread?.comments[0]?._id,
	});
	expect(thread?.comments[2]).toMatchObject({
		body: "Second reply",
		parentCommentId: firstReplyId,
	});
});

test("noteComments.deleteComment keeps the thread and refreshes inbox activity", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Root comment",
	});

	vi.setSystemTime(new Date("2026-04-12T10:01:00.000Z"));
	await asOwner.mutation(api.noteComments.addComment, {
		workspaceId,
		noteId,
		threadId,
		body: "First reply",
	});

	vi.setSystemTime(new Date("2026-04-12T10:02:00.000Z"));
	const latestReplyId = await asOwner.mutation(api.noteComments.addComment, {
		workspaceId,
		noteId,
		threadId,
		body: "Latest reply",
	});

	await asOwner.mutation(api.noteComments.markRead, {
		workspaceId,
		noteId,
		threadId,
	});

	await asOwner.mutation(api.noteComments.deleteComment, {
		workspaceId,
		noteId,
		threadId,
		commentId: latestReplyId,
	});

	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(thread).not.toBeNull();
	expect(thread).toMatchObject({
		commentCount: 2,
		latestCommentPreview: "First reply",
		latestCommentIsReply: true,
		isRead: true,
	});
	expect(inboxItems).toEqual([]);
});

test("noteComments.deleteThread removes the thread and its comments", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Root comment",
	});

	vi.setSystemTime(new Date("2026-04-12T10:01:00.000Z"));
	await asOwner.mutation(api.noteComments.addComment, {
		workspaceId,
		noteId,
		threadId,
		body: "Reply comment",
	});

	await asOwner.mutation(api.noteComments.deleteThread, {
		workspaceId,
		noteId,
		threadId,
	});

	const threads = await asOwner.query(api.noteComments.listThreads, {
		workspaceId,
		noteId,
		view: "all",
	});
	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(threads).toEqual([]);
	expect(thread).toBeNull();
	expect(inboxItems).toEqual([]);
});

test("notes.save removes comment threads whose anchors were deleted", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Root comment",
	});

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Draft note",
		content: JSON.stringify({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Updated selection",
							marks: [
								{
									type: "noteComment",
									attrs: {
										threadId: String(threadId),
									},
								},
							],
						},
					],
				},
			],
		}),
		searchableText: "Updated selection",
	});

	const updatedThread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});

	expect(updatedThread).not.toBeNull();
	expect(updatedThread).toMatchObject({
		excerpt: "Updated selection",
	});

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Draft note",
		content: JSON.stringify({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Review this section" }],
				},
			],
		}),
		searchableText: "Review this section",
	});

	const threads = await asOwner.query(api.noteComments.listThreads, {
		workspaceId,
		noteId,
		view: "all",
	});
	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(threads).toEqual([]);
	expect(thread).toBeNull();
	expect(inboxItems).toEqual([]);
});

test("noteComments.markUnread and toggleMuteReplies update thread actions state", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Thread comment",
	});

	await asOwner.mutation(api.noteComments.markRead, {
		workspaceId,
		noteId,
		threadId,
	});

	await asOwner.mutation(api.noteComments.markUnread, {
		workspaceId,
		noteId,
		threadId,
	});

	const muted = await asOwner.mutation(api.noteComments.toggleMuteReplies, {
		workspaceId,
		noteId,
		threadId,
	});
	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(muted).toBe(true);
	expect(thread).not.toBeNull();
	expect(thread).toMatchObject({
		isRead: false,
		isMutedReplies: true,
	});
	expect(inboxItems).toEqual([]);
});

test("noteComments.updateComment preserves inbox read state", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const threadId = await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "Review this section",
		body: "Initial comment",
	});

	const thread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});

	expect(thread).not.toBeNull();

	vi.setSystemTime(new Date("2026-04-12T10:05:00.000Z"));
	await asOwner.mutation(api.noteComments.updateComment, {
		workspaceId,
		noteId,
		threadId,
		commentId: thread!.comments[0]!._id,
		body: "Edited comment",
	});

	const updatedThread = await asOwner.query(api.noteComments.getThread, {
		workspaceId,
		noteId,
		threadId,
	});
	const inboxItems = await asOwner.query(api.inboxItems.list, {
		workspaceId,
		view: "all",
	});

	expect(updatedThread).not.toBeNull();
	expect(updatedThread).toMatchObject({
		latestCommentPreview: "Edited comment",
	});
	expect(inboxItems).toEqual([]);
});
