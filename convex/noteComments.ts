import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	getAuthorName,
	requireIdentity,
	requireOwnedNote,
	requireOwnedWorkspace,
} from "./notes";

const MAX_THREAD_EXCERPT_LENGTH = 280;
const MAX_COMMENT_BODY_LENGTH = 2_000;
const REMOVE_BATCH_SIZE = 100;
const NOTE_COMMENT_INBOX_PROVIDER = "notes" as const;
const COMMENTED_IN_TITLE = "commented in";
const REPLIED_IN_TITLE = "replied in";
const getDiscussionActivityTitle = (isReply: boolean) =>
	isReply ? REPLIED_IN_TITLE : COMMENTED_IN_TITLE;

const getThreadInboxExternalId = (threadId: Id<"noteCommentThreads">) =>
	`note-comment-thread:${threadId}`;

const getInboxNoteTitle = (note: Doc<"notes">) => note.title.trim() || "Untitled";

const syncThreadInboxItem = async (
	ctx: MutationCtx,
	{
		authorDisplayName,
		note,
		ownerTokenIdentifier,
		preview,
		title,
		occurredAt,
		threadId,
		workspaceId,
		markUnread,
	}: {
		authorDisplayName: string;
		note: Doc<"notes">;
		ownerTokenIdentifier: string;
		preview: string;
		title: string;
		occurredAt: number;
		threadId: Id<"noteCommentThreads">;
		workspaceId: Id<"workspaces">;
		markUnread?: boolean;
	},
) => {
	await ctx.runMutation(internal.inboxItems.upsertNoteComment, {
		ownerTokenIdentifier,
		workspaceId,
		externalId: getThreadInboxExternalId(threadId),
		noteTitle: getInboxNoteTitle(note),
		title,
		preview,
		url: `/note?noteId=${note._id}&commentThreadId=${threadId}`,
		actorDisplayName: authorDisplayName,
		occurredAt,
		markUnread,
	});
};

const syncVisibleThreadInboxItem = async (
	ctx: MutationCtx,
	args: Parameters<typeof syncThreadInboxItem>[1],
) => {
	if (args.authorDisplayName === "You") {
		await ctx.runMutation(internal.inboxItems.removeNoteComment, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			externalId: getThreadInboxExternalId(args.threadId),
		});
		return;
	}

	await syncThreadInboxItem(ctx, args);
};

const getInboxActorDisplayName = ({
	authorName,
	identity,
}: {
	authorName: string;
	identity: Awaited<ReturnType<typeof requireIdentity>>;
}) => (authorName === getAuthorName(identity) ? "You" : authorName);

