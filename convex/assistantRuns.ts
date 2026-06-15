import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { discardQueuedForRunInternal } from "./assistantQueuedMessages";
import { requireOwnedWorkspace, requireTokenIdentifier } from "./domain";

const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

const assistantRunStatusValidator = v.union(
	v.literal("queued"),
	v.literal("running"),
	v.literal("waiting_for_user"),
	v.literal("stopping"),
	v.literal("stopped"),
	v.literal("failed"),
	v.literal("completed"),
);

const pendingDecisionValidator = v.union(
	v.object({
		type: v.literal("choose_workspace"),
		question: v.string(),
	}),
	v.object({
		type: v.literal("choose_note"),
		question: v.string(),
	}),
	v.object({
		type: v.literal("authorize_source"),
		source: v.string(),
		reason: v.string(),
	}),
	v.object({
		type: v.literal("clarify_scope"),
		question: v.string(),
	}),
);

const stopReasonValidator = v.union(
	v.literal("user_requested"),
	v.literal("superseded"),
	v.literal("cleanup_failed"),
);

const assistantRunValidator = v.object({
	_id: v.id("assistantRuns"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	assistantMessageId: v.string(),
	status: assistantRunStatusValidator,
	model: v.string(),
	reasoningEffort: v.optional(reasoningEffortValidator),
	phase: v.optional(v.string()),
	pendingDecision: v.optional(pendingDecisionValidator),
	stopReason: v.optional(stopReasonValidator),
	errorText: v.optional(v.string()),
	startedAt: v.number(),
	updatedAt: v.number(),
	finishedAt: v.optional(v.number()),
});

const nonTerminalRunStatuses = [
	"queued",
	"running",
	"waiting_for_user",
	"stopping",
] as const;

type NonTerminalRunStatus = (typeof nonTerminalRunStatuses)[number];

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

const getNonTerminalRunsForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const runs: Doc<"assistantRuns">[] = [];

	for (const status of nonTerminalRunStatuses) {
		for await (const run of ctx.db
			.query("assistantRuns")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chatId).eq("status", status),
			)) {
			runs.push(run);
		}
	}

	return runs;
};

export const deleteRunSnapshots = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const streamIds: Array<Id<"chatActiveStreams">> = [];
	for await (const stream of ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))) {
		streamIds.push(stream._id);
	}

	const toolCallIds: Array<Id<"chatToolCalls">> = [];
	for await (const toolCall of ctx.db
		.query("chatToolCalls")
		.withIndex("by_runId", (q) => q.eq("runId", runId))) {
		toolCallIds.push(toolCall._id);
	}

	await Promise.all([
		...streamIds.map((streamId) => ctx.db.delete(streamId)),
		...toolCallIds.map((toolCallId) => ctx.db.delete(toolCallId)),
	]);
};

const getNonTerminalRunsForWorkspace = async (
	ctx: QueryCtx,
	workspaceId: Id<"workspaces">,
) => {
	const runs: Doc<"assistantRuns">[] = [];

	for await (const run of ctx.db
		.query("assistantRuns")
		.withIndex("by_workspaceId_and_chatId", (q) =>
			q.eq("workspaceId", workspaceId),
		)) {
		if (isNonTerminalStatus(run.status)) {
			runs.push(run);
		}
	}

	return runs;
};

const requireOwnedRun = async (
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

const stopSupersededRun = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	now: number,
) => {
	await ctx.db.patch(run._id, {
		status: "stopped",
		stopReason: "superseded",
		errorText: undefined,
		pendingDecision: undefined,
		updatedAt: now,
		finishedAt: now,
	});
	await deleteRunSnapshots(ctx, run._id);
	await discardQueuedForRunInternal(ctx, run._id);
};

export const startAssistantRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		assistantMessageId: v.string(),
		model: v.string(),
		reasoningEffort: v.optional(reasoningEffortValidator),
		policy: v.union(
			v.literal("reject"),
			v.literal("return_existing"),
			v.literal("supersede"),
		),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
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

		const activeRuns = await getNonTerminalRunsForChat(ctx, chat._id);
		if (activeRuns.length > 0) {
			if (args.policy === "return_existing") {
				return activeRuns[0]!;
			}

			if (args.policy === "reject") {
				throw new ConvexError({
					code: "ASSISTANT_RUN_ACTIVE",
					message: "Chat already has an active assistant run.",
				});
			}

			const now = Date.now();
			await Promise.all(
				activeRuns.map((run) => stopSupersededRun(ctx, run, now)),
			);
		}

		const now = Date.now();
		const runId = await ctx.db.insert("assistantRuns", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			assistantMessageId: args.assistantMessageId,
			status: "running",
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			phase: undefined,
			pendingDecision: undefined,
			stopReason: undefined,
			errorText: undefined,
			startedAt: now,
			updatedAt: now,
			finishedAt: undefined,
		});
		const run = await ctx.db.get(runId);

		if (!run) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_SAVE_FAILED",
				message: "Failed to start assistant run.",
			});
		}

		return run;
	},
});

