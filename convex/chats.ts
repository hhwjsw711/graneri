import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { discardQueuedForRunInternal } from "./assistantQueuedMessages";
import {
	getOwnedActiveChatById,
	nonTerminalRunStatuses,
} from "./assistantRunLifecycle";
import { deleteRunSnapshots } from "./assistantRuns";
import {
	moveLinkedAutomationToFreshChat,
	pauseLinkedAutomationForChat,
	resumeLinkedAutomationForChat,
} from "./automations";
import {
	clampWhitespace,
	getAuthorName,
	requireIdentity as requireDomainIdentity,
	requireTokenIdentifier as requireDomainTokenIdentifier,
	requireOwnedWorkspace,
	truncate,
	uppercaseFirstCharacter,
} from "./domain";

const chatRoleValidator = v.union(
	v.literal("system"),
	v.literal("user"),
	v.literal("assistant"),
);

const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

const chatFields = {
	_id: v.id("chats"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	authorName: v.optional(v.string()),
	chatId: v.string(),
	noteId: v.optional(v.id("notes")),
	isStarred: v.optional(v.boolean()),
	starredSortOrder: v.number(),
	title: v.string(),
	preview: v.string(),
	model: v.optional(v.string()),
	reasoningEffort: v.optional(reasoningEffortValidator),
	isArchived: v.boolean(),
	archivedAt: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
	lastMessageAt: v.number(),
};

const chatValidator = v.object(chatFields);

const chatMessageFields = {
	_id: v.id("chatMessages"),
	_creationTime: v.number(),
	chatId: v.id("chats"),
	ownerTokenIdentifier: v.string(),
	messageId: v.string(),
	role: chatRoleValidator,
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
};

const chatMessageValidator = v.object(chatMessageFields);

const chatActiveStreamValidator = v.object({
	_id: v.id("chatActiveStreams"),
	_creationTime: v.number(),
	runId: v.id("assistantRuns"),
	chatId: v.id("chats"),
	assistantMessageId: v.string(),
	text: v.string(),
	updatedAt: v.number(),
});

const storedUiMessageSnapshotFields = {
	id: v.string(),
	role: chatRoleValidator,
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	createdAt: v.number(),
};

const storedUiMessageSnapshotValidator = v.object(
	storedUiMessageSnapshotFields,
);

const storedUiMessageValidator = v.object({
	...storedUiMessageSnapshotFields,
	text: v.string(),
});

const chatMessageInputValidator = v.object({
	id: v.string(),
	role: chatRoleValidator,
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
});

const removeAllChatsResultValidator = v.object({
	deletedCount: v.number(),
	hasMore: v.boolean(),
});

const MAX_CHAT_PREVIEW_LENGTH = 180;
const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_CHAT_INPUT_TEXT_CHARS = 1_048_576;
const MAX_RETURNED_CHATS = 100;
const MAX_RETURNED_CHAT_MESSAGES = 200;
const REMOVE_CHAT_MESSAGES_BATCH_SIZE = 100;
const REMOVE_ALL_CHATS_BATCH_SIZE = 25;
const REMOVE_CHAT_RUNTIME_BATCH_SIZE = 100;
const NOTE_CHAT_BATCH_SIZE = 25;
const CONVEX_STORAGE_PATH_SEGMENT = "/api/storage/";

const requireIdentity = async (ctx: QueryCtx | MutationCtx) =>
	await requireDomainIdentity(ctx, "chats");

const requireTokenIdentifier = async (ctx: QueryCtx | MutationCtx) => {
	return await requireDomainTokenIdentifier(ctx, "chats");
};

const normalizeChatTitle = (value: string | undefined) => {
	const normalized = clampWhitespace(value ?? "");

	return normalized
		? truncate(uppercaseFirstCharacter(normalized), MAX_CHAT_TITLE_LENGTH)
		: "New chat";
};

const normalizeOptionalChatTitle = (value: string | undefined) =>
	value === undefined ? undefined : normalizeChatTitle(value);

const normalizeChatPreview = (value: string | undefined) =>
	truncate(clampWhitespace(value ?? ""), MAX_CHAT_PREVIEW_LENGTH);

const getTextPartCharCount = (partsJson: string) => {
	try {
		const parts = JSON.parse(partsJson) as unknown;
		if (!Array.isArray(parts)) {
			return 0;
		}

		return parts.reduce((count, part) => {
			if (
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string"
			) {
				return count + Array.from(part.text).length;
			}
			return count;
		}, 0);
	} catch {
		return 0;
	}
};

const requireUserMessageInputWithinLimit = (message: {
	role: "system" | "user" | "assistant";
	partsJson: string;
	text: string;
}) => {
	if (message.role !== "user") {
		return;
	}

	const actualChars = Math.max(
		Array.from(message.text).length,
		getTextPartCharCount(message.partsJson),
	);
	if (actualChars <= MAX_CHAT_INPUT_TEXT_CHARS) {
		return;
	}

	throw new ConvexError({
		code: "INPUT_TOO_LARGE",
		message: `Input exceeds the maximum length of ${MAX_CHAT_INPUT_TEXT_CHARS} characters.`,
		actualChars,
		maxChars: MAX_CHAT_INPUT_TEXT_CHARS,
	});
};

const getOwnedChatById = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId),
		)
		.unique();