const noteCommentFields = {
	_id: v.id("noteComments"),
	_creationTime: v.number(),
	threadId: v.id("noteCommentThreads"),
	parentCommentId: v.optional(v.id("noteComments")),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	noteId: v.id("notes"),
	authorName: v.string(),
	body: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const noteCommentThreadFields = {
	_id: v.id("noteCommentThreads"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	noteId: v.id("notes"),
	createdByName: v.string(),
	excerpt: v.string(),
	isResolved: v.boolean(),
	isRead: v.boolean(),
	isMutedReplies: v.optional(v.boolean()),
	readAt: v.optional(v.number()),
	resolvedAt: v.optional(v.number()),
	resolvedByName: v.optional(v.string()),
	commentCount: v.number(),
	latestCommentPreview: v.string(),
	latestCommentIsReply: v.boolean(),
	createdAt: v.number(),
	updatedAt: v.number(),
	lastCommentAt: v.number(),
};

const noteCommentValidator = v.object(noteCommentFields);
const noteCommentThreadSummaryValidator = v.object(noteCommentThreadFields);
const noteCommentThreadDetailValidator = v.object({
	...noteCommentThreadFields,
	comments: v.array(noteCommentValidator),
});

const clampExcerpt = (value: string) => value.trim().slice(0, MAX_THREAD_EXCERPT_LENGTH);

const normalizeCommentBody = (value: string) => {
	const normalized = value.trim();

	if (!normalized) {
		throw new ConvexError({
			code: "INVALID_COMMENT_BODY",
			message: "Comment body is required.",
		});
	}

	if (normalized.length > MAX_COMMENT_BODY_LENGTH) {
		throw new ConvexError({
			code: "INVALID_COMMENT_BODY",
			message: `Comment body must be ${MAX_COMMENT_BODY_LENGTH} characters or fewer.`,
		});
	}

	return normalized;
};

const resolveThreadCreatorName = async (
	ctx: MutationCtx | QueryCtx,
	thread: {
		_id: Id<"noteCommentThreads">;
	} & Record<string, unknown>,
) => {
	const createdByName = thread.createdByName;

	if (typeof createdByName === "string" && createdByName.trim().length > 0) {
		return createdByName;
	}

	const firstComment = await ctx.db
		.query("noteComments")
		.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
		.first();

	return firstComment?.authorName || "Unknown";
};

const resolveLatestCommentIsReply = async (
	ctx: MutationCtx | QueryCtx,
	thread: {
		_id: Id<"noteCommentThreads">;
	} & Record<string, unknown>,
) => {
	const latestCommentIsReply = thread.latestCommentIsReply;

	if (typeof latestCommentIsReply === "boolean") {
		return latestCommentIsReply;
	}

	const latestComment = await ctx.db
		.query("noteComments")
		.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
		.order("desc")
		.first();

	return Boolean(latestComment?.parentCommentId);
};

const normalizeThreadSummary = async (
	ctx: MutationCtx | QueryCtx,
	thread: {
		_id: Id<"noteCommentThreads">;
		_creationTime: number;
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		noteId: Id<"notes">;
		excerpt: string;
		isResolved: boolean;
		isRead: boolean;
		isMutedReplies?: boolean;
		readAt?: number;
		resolvedAt?: number;
		resolvedByName?: string;
		commentCount: number;
		latestCommentPreview: string;
		latestCommentIsReply?: boolean;
		createdAt: number;
		updatedAt: number;
		lastCommentAt: number;
	} & Record<string, unknown>,
) => ({
		...thread,
		createdByName: await resolveThreadCreatorName(ctx, thread),
		latestCommentIsReply: await resolveLatestCommentIsReply(ctx, thread),
	});

const requireOwnedThread = async (
	ctx: MutationCtx | QueryCtx,
	{
		workspaceId,
		noteId,
		threadId,
		ownerTokenIdentifier,
	}: {
		workspaceId: Id<"workspaces">;
		noteId: Id<"notes">;
		threadId: Id<"noteCommentThreads">;
		ownerTokenIdentifier: string;
	},
) => {
	const thread = await ctx.db.get(threadId);

	if (
		!thread ||
		thread.ownerTokenIdentifier !== ownerTokenIdentifier ||
		thread.workspaceId !== workspaceId ||
		thread.noteId !== noteId
	) {
		throw new ConvexError({
			code: "THREAD_NOT_FOUND",
			message: "Comment thread not found.",
		});
	}

	return thread;
};

const resolveParentCommentId = async (
	ctx: MutationCtx,
	{
		threadId,
		parentCommentId,
	}: {
		threadId: Id<"noteCommentThreads">;
		parentCommentId?: Id<"noteComments">;
	},
) => {
	if (parentCommentId) {
		const parentComment = await ctx.db.get(parentCommentId);

		if (!parentComment || parentComment.threadId !== threadId) {
			throw new ConvexError({
				code: "COMMENT_NOT_FOUND",
				message: "Reply target not found.",
			});
		}

		return parentComment._id;
	}

	const latestComment = await ctx.db
		.query("noteComments")
		.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", threadId))
		.order("desc")
		.first();

	return latestComment?._id;
};

const deleteThreadsBatchForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const threads = await ctx.db
		.query("noteCommentThreads")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(REMOVE_BATCH_SIZE);

	await Promise.all(threads.map((thread) => ctx.db.delete(thread._id)));

	return threads.length === REMOVE_BATCH_SIZE;
};

const deleteCommentsBatchForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const comments = await ctx.db
		.query("noteComments")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(REMOVE_BATCH_SIZE);

	await Promise.all(comments.map((comment) => ctx.db.delete(comment._id)));

	return comments.length === REMOVE_BATCH_SIZE;
};

const deleteThreadsBatchForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const threads = await ctx.db
		.query("noteCommentThreads")
		.withIndex("by_ownerTokenIdentifier_and_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_BATCH_SIZE);

	await Promise.all(threads.map((thread) => ctx.db.delete(thread._id)));

	return threads.length === REMOVE_BATCH_SIZE;
};

const deleteCommentsBatchForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const comments = await ctx.db
		.query("noteComments")
		.withIndex("by_ownerTokenIdentifier_and_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_BATCH_SIZE);

	await Promise.all(comments.map((comment) => ctx.db.delete(comment._id)));

	return comments.length === REMOVE_BATCH_SIZE;
};

