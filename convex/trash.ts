import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WORKSPACE_CLEANUP_BATCH_SIZE = 25;
const EXPIRED_TRASH_NOTES_BATCH_SIZE = 25;
const EXPIRED_TRASH_CHATS_BATCH_SIZE = 25;

const cleanupExpiredWorkspacesResultValidator = v.object({
	scheduledWorkspaceCount: v.number(),
	hasMore: v.boolean(),
});

const cleanupExpiredItemsResultValidator = v.object({
	deletedNoteCount: v.number(),
	scheduledChatCount: v.number(),
	hasMore: v.boolean(),
});

const loadExpiredArchivedNotes = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Doc<"workspaces">["_id"],
	cutoffTimestamp: number,
) =>
	await ctx.db
		.query("notes")
		.withIndex("by_owner_ws_archived_archivedAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("isArchived", true)
				.gt("archivedAt", 0)
				.lte("archivedAt", cutoffTimestamp),
		)
		.order("asc")
		.take(EXPIRED_TRASH_NOTES_BATCH_SIZE);

const loadExpiredArchivedChats = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Doc<"workspaces">["_id"],
	cutoffTimestamp: number,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_owner_ws_archived_archivedAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("isArchived", true)
				.gt("archivedAt", 0)
				.lte("archivedAt", cutoffTimestamp),
		)
		.order("asc")
		.take(EXPIRED_TRASH_CHATS_BATCH_SIZE);

const removeExpiredArchivedNotesBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Doc<"workspaces">["_id"],
	cutoffTimestamp: number,
) => {
	const notes = await loadExpiredArchivedNotes(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		cutoffTimestamp,
	);

	for (const note of notes) {
		await ctx.runMutation(internal.chats.removeForNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: note.workspaceId,
			noteId: note._id,
		});
		await ctx.scheduler.runAfter(0, internal.transcriptSessions.removeForNote, {
			noteId: note._id,
			ownerTokenIdentifier: note.ownerTokenIdentifier,
		});
		await ctx.db.delete(note._id);
	}

	return {
		deletedCount: notes.length,
		hasMore: notes.length === EXPIRED_TRASH_NOTES_BATCH_SIZE,
	};
};

const isHandledByExpiredNoteCleanup = async (
	ctx: MutationCtx,
	chat: Doc<"chats">,
	cutoffTimestamp: number,
) => {
	if (!chat.noteId) {
		return false;
	}

	const note = await ctx.db.get(chat.noteId);

	if (!note) {
		return false;
	}

	return (
		note.isArchived &&
		note.archivedAt !== undefined &&
		note.archivedAt <= cutoffTimestamp
	);
};

const removeExpiredArchivedChatsBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Doc<"workspaces">["_id"],
	cutoffTimestamp: number,
) => {
	const chats = await loadExpiredArchivedChats(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		cutoffTimestamp,
	);
	let scheduledCount = 0;

	for (const chat of chats) {
		if (await isHandledByExpiredNoteCleanup(ctx, chat, cutoffTimestamp)) {
			continue;
		}

		await ctx.scheduler.runAfter(
			0,
			internal.chats.removeMessagesAndDeleteChat,
			{
				chatId: chat._id,
			},
		);
		scheduledCount += 1;
	}

	return {
		scheduledCount,
		hasMore: chats.length === EXPIRED_TRASH_CHATS_BATCH_SIZE,
	};
};

export const cleanupExpiredItemsForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		cutoffTimestamp: v.number(),
	},
	returns: cleanupExpiredItemsResultValidator,
	handler: async (ctx, args) => {
		const noteCleanup = await removeExpiredArchivedNotesBatch(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.cutoffTimestamp,
		);
		const chatCleanup = await removeExpiredArchivedChatsBatch(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.cutoffTimestamp,
		);
		const hasMore = noteCleanup.hasMore || chatCleanup.hasMore;

		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.trash.cleanupExpiredItemsForWorkspace,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					cutoffTimestamp: args.cutoffTimestamp,
				},
			);
		}

		return {
			deletedNoteCount: noteCleanup.deletedCount,
			scheduledChatCount: chatCleanup.scheduledCount,
			hasMore,
		};
	},
});

export const cleanupExpiredItems = internalMutation({
	args: {
		cutoffTimestamp: v.optional(v.number()),
		paginationOpts: v.optional(paginationOptsValidator),
	},
	returns: cleanupExpiredWorkspacesResultValidator,
	handler: async (ctx, args) => {
		const cutoffTimestamp =
			args.cutoffTimestamp ?? Date.now() - TRASH_RETENTION_MS;
		const workspaces = await ctx.db
			.query("workspaces")
			.withIndex("by_updatedAt")
			.paginate(
				args.paginationOpts ?? {
					numItems: WORKSPACE_CLEANUP_BATCH_SIZE,
					cursor: null,
				},
			);

		for (const workspace of workspaces.page) {
			await ctx.scheduler.runAfter(
				0,
				internal.trash.cleanupExpiredItemsForWorkspace,
				{
					ownerTokenIdentifier: workspace.ownerTokenIdentifier,
					workspaceId: workspace._id,
					cutoffTimestamp,
				},
			);
		}

		if (!workspaces.isDone) {
			await ctx.scheduler.runAfter(0, internal.trash.cleanupExpiredItems, {
				cutoffTimestamp,
				paginationOpts: {
					numItems: WORKSPACE_CLEANUP_BATCH_SIZE,
					cursor: workspaces.continueCursor,
				},
			});
		}

		return {
			scheduledWorkspaceCount: workspaces.page.length,
			hasMore: !workspaces.isDone,
		};
	},
});