const moveAutomationToFreshChat = async (
	ctx: MutationCtx,
	chat: Doc<"chats">,
	now = Date.now(),
) => {
	await moveLinkedAutomationToFreshChat(
		ctx,
		chat.ownerTokenIdentifier,
		chat.workspaceId,
		chat.chatId,
		now,
	);
};

const getStoredChatMessages = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
) =>
	await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.order("desc")
		.take(MAX_RETURNED_CHAT_MESSAGES);

const getActiveStreamByChatId = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.unique();

const getActiveStreamByRunId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

const stopActiveRunsForChat = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const activeRunBatches = await Promise.all(
		nonTerminalRunStatuses.map((status) =>
			ctx.db
				.query("assistantRuns")
				.withIndex("by_chatId_and_status", (q) =>
					q.eq("chatId", chatId).eq("status", status),
				)
				.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		),
	);
	const activeRuns = activeRunBatches.flat();

	const now = Date.now();
	await Promise.all(
		activeRuns.map(async (run) => {
			await ctx.db.patch(run._id, {
				status: "stopped",
				stopReason: "superseded",
				errorText: undefined,
				pendingDecision: undefined,
				updatedAt: now,
				finishedAt: now,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "run.stopped",
				stopReason: "superseded",
			});
			await deleteRunSnapshots(ctx, run._id);
			await discardQueuedForRunInternal(ctx, run._id);
		}),
	);

	return activeRunBatches.some(
		(runs) => runs.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE,
	);
};

const deleteRunEventsBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const events = await ctx.db
		.query("assistantRunEvents")
		.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", runId))
		.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE);

	await Promise.all(events.map((event) => ctx.db.delete(event._id)));

	return events.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE;
};

const deleteChatRuntimeBatch = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const [activeStreams, queuedMessages, toolCalls, runs] = await Promise.all([
		ctx.db
			.query("chatActiveStreams")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		ctx.db
			.query("chatToolCalls")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		ctx.db
			.query("assistantRuns")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
	]);

	const eventBatchesHaveMore = await Promise.all(
		runs.map((run) => deleteRunEventsBatch(ctx, run._id)),
	);

	await Promise.all([
		...activeStreams.map((stream) => ctx.db.delete(stream._id)),
		...queuedMessages.map((message) => ctx.db.delete(message._id)),
		...toolCalls.map((toolCall) => ctx.db.delete(toolCall._id)),
		...runs
			.filter((_, index) => !eventBatchesHaveMore[index])
			.map((run) => ctx.db.delete(run._id)),
	]);

	return {
		hasMore:
			activeStreams.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			queuedMessages.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			toolCalls.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			runs.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			eventBatchesHaveMore.some(Boolean),
	};
};

const deleteChatRuntimeRecords = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const activeRunsHaveMore = await stopActiveRunsForChat(ctx, chatId);
	const result = await deleteChatRuntimeBatch(ctx, chatId);

	if (activeRunsHaveMore || result.hasMore) {
		await ctx.scheduler.runAfter(0, internal.chats.removeChatRuntimeRecords, {
			chatId,
		});
	}
};

const toStoredUiMessageSnapshot = (message: Doc<"chatMessages">) => ({
	id: message.messageId,
	role: message.role,
	partsJson: message.partsJson,
	metadataJson: message.metadataJson,
	createdAt: message.createdAt,
});

const toActiveStreamMessageSnapshot = (
	stream: Doc<"chatActiveStreams">,
): StoredUiMessageSnapshot => ({
	id: stream.assistantMessageId,
	role: "assistant",
	partsJson: JSON.stringify([{ type: "text", text: stream.text }]),
	createdAt: stream._creationTime,
});

type StoredUiMessageSnapshot = {
	id: string;
	role: "system" | "user" | "assistant";
	partsJson: string;
	metadataJson?: string;
	createdAt: number;
};

type StoredUiMessage = StoredUiMessageSnapshot & {
	text: string;
};