const deleteThreadRecords = async (
	ctx: MutationCtx,
	{
		ownerTokenIdentifier,
		workspaceId,
		thread,
	}: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		thread: Doc<"noteCommentThreads">;
	},
) => {
	const comments = await ctx.db
		.query("noteComments")
		.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
		.take(thread.commentCount);

	await Promise.all(comments.map((comment) => ctx.db.delete(comment._id)));
	await ctx.db.delete(thread._id);
	await ctx.runMutation(internal.inboxItems.removeNoteComment, {
		ownerTokenIdentifier,
		workspaceId,
		externalId: getThreadInboxExternalId(thread._id),
	});
};

export const listThreads = query({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		view: v.optional(
			v.union(v.literal("all"), v.literal("open"), v.literal("resolved")),
		),
	},
	returns: v.array(noteCommentThreadSummaryValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);

		if (!args.view || args.view === "all") {
			const threads = await ctx.db
				.query("noteCommentThreads")
				.withIndex("by_owner_ws_note_updatedAt", (q) =>
					q
						.eq("ownerTokenIdentifier", identity.tokenIdentifier)
						.eq("workspaceId", args.workspaceId)
						.eq("noteId", args.noteId),
				)
				.order("desc")
				.take(200);

			return await Promise.all(
				threads.map((thread) => normalizeThreadSummary(ctx, thread)),
			);
		}

		const threads = await ctx.db
			.query("noteCommentThreads")
			.withIndex("by_owner_ws_note_resolved_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", identity.tokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.noteId)
					.eq("isResolved", args.view === "resolved"),
			)
			.order("desc")
			.take(200);

		return await Promise.all(
			threads.map((thread) => normalizeThreadSummary(ctx, thread)),
		);
	},
});

export const getThread = query({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
	},
	returns: v.union(noteCommentThreadDetailValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await ctx.db.get(args.threadId);

		if (
			!thread ||
			thread.ownerTokenIdentifier !== identity.tokenIdentifier ||
			thread.workspaceId !== args.workspaceId ||
			thread.noteId !== args.noteId
		) {
			return null;
		}

		const comments = await ctx.db
			.query("noteComments")
			.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", args.threadId))
			.take(200);

		return {
			...(await normalizeThreadSummary(ctx, thread)),
			comments,
		};
	},
});

export const createThread = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		excerpt: v.string(),
		body: v.string(),
	},
	returns: v.id("noteCommentThreads"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		const note = await requireOwnedNote(ctx, args.noteId, args.workspaceId);

		const body = normalizeCommentBody(args.body);
		const excerpt = clampExcerpt(args.excerpt);

		if (!excerpt) {
			throw new ConvexError({
				code: "INVALID_COMMENT_EXCERPT",
				message: "Select some note text before leaving a comment.",
			});
		}

		const now = Date.now();
		const authorName = getAuthorName(identity);
		const threadId = await ctx.db.insert("noteCommentThreads", {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			createdByName: authorName,
			excerpt,
			isResolved: false,
			isRead: false,
			isMutedReplies: false,
			readAt: undefined,
			commentCount: 1,
			latestCommentPreview: body,
			latestCommentIsReply: false,
			createdAt: now,
			updatedAt: now,
			lastCommentAt: now,
		});

		await ctx.db.insert("noteComments", {
			threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			authorName,
			body,
			createdAt: now,
			updatedAt: now,
		});

		await syncVisibleThreadInboxItem(ctx, {
			authorDisplayName: "You",
			note,
			ownerTokenIdentifier: identity.tokenIdentifier,
			preview: body,
			title: COMMENTED_IN_TITLE,
			occurredAt: now,
			threadId,
			workspaceId: args.workspaceId,
			markUnread: false,
		});

		return threadId;
	},
});

