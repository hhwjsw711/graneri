import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	getNonTerminalRunsForChat,
	getOwnedActiveChatById,
	isNonTerminalRun,
} from "./assistantRunLifecycle";
import { requireTokenIdentifier } from "./domain";

const queuedMessageStatusValidator = v.union(
	v.literal("queued"),
	v.literal("claimed"),
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
type QueuedMessageInput = {
	messageId: string;
	partsJson: string;
	metadataJson?: string;
	text: string;
	requestBodyJson: string;
};

const queuedMessagesListLimit = 20;
const MAX_QUEUED_MESSAGE_TEXT_CHARS = 1_048_576;
const CLAIMED_QUEUE_MESSAGE_STALE_MS = 5 * 60 * 1000;

const parseJson = (value: string, errorCode: string, message: string) => {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new ConvexError({
			code: errorCode,
			message,
		});
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const getQueuedTextPartCharCount = (parts: unknown[]) =>
	parts.reduce<number>(
		(count, part) =>
			isRecord(part) &&
			part.type === "text" &&
			typeof part.text === "string"
				? count + Array.from(part.text).length
				: count,
		0,
	);

const getQueuedTextFromParts = (parts: unknown[]) =>
	parts
		.flatMap((part) =>
			isRecord(part) &&
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0
				? [part.text]
				: [],
		)
		.join("\n\n")
		.replace(/\s+/g, " ")
		.trim();

const requireValidQueuedMessageInput = (message: QueuedMessageInput) => {
	if (!message.messageId.trim()) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_ID_EMPTY",
			message: "Queued message id cannot be empty.",
		});
	}

	if (!message.text.trim()) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_EMPTY",
			message: "Queued message cannot be empty.",
		});
	}

	const parts = parseJson(
		message.partsJson,
		"QUEUED_MESSAGE_INVALID_PARTS",
		"Queued message parts are invalid.",
	);
	if (
		!Array.isArray(parts) ||
		!parts.some(
			(part) =>
				isRecord(part) &&
				part.type === "text" &&
				typeof part.text === "string" &&
				part.text.trim().length > 0,
		)
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_INVALID_PARTS",
			message: "Queued message parts are invalid.",
		});
	}
	const modelText = getQueuedTextFromParts(parts);
	if (message.text !== modelText) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_TEXT_MISMATCH",
			message: "Queued message text must match queued message parts.",
		});
	}
	const actualChars = Math.max(
		Array.from(message.text).length,
		getQueuedTextPartCharCount(parts),
	);
	if (actualChars > MAX_QUEUED_MESSAGE_TEXT_CHARS) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_TOO_LARGE",
			message: `Input exceeds the maximum length of ${MAX_QUEUED_MESSAGE_TEXT_CHARS} characters.`,
			actualChars,
			maxChars: MAX_QUEUED_MESSAGE_TEXT_CHARS,
		});
	}

	if (message.metadataJson !== undefined) {
		const metadata = parseJson(
			message.metadataJson,
			"QUEUED_MESSAGE_INVALID_METADATA",
			"Queued message metadata is invalid.",
		);
		if (!isRecord(metadata)) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_INVALID_METADATA",
				message: "Queued message metadata is invalid.",
			});
		}
	}

	const requestBody = parseJson(
		message.requestBodyJson,
		"QUEUED_MESSAGE_INVALID_REQUEST_BODY",
		"Queued message request body is invalid.",
	);
	if (!isRecord(requestBody)) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_INVALID_REQUEST_BODY",
			message: "Queued message request body is invalid.",
		});
	}
	if (
		Array.isArray(requestBody.localFolders) &&
		requestBody.localFolders.length > 0
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_LOCAL_FOLDERS_UNSAFE",
			message:
				"Queued messages cannot persist local folder selections.",
		});
	}
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

const isCurrentNonTerminalRunForChat = async (
	ctx: QueryCtx | MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	const activeRuns = await requireNoDuplicateActiveRunsForChat(ctx, run.chatId);

	return activeRuns[0]?._id === run._id;
};

const requireNoDuplicateActiveRunsForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const activeRuns = await getNonTerminalRunsForChat(ctx, chatId);

	if (activeRuns.length > 1) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			message: "Chat has multiple active assistant runs.",
		});
	}

	return activeRuns;
};

const requireValidSavedQueuedMessage = (
	queuedMessage: Doc<"assistantQueuedMessages">,
) => {
	requireValidQueuedMessageInput({
		messageId: queuedMessage.messageId,
		metadataJson: queuedMessage.metadataJson,
		partsJson: queuedMessage.partsJson,
		requestBodyJson: queuedMessage.requestBodyJson,
		text: queuedMessage.text,
	});
};