const shouldAppendActiveStreamMessage = (
	stream: Doc<"chatActiveStreams"> | null,
	messages: Array<{ id: string }>,
) =>
	Boolean(
		stream &&
			stream.text.length > 0 &&
			!messages.some((message) => message.id === stream.assistantMessageId),
	);

const withActiveStreamSnapshot = async <T extends StoredUiMessageSnapshot>(
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
	messages: T[],
	toActiveMessage: (stream: Doc<"chatActiveStreams">) => T,
) => {
	const stream = await getActiveStreamByChatId(ctx, chatId);

	if (!stream || !shouldAppendActiveStreamMessage(stream, messages)) {
		return messages;
	}

	return [...messages, toActiveMessage(stream)];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getStorageIdFromFilePart = (part: unknown): Id<"_storage"> | null => {
	if (!isRecord(part) || part.type !== "file") {
		return null;
	}

	const providerMetadata = part.providerMetadata;
	if (isRecord(providerMetadata)) {
		const graneriMetadata = providerMetadata.graneri;
		if (
			isRecord(graneriMetadata) &&
			typeof graneriMetadata.storageId === "string"
		) {
			return graneriMetadata.storageId as Id<"_storage">;
		}
	}

	if (typeof part.url !== "string") {
		return null;
	}

	const url = new URL(part.url);
	const storagePathIndex = url.pathname.indexOf(CONVEX_STORAGE_PATH_SEGMENT);

	if (storagePathIndex === -1) {
		return null;
	}

	const storageId = url.pathname
		.slice(storagePathIndex + CONVEX_STORAGE_PATH_SEGMENT.length)
		.split("/")[0];

	if (!storageId) {
		return null;
	}

	return storageId as Id<"_storage">;
};

const getMessageAttachmentStorageIds = (
	message: Pick<Doc<"chatMessages">, "partsJson">,
) => {
	try {
		const parts = JSON.parse(message.partsJson) as unknown;

		if (!Array.isArray(parts)) {
			throw new Error("Chat message parts must be an array.");
		}

		return parts.flatMap((part) => {
			const storageId = getStorageIdFromFilePart(part);
			return storageId ? [storageId] : [];
		});
	} catch (error) {
		throw new ConvexError({
			code: "INVALID_CHAT_ATTACHMENT_METADATA",
			message:
				error instanceof Error
					? error.message
					: "Chat attachment metadata is invalid.",
		});
	}
};

const getModelTextPartSignature = (partsJson: string) => {
	try {
		const parts = JSON.parse(partsJson) as unknown;

		if (!Array.isArray(parts)) {
			return null;
		}

		return JSON.stringify(
			parts.flatMap((part) => {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string" &&
					part.text.trim().length > 0
				) {
					return [{ type: "text", text: part.text }];
				}
				return [];
			}),
		);
	} catch {
		return null;
	}
};

const isAcceptedQueuedMessagePayload = ({
	message,
	queuedMessage,
}: {
	message: {
		id: string;
		partsJson: string;
		text: string;
	};
	queuedMessage: Pick<
		Doc<"assistantQueuedMessages">,
		"messageId" | "partsJson" | "text"
	>;
}) =>
	message.id === queuedMessage.messageId &&
	message.text === queuedMessage.text &&
	getModelTextPartSignature(message.partsJson) ===
		getModelTextPartSignature(queuedMessage.partsJson);

const getExistingStorageMetadata = async (
	ctx: MutationCtx,
	storageId: string,
) => {
	const normalizedStorageId = ctx.db.system.normalizeId("_storage", storageId);

	if (!normalizedStorageId) {
		throw new ConvexError({
			code: "INVALID_CHAT_ATTACHMENT_STORAGE_ID",
			message: "Chat attachment storage id is invalid.",
		});
	}

	return await ctx.db.system.get(normalizedStorageId);
};

const deleteChatMessageAttachments = async (
	ctx: MutationCtx,
	messages: Doc<"chatMessages">[],
) => {
	const storageIds = new Set(
		messages.flatMap((message) => getMessageAttachmentStorageIds(message)),
	);

	await Promise.all(
		Array.from(storageIds, async (storageId) => {
			const metadata = await getExistingStorageMetadata(ctx, storageId);

			if (metadata) {
				await ctx.storage.delete(metadata._id);
			}
		}),
	);
};

const requireOwnedNoteId = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
) => {
	const note = await ctx.db.get(noteId);

	if (
		!note ||
		note.ownerTokenIdentifier !== ownerTokenIdentifier ||
		note.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	return note;
};

const shouldReplaceChatTitle = (
	chat: Doc<"chats"> | null,
	nextTitle: string,
) => {
	if (!chat) {
		return true;
	}

	if (chat.title === "New chat") {
		return true;
	}

	return clampWhitespace(chat.title).length === 0 && nextTitle !== "New chat";
};

const deleteChatMessageBatch = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const messages = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.take(REMOVE_CHAT_MESSAGES_BATCH_SIZE);

	await deleteChatMessageAttachments(ctx, messages);
	await Promise.all(messages.map((message) => ctx.db.delete(message._id)));

	return {
		deletedCount: messages.length,
		hasMore: messages.length === REMOVE_CHAT_MESSAGES_BATCH_SIZE,
	};
};

const deleteChatBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const chats = await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_CHATS_BATCH_SIZE);

	await Promise.all(
		chats.map((chat) =>
			ctx.scheduler.runAfter(0, internal.chats.removeMessagesAndDeleteChat, {
				chatId: chat._id,
			}),
		),
	);

	return {
		deletedCount: chats.length,
		hasMore: chats.length === REMOVE_ALL_CHATS_BATCH_SIZE,
	};
};

const getNoteChatsByArchiveState = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
	isArchived: boolean,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_owner_ws_note_chat_arch_upd", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("noteId", noteId)
				.eq("isArchived", isArchived),
		)
		.take(NOTE_CHAT_BATCH_SIZE);

const getNoteChats = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
) =>
	await ctx.db
		.query("chats")
		.withIndex(
			"by_ownerTokenIdentifier_and_workspaceId_and_noteId_and_chatId",
			(q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("noteId", noteId),
		)
		.take(NOTE_CHAT_BATCH_SIZE);

const saveMessageForOwnerInternal = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		authorName?: string;
		chatId: string;
		noteId?: Id<"notes">;
		title?: string;
		preview?: string;
		model?: string;
		reasoningEffort?: "low" | "medium" | "high" | "xhigh";
		forceTitle?: boolean;
		message: {
			id: string;
			role: "system" | "user" | "assistant";
			partsJson: string;
			metadataJson?: string;
			text: string;
			createdAt: number;
		};
	},
) => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	requireUserMessageInputWithinLimit(args.message);
	const now = Date.now();
	const normalizedTitle = normalizeOptionalChatTitle(args.title);
	const normalizedPreview = normalizeChatPreview(
		args.preview ?? args.message.text,
	);
	const messageCreatedAt = args.message.createdAt || now;
	const storedChatId = clampWhitespace(args.chatId);
	const storedNoteId = args.noteId ?? undefined;
	const storedMessageId =
		clampWhitespace(args.message.id) ||
		`msg-${now}-${Math.random().toString(36).slice(2, 10)}`;

	if (storedNoteId) {
		await requireOwnedNoteId(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			storedNoteId,
		);
	}

	const existingChat = await getOwnedChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		storedChatId,
	);

	const chatId =
		existingChat?._id ??
		(await ctx.db.insert("chats", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: args.authorName,
			chatId: storedChatId,
			noteId: storedNoteId,
			isStarred: false,
			starredSortOrder: now,
			title: normalizedTitle ?? "New chat",
			preview: normalizedPreview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			isArchived: false,
			archivedAt: undefined,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: messageCreatedAt,
		}));

	if (existingChat) {
		const nextTitle =
			normalizedTitle &&
			(args.forceTitle || shouldReplaceChatTitle(existingChat, normalizedTitle))
				? normalizedTitle
				: existingChat.title;

		await ctx.db.patch(existingChat._id, {
			chatId: storedChatId,
			noteId: existingChat.noteId ?? storedNoteId,
			authorName: existingChat.authorName ?? args.authorName,
			workspaceId: args.workspaceId,
			title: nextTitle,
			preview: normalizedPreview,
			model: args.model ?? existingChat.model,
			reasoningEffort: args.reasoningEffort ?? existingChat.reasoningEffort,
			isArchived: false,
			archivedAt: undefined,
			updatedAt: now,
			lastMessageAt: messageCreatedAt,
		});
	}

	const existingMessage = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", chatId).eq("messageId", storedMessageId),
		)
		.unique();

	const messageId =
		existingMessage?._id ??
		(await ctx.db.insert("chatMessages", {
			chatId,
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			messageId: storedMessageId,
			role: args.message.role,
			partsJson: args.message.partsJson,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			createdAt: messageCreatedAt,
		}));

	if (existingMessage) {
		await ctx.db.patch(existingMessage._id, {
			role: args.message.role,
			partsJson: args.message.partsJson,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			createdAt: messageCreatedAt,
		});
	}

	const [chat, message] = await Promise.all([
		ctx.db.get(chatId),
		ctx.db.get(messageId),
	]);

	if (!chat || !message) {
		throw new ConvexError({
			code: "CHAT_SAVE_FAILED",
			message: "Failed to save chat message.",
		});
	}

	return {
		chat,
		message,
	};
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(chatValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		return await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(MAX_RETURNED_CHATS);
	},
});

