import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
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
	runId: v.id("assistantRuns"),
	chatId: v.id("chats"),
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

const getActiveStreamByRunId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

const getToolCallByRunIdAndToolCallId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
	toolCallId: string,
) =>
	await ctx.db
		.query("chatToolCalls")
		.withIndex("by_runId_and_toolCallId", (q) =>
			q.eq("runId", runId).eq("toolCallId", toolCallId),
		)
		.unique();

const requireOwnedActiveStream = async (
	ctx: QueryCtx | MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId: Id<"assistantRuns">;
	},
) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(
		ctx,
		"chatToolCalls",
	);
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

	const run = await ctx.db.get(args.runId);
	if (
		!run ||
		run.ownerTokenIdentifier !== ownerTokenIdentifier ||
		run.chatId !== chat._id ||
		run.workspaceId !== args.workspaceId ||
		run.status !== "running"
	) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active chat stream not found.",
		});
	}

	const stream = await getActiveStreamByRunId(ctx, args.runId);

	if (!stream || stream.chatId !== chat._id) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active chat stream not found.",
		});
	}

	return { chat, run };
};

export const startActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		toolCallId: v.string(),
		toolName: v.string(),
		inputJson: v.optional(v.string()),
	},
	returns: chatToolCallValidator,
	handler: async (ctx, args) => {
		const { chat, run } = await requireOwnedActiveStream(ctx, args);
		const now = Date.now();
		const existingToolCall = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
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
			await appendAssistantRunEvent(ctx, run, {
				type: "tool.started",
				toolCallId: args.toolCallId,
				toolName: args.toolName,
			});

			return await requireToolCall(ctx, existingToolCall._id);
		}

		const toolCallId = await ctx.db.insert("chatToolCalls", {
			runId: run._id,
			chatId: chat._id,
			toolCallId: args.toolCallId,
			toolName: args.toolName,
			status: "pending",
			inputJson: args.inputJson,
			createdAt: now,
			updatedAt: now,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "tool.started",
			toolCallId: args.toolCallId,
			toolName: args.toolName,
		});

		return await requireToolCall(ctx, toolCallId);
	},
});

export const finishActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
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
		const { run } = await requireOwnedActiveStream(ctx, args);
		const toolCall = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
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
		await appendAssistantRunEvent(ctx, run, {
			type: "tool.completed",
			toolCallId: args.toolCallId,
			status: args.status,
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