const isStaleClaimedMessage = (
	message: { claimedAt?: number; updatedAt: number },
	now: number,
) =>
	now -
		(message.claimedAt !== undefined ? message.claimedAt : message.updatedAt) >=
	CLAIMED_QUEUE_MESSAGE_STALE_MS;

const requeueStaleClaimedMessagesForRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	now: number,
) => {
	const staleClaimedMessageIds: Array<Id<"assistantQueuedMessages">> = [];
	for await (const message of ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_runId_and_status", (q) =>
			q.eq("runId", runId).eq("status", "claimed"),
		)) {
		if (isStaleClaimedMessage(message, now)) {
			staleClaimedMessageIds.push(message._id);
		}
	}

	await Promise.all(
		staleClaimedMessageIds.map((messageId) =>
			ctx.db.patch(messageId, {
				status: "queued",
				updatedAt: now,
				claimedAt: undefined,
			}),
		),
	);
};

const requeueStaleClaimedMessagesForChat = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
	now: number,
) => {
	const staleClaimedMessageIds: Array<Id<"assistantQueuedMessages">> = [];
	for await (const message of ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_status_and_createdAt", (q) =>
			q.eq("chatId", chatId).eq("status", "claimed"),
		)) {
		if (isStaleClaimedMessage(message, now)) {
			staleClaimedMessageIds.push(message._id);
		}
	}

	await Promise.all(
		staleClaimedMessageIds.map((messageId) =>
			ctx.db.patch(messageId, {
				status: "queued",
				updatedAt: now,
				claimedAt: undefined,
			}),
		),
	);
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
			!isNonTerminalRun(run) ||
			!(await isCurrentNonTerminalRunForChat(ctx, run))
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_ACTIVE",
				message: "Assistant run is not active.",
			});
		}

		requireValidQueuedMessageInput(args.message);

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

		await requireNoDuplicateActiveRunsForChat(ctx, chat._id);

		const queuedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status_and_createdAt", (q) =>
				q.eq("chatId", chat._id).eq("status", "queued"),
			)
			.take(queuedMessagesListLimit);

		return queuedMessages
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
		const isTargetedClaim = Boolean(args.queuedMessageId);
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const run = await getOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status !== "running" && run.status !== "waiting_for_user") {
			if (isTargetedClaim) {
				throw new ConvexError({
					code: "ASSISTANT_RUN_NOT_ACTIVE",
					message: "Assistant run is not active.",
				});
			}
			return null;
		}
		if (!(await isCurrentNonTerminalRunForChat(ctx, run))) {
			if (isTargetedClaim) {
				throw new ConvexError({
					code: "ASSISTANT_RUN_NOT_ACTIVE",
					message: "Assistant run is not active.",
				});
			}
			return null;
		}

		const now = Date.now();
		await requeueStaleClaimedMessagesForRun(ctx, run._id, now);
		const existingClaimedMessage = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", run._id).eq("status", "claimed"),
			)
			.first();
		if (existingClaimedMessage) {
			if (isTargetedClaim) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_FOUND",
					message: "Queued message is no longer available.",
				});
			}
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
			if (args.queuedMessageId) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_FOUND",
					message: "Queued message is no longer available.",
				});
			}
			return null;
		}
		if (
			nextQueuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			nextQueuedMessage.runId !== run._id ||
			nextQueuedMessage.status !== "queued"
		) {
			if (args.queuedMessageId) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_FOUND",
					message: "Queued message is no longer available.",
				});
			}
			return null;
		}
		requireValidSavedQueuedMessage(nextQueuedMessage);

		await ctx.db.patch(nextQueuedMessage._id, {
			status: "claimed",
			updatedAt: now,
			claimedAt: now,
		});

		return await requireSavedQueuedMessage(ctx, nextQueuedMessage._id);
	},
});