export const listArchived = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(chatValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		return await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", true),
			)
			.order("desc")
			.take(MAX_RETURNED_CHATS);
	},
});

export const listForNote = query({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.array(chatValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		await requireOwnedNoteId(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
		);

		return await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_note_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.noteId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(MAX_RETURNED_CHATS);
	},
});

export const getSession = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(chatValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		return await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
	},
});

export const toggleStar = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.object({
		isStarred: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
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

		const isStarred = !(chat.isStarred ?? false);
		const now = Date.now();

		await ctx.db.patch(chat._id, {
			isStarred,
			starredSortOrder: isStarred ? now : chat.starredSortOrder,
			updatedAt: now,
		});

		return {
			isStarred,
		};
	},
});

export const getMessages = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(storedUiMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return [];
		}

		const messages = await getStoredChatMessages(ctx, chat._id);
		const storedMessages = messages.reverse().map((message) => ({
			...toStoredUiMessageSnapshot(message),
			text: message.text,
			createdAt: message.createdAt,
		}));

		return await withActiveStreamSnapshot(
			ctx,
			chat._id,
			storedMessages,
			(stream): StoredUiMessage => ({
				...toActiveStreamMessageSnapshot(stream),
				text: stream.text,
			}),
		);
	},
});

export const getMessagesSnapshot = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(storedUiMessageSnapshotValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return [];
		}

		const messages = await getStoredChatMessages(ctx, chat._id);

		return await withActiveStreamSnapshot(
			ctx,
			chat._id,
			messages.reverse().map(toStoredUiMessageSnapshot),
			toActiveStreamMessageSnapshot,
		);
	},
});

export const getMessagesForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(storedUiMessageValidator),
	handler: async (ctx, args) => {
		const chat = await getOwnedActiveChatById(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return [];
		}

		const messages = await getStoredChatMessages(ctx, chat._id);
		const storedMessages = messages.reverse().map((message) => ({
			...toStoredUiMessageSnapshot(message),
			text: message.text,
			createdAt: message.createdAt,
		}));

		return await withActiveStreamSnapshot(
			ctx,
			chat._id,
			storedMessages,
			(stream): StoredUiMessage => ({
				...toActiveStreamMessageSnapshot(stream),
				text: stream.text,
			}),
		);
	},
});

export const removeMessagesAndDeleteChat = internalMutation({
	args: {
		chatId: v.id("chats"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteChatMessageBatch(ctx, args.chatId);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.chats.removeMessagesAndDeleteChat,
				{
					chatId: args.chatId,
				},
			);
			return null;
		}

		const chat = await ctx.db.get(args.chatId);

		if (chat) {
			await moveAutomationToFreshChat(ctx, chat);
			await deleteChatRuntimeRecords(ctx, args.chatId);
			await ctx.db.delete(args.chatId);
		}

		return null;
	},
});

export const removeChatRuntimeRecords = internalMutation({
	args: {
		chatId: v.id("chats"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteChatRuntimeBatch(ctx, args.chatId);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.chats.removeChatRuntimeRecords, {
				chatId: args.chatId,
			});
		}

		return null;
	},
});

export const archiveForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const chats = await getNoteChatsByArchiveState(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
			false,
		);
		const timestamp = Date.now();

		await Promise.all(
			chats.map((chat) =>
				ctx.db.patch(chat._id, {
					isArchived: true,
					archivedAt: timestamp,
					updatedAt: timestamp,
				}),
			),
		);

		if (chats.length === NOTE_CHAT_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.archiveForNote, args);
		}

		return null;
	},
});

export const restoreForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const chats = await getNoteChatsByArchiveState(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
			true,
		);
		const timestamp = Date.now();

		await Promise.all(
			chats.map((chat) =>
				ctx.db.patch(chat._id, {
					isArchived: false,
					archivedAt: undefined,
					updatedAt: timestamp,
				}),
			),
		);

		if (chats.length === NOTE_CHAT_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.restoreForNote, args);
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
		const chats = await getNoteChats(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
		);

		await Promise.all(
			chats.map(async (chat) => {
				await deleteChatRuntimeRecords(ctx, chat._id);
				await ctx.db.delete(chat._id);

				const result = await deleteChatMessageBatch(ctx, chat._id);

				if (result.hasMore) {
					await ctx.scheduler.runAfter(
						0,
						internal.chats.removeMessagesAndDeleteChat,
						{
							chatId: chat._id,
						},
					);
				}
			}),
		);

		if (chats.length === NOTE_CHAT_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.removeForNote, args);
		}

		return null;
	},
});