export const addComment = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
		parentCommentId: v.optional(v.id("noteComments")),
		body: v.string(),
	},
	returns: v.id("noteComments"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		const note = await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
		const body = normalizeCommentBody(args.body);
		const now = Date.now();
		const parentCommentId = await resolveParentCommentId(ctx, {
			threadId: thread._id,
			parentCommentId: args.parentCommentId,
		});
		const commentId = await ctx.db.insert("noteComments", {
			threadId: thread._id,
			parentCommentId,
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			authorName: getAuthorName(identity),
			body,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.patch(thread._id, {
			createdByName: await resolveThreadCreatorName(ctx, thread),
			commentCount: thread.commentCount + 1,
			latestCommentPreview: body,
			latestCommentIsReply: true,
			isResolved: false,
			isRead: false,
			readAt: undefined,
			resolvedAt: undefined,
			resolvedByName: undefined,
			updatedAt: now,
			lastCommentAt: now,
		});

		await syncVisibleThreadInboxItem(ctx, {
			authorDisplayName: "You",
			note,
			ownerTokenIdentifier: identity.tokenIdentifier,
			preview: body,
			title: REPLIED_IN_TITLE,
			occurredAt: now,
			threadId: thread._id,
			workspaceId: args.workspaceId,
			markUnread: false,
		});

		return commentId;
	},
});

export const setResolved = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
		resolved: v.boolean(),
	},
	returns: noteCommentThreadSummaryValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
		const now = Date.now();
		const resolvedByName = args.resolved ? getAuthorName(identity) : undefined;

		await ctx.db.patch(thread._id, {
			isResolved: args.resolved,
			resolvedAt: args.resolved ? now : undefined,
			resolvedByName,
			updatedAt: now,
		});

		const nextThread = await ctx.db.get(thread._id);

		if (!nextThread) {
			throw new ConvexError({
				code: "THREAD_UPDATE_FAILED",
				message: "Failed to update comment thread.",
			});
		}

	return await normalizeThreadSummary(ctx, nextThread);
	},
});

export const markRead = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});

		if (thread.isRead) {
			return null;
		}

		const now = Date.now();
		await ctx.db.patch(thread._id, {
			isRead: true,
			readAt: now,
		});
		await ctx.runMutation(internal.inboxItems.setReadState, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			provider: NOTE_COMMENT_INBOX_PROVIDER,
			externalId: getThreadInboxExternalId(thread._id),
			isRead: true,
		});

		return null;
	},
});

export const markUnread = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});

		if (!thread.isRead) {
			return null;
		}

		await ctx.db.patch(thread._id, {
			isRead: false,
			readAt: undefined,
		});
		await ctx.runMutation(internal.inboxItems.setReadState, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			provider: NOTE_COMMENT_INBOX_PROVIDER,
			externalId: getThreadInboxExternalId(thread._id),
			isRead: false,
		});

		return null;
	},
});

export const updateComment = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
		commentId: v.id("noteComments"),
		body: v.string(),
	},
	returns: v.id("noteComments"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		const note = await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
		const comment = await ctx.db.get(args.commentId);

		if (
			!comment ||
			comment.threadId !== thread._id ||
			comment.ownerTokenIdentifier !== identity.tokenIdentifier ||
			comment.workspaceId !== args.workspaceId ||
			comment.noteId !== args.noteId
		) {
			throw new ConvexError({
				code: "COMMENT_NOT_FOUND",
				message: "Comment not found.",
			});
		}

		const body = normalizeCommentBody(args.body);
		const now = Date.now();

		await ctx.db.patch(comment._id, {
			body,
			updatedAt: now,
		});

		const latestComment = await ctx.db
			.query("noteComments")
			.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
			.order("desc")
			.first();

		if (latestComment?._id === comment._id) {
			await ctx.db.patch(thread._id, {
				latestCommentPreview: body,
				updatedAt: now,
			});

			await syncVisibleThreadInboxItem(ctx, {
				authorDisplayName: "You",
				note,
				ownerTokenIdentifier: identity.tokenIdentifier,
				preview: body,
				title: latestComment.parentCommentId
					? REPLIED_IN_TITLE
					: COMMENTED_IN_TITLE,
				occurredAt: thread.lastCommentAt,
				threadId: thread._id,
				workspaceId: args.workspaceId,
				markUnread: false,
			});
		}

		return comment._id;
	},
});