export const markAssistantRunRunning = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status !== "queued" && run.status !== "running") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot be marked running.",
			});
		}

		if (run.status === "queued") {
			await ctx.db.patch(run._id, {
				status: "running",
				updatedAt: Date.now(),
			});
		}

		return (await ctx.db.get(run._id))!;
	},
});

export const waitForUserDecision = mutation({
	args: {
		runId: v.id("assistantRuns"),
		pendingDecision: pendingDecisionValidator,
		phase: v.optional(v.string()),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status !== "running") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot wait for a user decision.",
			});
		}

		await ctx.db.patch(run._id, {
			status: "waiting_for_user",
			pendingDecision: args.pendingDecision,
			phase: args.phase,
			errorText: undefined,
			updatedAt: Date.now(),
		});

		return (await ctx.db.get(run._id))!;
	},
});

export const resumeAssistantRunAfterUserDecision = mutation({
	args: {
		runId: v.id("assistantRuns"),
		phase: v.optional(v.string()),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status !== "waiting_for_user") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot resume from a user decision.",
			});
		}

		await ctx.db.patch(run._id, {
			status: "running",
			pendingDecision: undefined,
			phase: args.phase,
			updatedAt: Date.now(),
		});

		return (await ctx.db.get(run._id))!;
	},
});

export const finishAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status !== "running") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot be completed.",
			});
		}

		const now = Date.now();
		await ctx.db.patch(run._id, {
			status: "completed",
			errorText: undefined,
			stopReason: undefined,
			pendingDecision: undefined,
			updatedAt: now,
			finishedAt: now,
		});
		await deleteRunSnapshots(ctx, run._id);

		return (await ctx.db.get(run._id))!;
	},
});

export const failAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		errorText: v.optional(v.string()),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (
			run.status !== "queued" &&
			run.status !== "running" &&
			run.status !== "waiting_for_user" &&
			run.status !== "stopping" &&
			run.status !== "failed"
		) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot be failed.",
			});
		}

		if (run.status !== "failed") {
			const now = Date.now();
			await ctx.db.patch(run._id, {
				status: "failed",
				errorText: args.errorText,
				pendingDecision: undefined,
				updatedAt: now,
				finishedAt: now,
			});
		}
		await deleteRunSnapshots(ctx, run._id);
		await discardQueuedForRunInternal(ctx, run._id);

		return (await ctx.db.get(run._id))!;
	},
});

export const requestStopAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		stopReason: v.optional(stopReasonValidator),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status === "stopping") {
			return run;
		}

		if (run.status !== "running" && run.status !== "waiting_for_user") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot be stopped.",
			});
		}

		await ctx.db.patch(run._id, {
			status: "stopping",
			stopReason: args.stopReason ?? "user_requested",
			pendingDecision: undefined,
			updatedAt: Date.now(),
		});

		return (await ctx.db.get(run._id))!;
	},
});

export const finishStoppedAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		if (run.status === "stopped") {
			await deleteRunSnapshots(ctx, run._id);
			return run;
		}

		if (run.status !== "stopping") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run stop has not been requested.",
			});
		}

		const now = Date.now();
		await ctx.db.patch(run._id, {
			status: "stopped",
			updatedAt: now,
			finishedAt: now,
		});
		await deleteRunSnapshots(ctx, run._id);
		await discardQueuedForRunInternal(ctx, run._id);

		return (await ctx.db.get(run._id))!;
	},
});

export const getAttachableRun = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(assistantRunValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
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

		const runs = await getNonTerminalRunsForChat(ctx, chat._id);
		return runs[0] ?? null;
	},
});

export const getActiveRunStatus = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(v.literal("streaming"), v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
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

		const runs = await getNonTerminalRunsForChat(ctx, chat._id);
		return runs.length > 0 ? "streaming" : null;
	},
});

export const listActiveChatIds = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRuns",
		);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const activeChatIds = new Set<string>();

		const runs = await getNonTerminalRunsForWorkspace(ctx, args.workspaceId);

		for (const run of runs) {
			if (run.ownerTokenIdentifier !== ownerTokenIdentifier) {
				continue;
			}

			const chat = await ctx.db.get(run.chatId);
			if (chat && !chat.isArchived) {
				activeChatIds.add(chat.chatId);
			}
		}

		return Array.from(activeChatIds);
	},
});

const isNonTerminalStatus = (
	status: Doc<"assistantRuns">["status"],
): status is NonTerminalRunStatus =>
	nonTerminalRunStatuses.some((candidate) => candidate === status);