export const saveMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		forceTitle: v.optional(v.boolean()),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		return await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			chatId: args.chatId,
			noteId: args.noteId,
			title: args.title,
			preview: args.preview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			message: args.message,
		});
	},
});

export const acceptSteeredUserMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		queuedMessageId: v.id("assistantQueuedMessages"),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
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

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Assistant run not found.",
			});
		}

		if (run.status !== "running" && run.status !== "waiting_for_user") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot accept steered user input.",
			});
		}

		const queuedMessage = await ctx.db.get(args.queuedMessageId);
		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id ||
			queuedMessage.runId !== run._id ||
			queuedMessage.status !== "claimed"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message was not accepted for steering.",
			});
		}

		if (args.message.role !== "user" || !args.message.text.trim()) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered message must be a non-empty user message.",
			});
		}
		if (
			!isAcceptedQueuedMessagePayload({
				message: args.message,
				queuedMessage,
			})
		) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered message must match the claimed queued message.",
			});
		}

		const savedMessage = await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			chatId: args.chatId,
			noteId: args.noteId,
			title: args.title,
			preview: args.preview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			message: args.message,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "turn.steer.accepted",
			queuedMessageId: queuedMessage._id,
			messageId: args.message.id,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "user.message.appended",
			messageId: args.message.id,
		});
		if (run.status === "waiting_for_user") {
			await ctx.db.patch(run._id, {
				status: "running",
				pendingDecision: undefined,
				updatedAt: Date.now(),
			});
		}
		await ctx.db.delete(queuedMessage._id);

		return savedMessage;
	},
});

export const acceptSteeredUserMessages = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		messages: v.array(
			v.object({
				queuedMessageId: v.id("assistantQueuedMessages"),
				message: chatMessageInputValidator,
			}),
		),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
	},
	returns: v.array(
		v.object({
			chat: chatValidator,
			message: chatMessageValidator,
		}),
	),
	handler: async (ctx, args) => {
		if (args.messages.length === 0) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered message batch cannot be empty.",
			});
		}

		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
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

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Assistant run not found.",
			});
		}

		if (run.status !== "running" && run.status !== "waiting_for_user") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot accept steered user input.",
			});
		}

		const queuedMessages = await Promise.all(
			args.messages.map((message) => ctx.db.get(message.queuedMessageId)),
		);
		for (const [index, queuedMessage] of queuedMessages.entries()) {
			const message = args.messages[index]?.message;
			if (
				!queuedMessage ||
				queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
				queuedMessage.workspaceId !== args.workspaceId ||
				queuedMessage.chatId !== chat._id ||
				queuedMessage.runId !== run._id ||
				queuedMessage.status !== "claimed"
			) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_CLAIMED",
					message: "Queued message was not accepted for steering.",
				});
			}
			if (!message || message.role !== "user" || !message.text.trim()) {
				throw new ConvexError({
					code: "INVALID_STEERED_MESSAGE",
					message: "Steered message must be a non-empty user message.",
				});
			}
			if (
				!isAcceptedQueuedMessagePayload({
					message,
					queuedMessage,
				})
			) {
				throw new ConvexError({
					code: "INVALID_STEERED_MESSAGE",
					message: "Steered message must match the claimed queued message.",
				});
			}
		}

		const savedMessages = [];
		for (const { message } of args.messages) {
			savedMessages.push(
				await saveMessageForOwnerInternal(ctx, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					authorName: getAuthorName(identity),
					chatId: args.chatId,
					noteId: args.noteId,
					title: args.title,
					preview: args.preview,
					model: args.model,
					reasoningEffort: args.reasoningEffort,
					message,
				}),
			);
		}

		for (const [index, queuedMessage] of queuedMessages.entries()) {
			if (!queuedMessage) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_CLAIMED",
					message: "Queued message was not accepted for steering.",
				});
			}
			const message = args.messages[index]?.message;
			if (!message) {
				throw new ConvexError({
					code: "INVALID_STEERED_MESSAGE",
					message: "Steered message must be a non-empty user message.",
				});
			}
			await appendAssistantRunEvent(ctx, run, {
				type: "turn.steer.accepted",
				queuedMessageId: queuedMessage._id,
				messageId: message.id,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "user.message.appended",
				messageId: message.id,
			});
		}
		if (run.status === "waiting_for_user") {
			await ctx.db.patch(run._id, {
				status: "running",
				pendingDecision: undefined,
				updatedAt: Date.now(),
			});
		}
		await Promise.all(
			queuedMessages.map((queuedMessage) =>
				queuedMessage ? ctx.db.delete(queuedMessage._id) : null,
			),
		);

		return savedMessages;
	},
});

