import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireOwnedWorkspace, requireTokenIdentifier } from "./domain";

const queuedMessageStatusValidator = v.union(
	v.literal("queued"),
	v.literal("claimed"),
	v.literal("discarded"),
);

const queuedMessageValidator = v.object({
	_id: v.id("assistantQueuedMessages"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
	messageId: v.string(),
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	requestBodyJson: v.string(),
	status: queuedMessageStatusValidator,
	createdAt: v.number(),
	updatedAt: v.number(),
	claimedAt: v.optional(v.number()),
});

const queuedMessageInputValidator = v.object({
	messageId: v.string(),
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	requestBodyJson: v.string(),
});

const nonTerminalRunStatuses = [
	"queued",
	"running",
	"waiting_for_user",
	"stopping",
] as const;
const queuedMessagesListLimit = 20;
const STALE_CLAIMED_MESSAGE_MS = 10_000;

const isNonTerminalRun = (run: Doc<"assistantRuns">) =>
	nonTerminalRunStatuses.some((status) => status === run.status);

const getOwnedActiveChatById = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);
	const chat = await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId.trim()),
		)
		.unique();

	if (!chat || chat.isArchived) {
		return null;
	}

	return chat;
};

const getOwnedRun = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	runId: Id<"assistantRuns">,
) => {
	const run = await ctx.db.get(runId);

	if (!run || run.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: "Assistant run not found.",
		});
	}

	return run;
};

const requireSavedQueuedMessage = async (
	ctx: QueryCtx | MutationCtx,
	queuedMessageId: Id<"assistantQueuedMessages">,
) => {
	const queuedMessage = await ctx.db.get(queuedMessageId);

	if (!queuedMessage) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message not found.",
		});
	}

	return queuedMessage;
};

const getNonTerminalRunsForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const runs = await Promise.all(
		nonTerminalRunStatuses.map((status) =>
			ctx.db
				.query("assistantRuns")
				.withIndex("by_chatId_and_status", (q) =>
					q.eq("chatId", chatId).eq("status", status),
				)
				.take(1),
		),
	);

	return runs.flat();
};

export const enqueueForActiveRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		message: queuedMessageInputValidator,
	},
	returns: queuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const run = await getOwnedRun(ctx, ownerTokenIdentifier, args.runId);
		if (
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id ||
			!isNonTerminalRun(run)
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_ACTIVE",
				message: "Assistant run is not active.",
			});
		}

		const now = Date.now();
		const queuedMessageId = await ctx.db.insert("assistantQueuedMessages", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			runId: run._id,
			messageId: args.message.messageId,
			partsJson: args.message.partsJson,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			requestBodyJson: args.message.requestBodyJson,
			status: "queued",
			createdAt: now,
			updatedAt: now,
			claimedAt: undefined,
		});
		const queuedMessage = await ctx.db.get(queuedMessageId);

		if (!queuedMessage) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_SAVE_FAILED",
				message: "Failed to queue assistant message.",
			});
		}

		return queuedMessage;
	},
});

export const listQueuedForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(queuedMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return [];
		}

		const now = Date.now();
		const [queuedMessages, claimedMessages] = await Promise.all([
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_chatId_and_status_and_createdAt", (q) =>
					q.eq("chatId", chat._id).eq("status", "queued"),
				)
				.take(queuedMessagesListLimit),
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_chatId_and_status_and_createdAt", (q) =>
					q.eq("chatId", chat._id).eq("status", "claimed"),
				)
				.take(queuedMessagesListLimit),
		]);

		return [...queuedMessages, ...claimedMessages]
			.filter(
				(message) =>
					message.status === "queued" ||
					(message.claimedAt ?? message.updatedAt) <
						now - STALE_CLAIMED_MESSAGE_MS,
			)
			.sort((a, b) => a.createdAt - b.createdAt)
			.slice(0, queuedMessagesListLimit);
	},
});

export const claimNextForRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		queuedMessageId: v.optional(v.id("assistantQueuedMessages")),
	},
	returns: v.union(queuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const run = await getOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (!isNonTerminalRun(run)) {
			return null;
		}

		const nextQueuedMessage = args.queuedMessageId
			? await ctx.db.get(args.queuedMessageId)
			: await ctx.db
					.query("assistantQueuedMessages")
					.withIndex("by_runId_and_status_and_createdAt", (q) =>
						q.eq("runId", run._id).eq("status", "queued"),
					)
					.first();

		if (!nextQueuedMessage) {
			return null;
		}
		if (
			nextQueuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			nextQueuedMessage.runId !== run._id ||
			nextQueuedMessage.status !== "queued"
		) {
			return null;
		}

		const now = Date.now();
		await ctx.db.patch(nextQueuedMessage._id, {
			status: "claimed",
			updatedAt: now,
			claimedAt: now,
		});

		return await requireSavedQueuedMessage(ctx, nextQueuedMessage._id);
	},
});

