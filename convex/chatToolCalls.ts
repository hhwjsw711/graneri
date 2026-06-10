import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { requireTokenIdentifier } from "./domain";

const chatToolCallStatusValidator = v.union(
	v.literal("pending"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("denied"),
);

const chatToolCallValidator = v.object({
	_id: v.id("chatToolCalls"),
	_creationTime: v.number(),
	chatId: v.id("chats"),
	ownerTokenIdentifier: v.string(),
	messageId: v.string(),
	toolCallId: v.string(),
	toolName: v.string(),
	status: chatToolCallStatusValidator,
	inputJson: v.optional(v.string()),
	outputJson: v.optional(v.string()),
	errorText: v.optional(v.string()),
	createdAt: v.number(),
	updatedAt: v.number(),
});

const getOwnedActiveChatById = async (
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

const getActiveStreamByChatId = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.unique();

const getToolCallByChatIdAndMessageIdAndToolCallId = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
	messageId: string,
	toolCallId: string,
) =>
	await ctx.db
		.query("chatToolCalls")
		.withIndex("by_chatId_and_messageId_and_toolCallId", (q) =>
			q
				.eq("chatId", chatId)
				.eq("messageId", messageId)
				.eq("toolCallId", toolCallId),
		)
		.unique();

const requireOwnedActiveStream = async (
	ctx: QueryCtx | MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		messageId: string;
	},
) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(ctx, "chatToolCalls");
	const chat = await getOwnedActiveChatById(
		ctx,
		ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);

	if (!chat || chat.isArchived) {
		throw new ConvexError({
			code: "CHAT_NOT_FOUND",
			message: "Chat not found.",
		});
	}

	const stream = await getActiveStreamByChatId(ctx, chat._id);

	if (
		!stream ||
		stream.status !== "streaming" ||
		stream.messageId !== args.messageId
	) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active chat stream not found.",
		});
	}

	return { chat, ownerTokenIdentifier };
};

export const startActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		messageId: v.string(),
		toolCallId: v.string(),
		toolName: v.string(),
		inputJson: v.optional(v.string()),
	},
	returns: chatToolCallValidator,
	handler: async (ctx, args) => {
		const { chat, ownerTokenIdentifier } = await requireOwnedActiveStream(
			ctx,
			args,
		);
		const now = Date.now();
		const existingToolCall =
			await getToolCallByChatIdAndMessageIdAndToolCallId(
				ctx,
				chat._id,
				args.messageId,
				args.toolCallId,
			);

		if (existingToolCall) {
			await ctx.db.patch(existingToolCall._id, {
				toolName: args.toolName,
				status: "pending",
				inputJson: args.inputJson,
				outputJson: undefined,
				errorText: undefined,
				updatedAt: now,
			});

			return await requireToolCall(ctx, existingToolCall._id);
		}

		const toolCallId = await ctx.db.insert("chatToolCalls", {
			chatId: chat._id,
			ownerTokenIdentifier,
			messageId: args.messageId,
			toolCallId: args.toolCallId,
			toolName: args.toolName,
			status: "pending",
			inputJson: args.inputJson,
			createdAt: now,
			updatedAt: now,
		});

		return await requireToolCall(ctx, toolCallId);
	},
});

export const finishActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		messageId: v.string(),
		toolCallId: v.string(),
		status: v.union(
			v.literal("completed"),
			v.literal("failed"),
			v.literal("denied"),
		),
		outputJson: v.optional(v.string()),
		errorText: v.optional(v.string()),
	},
	returns: chatToolCallValidator,
	handler: async (ctx, args) => {
		const { chat } = await requireOwnedActiveStream(ctx, args);
		const toolCall = await getToolCallByChatIdAndMessageIdAndToolCallId(
			ctx,
			chat._id,
			args.messageId,
			args.toolCallId,
		);

		if (!toolCall) {
			throw new ConvexError({
				code: "TOOL_CALL_NOT_FOUND",
				message: "Chat tool call not found.",
			});
		}

		await ctx.db.patch(toolCall._id, {
			status: args.status,
			outputJson: args.outputJson,
			errorText: args.errorText,
			updatedAt: Date.now(),
		});

		return await requireToolCall(ctx, toolCall._id);
	},
});

const requireToolCall = async (
	ctx: MutationCtx,
	toolCallId: Id<"chatToolCalls">,
) => {
	const toolCall = await ctx.db.get(toolCallId);

	if (!toolCall) {
		throw new ConvexError({
			code: "TOOL_CALL_SAVE_FAILED",
			message: "Failed to save chat tool call.",
		});
	}

	return toolCall;
};