export const acceptQueuedUserMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
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
			queuedMessage.chatId !== chat._id ||
			queuedMessage.status !== "claimed"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message was not accepted for replay.",
			});
		}

		if (args.message.role !== "user" || !args.message.text.trim()) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE",
				message: "Queued message must be a non-empty user message.",
			});
		}
		if (
			!isAcceptedQueuedMessagePayload({
				message: args.message,
				queuedMessage,
			})
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE",
				message: "Queued message must match the claimed queued message.",
			});
		}

		const savedMessage = await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			chatId: args.chatId,
			noteId: args.noteId,
			title: args.title,
			preview: args.preview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			message: args.message,
		});
		await ctx.db.delete(queuedMessage._id);

		return savedMessage;
	},
});

export const startActiveStream = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
	},
	returns: chatActiveStreamValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
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

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id ||
			run.status !== "running"
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Active assistant run not found.",
			});
		}

		const now = Date.now();
		const existingStream = await getActiveStreamByChatId(ctx, chat._id);

		if (existingStream) {
			throw new ConvexError({
				code: "ACTIVE_STREAM_EXISTS",
				message: "Chat already has an active stream snapshot.",
			});
		}

		const streamId = await ctx.db.insert("chatActiveStreams", {
			runId: run._id,
			chatId: chat._id,
			assistantMessageId: args.assistantMessageId,
			text: "",
			updatedAt: now,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "assistant.message.started",
			assistantMessageId: args.assistantMessageId,
		});
		const stream = await ctx.db.get(streamId);

		if (!stream) {
			throw new ConvexError({
				code: "STREAM_SAVE_FAILED",
				message: "Failed to start chat stream.",
			});
		}

		return stream;
	},
});

export const appendActiveStreamText = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		delta: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (!args.delta) {
			return null;
		}

		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
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

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Active assistant run not found.",
			});
		}

		if (run.status !== "running") {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_RUNNING",
				message: "Active stream text cannot be appended to a non-running run.",
			});
		}

		const stream = await getActiveStreamByRunId(ctx, args.runId);

		if (!stream || stream.chatId !== chat._id || stream.runId !== args.runId) {
			throw new ConvexError({
				code: "ACTIVE_STREAM_NOT_FOUND",
				message: "Active stream snapshot not found.",
			});
		}

		await ctx.db.patch(stream._id, {
			text: `${stream.text}${args.delta}`,
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const deleteActiveStreamSnapshot = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
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

		const stream = await getActiveStreamByRunId(ctx, args.runId);

		if (!stream || stream.chatId !== chat._id) {
			throw new ConvexError({
				code: "ACTIVE_STREAM_NOT_FOUND",
				message: "Active stream snapshot not found.",
			});
		}

		await deleteRunSnapshots(ctx, args.runId);

		return null;
	},
});

export const saveAssistantMessageForRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		forceTitle: v.optional(v.boolean()),
		message: chatMessageInputValidator,
	},
	returns: v.union(
		v.object({
			chat: chatValidator,
			message: chatMessageValidator,
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
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

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Assistant run not found.",
			});
		}

		if (
			run.status === "stopping" ||
			run.status === "stopped" ||
			run.status === "completed"
		) {
			return null;
		}

		if (run.status !== "running") {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_RUNNING",
				message: "Assistant message cannot be saved for a non-running run.",
			});
		}

		const savedMessage = await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			chatId: args.chatId,
			noteId: args.noteId,
			title: args.title,
			preview: args.preview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			forceTitle: args.forceTitle,
			message: {
				...args.message,
				role: "assistant",
			},
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "message.completed",
			assistantMessageId: args.message.id,
		});

		return savedMessage;
	},
});

export const stopActiveStream = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Assistant run not found.",
			});
		}

		const stream = await getActiveStreamByRunId(ctx, args.runId);
		const stoppedText = stream?.text.trim() ?? "";
		const stoppedAt = Date.now();

		if (
			run.status === "completed" ||
			run.status === "failed" ||
			run.status === "stopped"
		) {
			await deleteRunSnapshots(ctx, args.runId);
			return null;
		}

		if (stream && stoppedText.length > 0) {
			await saveMessageForOwnerInternal(ctx, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: args.chatId,
				model: run.model,
				reasoningEffort: run.reasoningEffort,
				message: {
					id: stream.assistantMessageId,
					role: "assistant",
					partsJson: JSON.stringify([{ type: "text", text: stream.text }]),
					metadataJson: JSON.stringify({ interrupted: true }),
					text: stoppedText,
					createdAt: stoppedAt,
				},
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "assistant.message.interrupted",
				assistantMessageId: stream.assistantMessageId,
			});
		}

		await deleteRunSnapshots(ctx, args.runId);

		return null;
	},
});