export const claimNextForChat = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(queuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const activeRuns = await getNonTerminalRunsForChat(ctx, chat._id);
		if (activeRuns.length > 0) {
			return null;
		}

		const now = Date.now();
		const claimedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status_and_createdAt", (q) =>
				q.eq("chatId", chat._id).eq("status", "claimed"),
			)
			.take(queuedMessagesListLimit);
		const staleClaimedMessage = claimedMessages.find(
			(message) =>
				(message.claimedAt ?? message.updatedAt) <
				now - STALE_CLAIMED_MESSAGE_MS,
		);
		const nextQueuedMessage =
			staleClaimedMessage ??
			(await ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_chatId_and_status_and_createdAt", (q) =>
					q.eq("chatId", chat._id).eq("status", "queued"),
				)
				.first());

		if (!nextQueuedMessage) {
			return null;
		}

		await ctx.db.patch(nextQueuedMessage._id, {
			status: "claimed",
			updatedAt: now,
			claimedAt: now,
		});

		return await requireSavedQueuedMessage(ctx, nextQueuedMessage._id);
	},
});

export const requeueClaimed = mutation({
	args: {
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: queuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const queuedMessage = await ctx.db.get(args.queuedMessageId);

		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message not found.",
			});
		}

		if (queuedMessage.status !== "claimed") {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_TRANSITION",
				message: "Queued message cannot be requeued.",
			});
		}

		await ctx.db.patch(queuedMessage._id, {
			status: "queued",
			updatedAt: Date.now(),
			claimedAt: undefined,
		});

		return await requireSavedQueuedMessage(ctx, queuedMessage._id);
	},
});

export const discardClaimed = mutation({
	args: {
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const queuedMessage = await ctx.db.get(args.queuedMessageId);

		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier
		) {
			return null;
		}

		if (queuedMessage.status !== "claimed") {
			return null;
		}

		await ctx.db.patch(queuedMessage._id, {
			status: "discarded",
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const discardQueued = mutation({
	args: {
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const queuedMessage = await ctx.db.get(args.queuedMessageId);

		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier
		) {
			return null;
		}

		if (queuedMessage.status !== "queued") {
			return null;
		}

		await ctx.db.patch(queuedMessage._id, {
			status: "discarded",
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const reorderQueuedForChat = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageIds: v.array(v.id("assistantQueuedMessages")),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const uniqueQueuedMessageIds = [...new Set(args.queuedMessageIds)];
		const queuedMessages = await Promise.all(
			uniqueQueuedMessageIds.map((queuedMessageId) =>
				ctx.db.get(queuedMessageId),
			),
		);
		if (
			queuedMessages.some(
				(queuedMessage) =>
					!queuedMessage ||
					queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
					queuedMessage.workspaceId !== args.workspaceId ||
					queuedMessage.chatId !== chat._id ||
					queuedMessage.status !== "queued",
			)
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_REORDER",
				message: "Queued messages cannot be reordered.",
			});
		}

		const existingQueuedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status_and_createdAt", (q) =>
				q.eq("chatId", chat._id).eq("status", "queued"),
			)
			.take(queuedMessagesListLimit);
		if (
			existingQueuedMessages.length !== uniqueQueuedMessageIds.length ||
			existingQueuedMessages.some(
				(queuedMessage) =>
					!uniqueQueuedMessageIds.some(
						(queuedMessageId) => queuedMessageId === queuedMessage._id,
					),
			)
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_REORDER",
				message: "Queued message order is stale.",
			});
		}

		const now = Date.now();
		const firstCreatedAt = Math.min(
			...existingQueuedMessages.map((queuedMessage) => queuedMessage.createdAt),
		);
		await Promise.all(
			uniqueQueuedMessageIds.map((queuedMessageId, index) =>
				ctx.db.patch(queuedMessageId, {
					createdAt: firstCreatedAt + index,
					updatedAt: now,
				}),
			),
		);

		return null;
	},
});

export const discardQueuedForRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const run = await getOwnedRun(ctx, ownerTokenIdentifier, args.runId);
		await discardQueuedForRunInternal(ctx, run._id);

		return null;
	},
});

export const discardQueuedForRunInternal = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const queuedMessageIds: Array<Id<"assistantQueuedMessages">> = [];
	for await (const message of ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_runId_and_status", (q) =>
			q.eq("runId", runId).eq("status", "queued"),
		)) {
		queuedMessageIds.push(message._id);
	}

	const now = Date.now();

	await Promise.all(
		queuedMessageIds.map((messageId) =>
			ctx.db.patch(messageId, {
				status: "discarded",
				updatedAt: now,
			}),
		),
	);
};