export const deleteComment = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
		commentId: v.id("noteComments"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		const note = await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
		const comment = await ctx.db.get(args.commentId);

		if (
			!comment ||
			comment.threadId !== thread._id ||
			comment.ownerTokenIdentifier !== identity.tokenIdentifier ||
			comment.workspaceId !== args.workspaceId ||
			comment.noteId !== args.noteId
		) {
			throw new ConvexError({
				code: "COMMENT_NOT_FOUND",
				message: "Comment not found.",
			});
		}

		const threadComments = await ctx.db
			.query("noteComments")
			.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
			.take(thread.commentCount);

		const directReplies = threadComments.filter(
			(threadComment) => threadComment.parentCommentId === comment._id,
		);

		await Promise.all(
			directReplies.map((reply) =>
				ctx.db.patch(reply._id, {
					parentCommentId: comment.parentCommentId,
				}),
			),
		);

		await ctx.db.delete(comment._id);

		const remainingCommentCount = thread.commentCount - 1;
		if (remainingCommentCount <= 0) {
			await ctx.db.delete(thread._id);
			await ctx.runMutation(internal.inboxItems.removeNoteComment, {
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
				externalId: getThreadInboxExternalId(thread._id),
			});
			return null;
		}

		const firstRemainingComment = await ctx.db
			.query("noteComments")
			.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
			.first();
		const latestRemainingComment = await ctx.db
			.query("noteComments")
			.withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", thread._id))
			.order("desc")
			.first();

		if (!firstRemainingComment || !latestRemainingComment) {
			throw new ConvexError({
				code: "THREAD_UPDATE_FAILED",
				message: "Failed to recalculate comment thread.",
			});
		}

		const now = Date.now();
		await ctx.db.patch(thread._id, {
			createdByName: firstRemainingComment.authorName,
			commentCount: remainingCommentCount,
			latestCommentPreview: latestRemainingComment.body,
			latestCommentIsReply: Boolean(latestRemainingComment.parentCommentId),
			updatedAt: now,
			lastCommentAt: latestRemainingComment.createdAt,
		});

		await syncVisibleThreadInboxItem(ctx, {
			authorDisplayName: getInboxActorDisplayName({
				authorName: latestRemainingComment.authorName,
				identity,
			}),
			note,
			ownerTokenIdentifier: identity.tokenIdentifier,
			preview: latestRemainingComment.body,
			title: getDiscussionActivityTitle(
				Boolean(latestRemainingComment.parentCommentId),
			),
			occurredAt: latestRemainingComment.createdAt,
			threadId: thread._id,
			workspaceId: args.workspaceId,
			markUnread: false,
		});

		return null;
	},
});

export const toggleMuteReplies = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});

		const nextMuted = !thread.isMutedReplies;
		await ctx.db.patch(thread._id, {
			isMutedReplies: nextMuted,
		});

		return nextMuted;
	},
});

export const deleteThread = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		threadId: v.id("noteCommentThreads"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		await requireOwnedNote(ctx, args.noteId, args.workspaceId);
		const thread = await requireOwnedThread(ctx, {
			workspaceId: args.workspaceId,
			noteId: args.noteId,
			threadId: args.threadId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});

		await deleteThreadRecords(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			thread,
		});

		return null;
	},
});

export const syncAnchorsForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		activeAnchors: v.array(
			v.object({
				threadId: v.id("noteCommentThreads"),
				excerpt: v.string(),
			}),
		),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const activeAnchors = new Map(
			args.activeAnchors.map((anchor) => [
				String(anchor.threadId),
				clampExcerpt(anchor.excerpt),
			]),
		);
		const threads = await ctx.db
			.query("noteCommentThreads")
			.withIndex("by_owner_ws_note_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.noteId),
			)
			.take(500);

		for (const thread of threads) {
			const nextExcerpt = activeAnchors.get(String(thread._id));
			if (nextExcerpt) {
				if (thread.excerpt !== nextExcerpt) {
					await ctx.db.patch(thread._id, {
						excerpt: nextExcerpt,
					});
				}
				continue;
			}

			await deleteThreadRecords(ctx, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				thread,
			});
		}

		return null;
	},
});

export const removeForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const threads = await ctx.db
			.query("noteCommentThreads")
			.withIndex("by_owner_ws_note_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.noteId),
			)
			.take(REMOVE_BATCH_SIZE);

		for (const thread of threads) {
			await deleteThreadRecords(ctx, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				thread,
			});
		}

		if (threads.length === REMOVE_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.noteComments.removeForNote, args);
		}

		return null;
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const hasMoreComments = await deleteCommentsBatchForWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const hasMoreThreads = await deleteThreadsBatchForWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (hasMoreComments || hasMoreThreads) {
			await ctx.scheduler.runAfter(0, internal.noteComments.removeAllForWorkspace, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const hasMoreComments = await deleteCommentsBatchForOwner(
			ctx,
			args.ownerTokenIdentifier,
		);
		const hasMoreThreads = await deleteThreadsBatchForOwner(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (hasMoreComments || hasMoreThreads) {
			await ctx.scheduler.runAfter(0, internal.noteComments.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});