export const saveMessageForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		authorName: v.optional(v.string()),
		chatId: v.string(),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		forceTitle: v.optional(v.boolean()),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => await saveMessageForOwnerInternal(ctx, args),
});

export const truncateFromMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		messageId: v.string(),
	},
	returns: v.object({
		deletedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			clampWhitespace(args.chatId),
		);

		if (!chat || chat.isArchived) {
			return { deletedCount: 0 };
		}

		const targetMessageId = clampWhitespace(args.messageId);

		if (!targetMessageId) {
			return { deletedCount: 0 };
		}

		const messages = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
			.take(MAX_RETURNED_CHAT_MESSAGES);
		const targetIndex = messages.findIndex(
			(message) => message.messageId === targetMessageId,
		);

		if (targetIndex < 0) {
			return { deletedCount: 0 };
		}

		const messagesToDelete = messages.slice(targetIndex);
		const previousMessage = targetIndex > 0 ? messages[targetIndex - 1] : null;
		await deleteChatMessageAttachments(ctx, messagesToDelete);
		await Promise.all(
			messagesToDelete.map((message) => ctx.db.delete(message._id)),
		);
		await stopActiveRunsForChat(ctx, chat._id);

		await ctx.db.patch(chat._id, {
			preview: previousMessage?.text ?? "",
			updatedAt: Date.now(),
			lastMessageAt: previousMessage?.createdAt ?? chat.createdAt,
		});

		return {
			deletedCount: messagesToDelete.length,
		};
	},
});

export const updateTitle = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		title: v.string(),
		onlyIfReplaceable: v.optional(v.boolean()),
	},
	returns: v.object({
		title: v.string(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			clampWhitespace(args.chatId),
		);

		if (!chat || chat.isArchived) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const normalizedTitle = normalizeChatTitle(args.title);
		const nextTitle =
			args.onlyIfReplaceable && !shouldReplaceChatTitle(chat, normalizedTitle)
				? chat.title
				: normalizedTitle;

		if (nextTitle !== chat.title) {
			await ctx.db.patch(chat._id, {
				title: nextTitle,
				updatedAt: Date.now(),
			});
		}

		return {
			title: nextTitle,
		};
	},
});

export const setChatSettings = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			clampWhitespace(args.chatId),
		);

		if (!chat) {
			return null;
		}

		await ctx.db.patch(chat._id, {
			model:
				args.model === undefined
					? chat.model
					: clampWhitespace(args.model) || chat.model,
			reasoningEffort: args.reasoningEffort ?? chat.reasoningEffort,
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const moveToTrash = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const now = Date.now();
		await ctx.db.patch(chat._id, {
			isArchived: true,
			archivedAt: now,
			updatedAt: now,
		});
		await pauseLinkedAutomationForChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			chat.chatId,
			now,
		);

		return null;
	},
});

export const restore = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const now = Date.now();
		await ctx.db.patch(chat._id, {
			isArchived: false,
			archivedAt: undefined,
			updatedAt: now,
		});
		await resumeLinkedAutomationForChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			chat.chatId,
			now,
		);

		return null;
	},
});

export const remove = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const result = await deleteChatMessageBatch(ctx, chat._id);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.chats.removeMessagesAndDeleteChat,
				{
					chatId: chat._id,
				},
			);
			return null;
		}

		await moveAutomationToFreshChat(ctx, chat);
		await deleteChatRuntimeRecords(ctx, chat._id);
		await ctx.db.delete(chat._id);

		return null;
	},
});

export const removeAll = mutation({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: removeAllChatsResultValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(REMOVE_ALL_CHATS_BATCH_SIZE);

		await Promise.all(
			chats.map((chat) =>
				ctx.scheduler.runAfter(0, internal.chats.removeMessagesAndDeleteChat, {
					chatId: chat._id,
				}),
			),
		);

		if (chats.length === REMOVE_ALL_CHATS_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.removeAllForWorkspace, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return {
			deletedCount: chats.length,
			hasMore: chats.length === REMOVE_ALL_CHATS_BATCH_SIZE,
		};
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(REMOVE_ALL_CHATS_BATCH_SIZE);

		await Promise.all(
			chats.map((chat) =>
				ctx.scheduler.runAfter(0, internal.chats.removeMessagesAndDeleteChat, {
					chatId: chat._id,
				}),
			),
		);

		if (chats.length === REMOVE_ALL_CHATS_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.removeAllForWorkspace, {
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
		const chats = await deleteChatBatch(ctx, args.ownerTokenIdentifier);

		if (chats.hasMore) {
			await ctx.scheduler.runAfter(0, internal.chats.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});