export const claimReadyForRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.array(queuedMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const run = await getOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (
			(run.status !== "running" && run.status !== "waiting_for_user") ||
			!(await isCurrentNonTerminalRunForChat(ctx, run))
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_ACTIVE",
				message: "Assistant run is not active.",
			});
		}

		const now = Date.now();
		await requeueStaleClaimedMessagesForRun(ctx, run._id, now);
		const existingClaimedMessage = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", run._id).eq("status", "claimed"),
			)
			.first();
		if (existingClaimedMessage) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}

		const targetedMessage = await ctx.db.get(args.queuedMessageId);
		if (
			!targetedMessage ||
			targetedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			targetedMessage.runId !== run._id ||
			targetedMessage.status !== "queued"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}
		requireValidSavedQueuedMessage(targetedMessage);

		const queuedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status_and_createdAt", (q) =>
				q.eq("runId", run._id).eq("status", "queued"),
			)
			.take(queuedMessagesListLimit);
		const claimedMessages = [
			targetedMessage,
			...queuedMessages
				.sort((a, b) => a.createdAt - b.createdAt)
				.filter((message) => message._id !== targetedMessage._id),
		].slice(0, queuedMessagesListLimit);

		for (const queuedMessage of claimedMessages) {
			if (
				queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
				queuedMessage.runId !== run._id ||
				queuedMessage.status !== "queued"
			) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_FOUND",
					message: "Queued message is no longer available.",
				});
			}
			requireValidSavedQueuedMessage(queuedMessage);
		}

		await Promise.all(
			claimedMessages.map((queuedMessage) =>
				ctx.db.patch(queuedMessage._id, {
					status: "claimed",
					updatedAt: now,
					claimedAt: now,
				}),
			),
		);

		return await Promise.all(
			claimedMessages.map((queuedMessage) =>
				requireSavedQueuedMessage(ctx, queuedMessage._id),
			),
		);
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

		const activeRuns = await requireNoDuplicateActiveRunsForChat(ctx, chat._id);
		if (activeRuns.length > 0) {
			return null;
		}

		const now = Date.now();
		await requeueStaleClaimedMessagesForChat(ctx, chat._id, now);
		const nextQueuedMessage = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status_and_createdAt", (q) =>
				q.eq("chatId", chat._id).eq("status", "queued"),
				)
				.first();

			if (!nextQueuedMessage) {
				return null;
			}
			if (
				nextQueuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
				nextQueuedMessage.workspaceId !== args.workspaceId ||
				nextQueuedMessage.chatId !== chat._id ||
				nextQueuedMessage.status !== "queued"
			) {
				return null;
			}
			requireValidSavedQueuedMessage(nextQueuedMessage);

			await ctx.db.patch(nextQueuedMessage._id, {
				status: "claimed",
				updatedAt: now,
				claimedAt: now,
		});

		return await requireSavedQueuedMessage(ctx, nextQueuedMessage._id);
	},
});

export const getClaimedForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
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
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		await requireNoDuplicateActiveRunsForChat(ctx, chat._id);

		const queuedMessage = await ctx.db.get(args.queuedMessageId);
		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}

		if (queuedMessage.status !== "claimed") {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message is not claimed.",
			});
		}
		requireValidSavedQueuedMessage(queuedMessage);

		return queuedMessage;
	},
});

export const discardClaimed = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
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
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		const queuedMessage = await ctx.db.get(args.queuedMessageId);

		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}

		if (queuedMessage.status !== "claimed") {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message is not claimed.",
			});
		}

		await ctx.db.delete(queuedMessage._id);

		return null;
	},
});

export const discardQueued = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
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
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		const queuedMessage = await ctx.db.get(args.queuedMessageId);

		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}

		if (queuedMessage.status !== "queued") {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}

		await ctx.db.delete(queuedMessage._id);

		return null;
	},
});

export const updateQueued = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		message: queuedMessageInputValidator,
	},
	returns: queuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantQueuedMessages",
		);
		const queuedMessage = await requireSavedQueuedMessage(
			ctx,
			args.queuedMessageId,
		);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (
			!chat ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id ||
			queuedMessage.status !== "queued"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}
		await requireNoDuplicateActiveRunsForChat(ctx, chat._id);

		requireValidQueuedMessageInput(args.message);

		const now = Date.now();
		await ctx.db.patch(queuedMessage._id, {
			messageId: args.message.messageId,
			partsJson: args.message.partsJson,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			requestBodyJson: args.message.requestBodyJson,
			updatedAt: now,
		});

		return {
			...queuedMessage,
			messageId: args.message.messageId,
			partsJson: args.message.partsJson,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			requestBodyJson: args.message.requestBodyJson,
			updatedAt: now,
		};
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
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		await requireNoDuplicateActiveRunsForChat(ctx, chat._id);

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
	await discardMessagesForRunByStatus(ctx, runId, ["queued", "claimed"]);
};

export const discardClaimedForRunInternal = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	await discardMessagesForRunByStatus(ctx, runId, ["claimed"]);
};

const discardMessagesForRunByStatus = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	statuses: ReadonlyArray<"queued" | "claimed">,
) => {
	const queuedMessageIds: Array<Id<"assistantQueuedMessages">> = [];
	for (const status of statuses) {
		for await (const message of ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", runId).eq("status", status),
			)) {
			queuedMessageIds.push(message._id);
		}
	}

	await Promise.all(
		queuedMessageIds.map((messageId) => ctx.db.delete(messageId)),
	);
};
