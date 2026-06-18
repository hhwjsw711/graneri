import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { discardQueuedForRunInternal } from "./assistantQueuedMessages";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import {
	getNonTerminalRunsForChat,
	getOwnedActiveChatById,
	nonTerminalRunStatuses,
} from "./assistantRunLifecycle";
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

const expirableRunStatuses = ["queued", "running", "stopping"] as const;
const ASSISTANT_RUN_EXPIRATION_MS = 20 * 60 * 1000;
const ASSISTANT_RUN_CLEANUP_BATCH_SIZE = 8;
const ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE = 100;

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

	for (const status of nonTerminalRunStatuses) {
		for await (const run of ctx.db
			.query("assistantRuns")
			.withIndex("by_workspaceId_and_status", (q) =>
				q.eq("workspaceId", workspaceId).eq("status", status),
			)) {
			runs.push(run);
		}
	}

	return runs;
};

const getActiveStreamUpdatedAt = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const stream = await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

	return stream?.updatedAt ?? null;
};

const deleteRunEventsBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const events = await ctx.db
		.query("assistantRunEvents")
		.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", runId))
		.take(ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE);

	await Promise.all(events.map((event) => ctx.db.delete(event._id)));

	return events.length === ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE;
};

const deleteQueuedMessagesBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const statuses = ["queued", "claimed", "discarded"] as const;
	const batches = await Promise.all(
		statuses.map((status) =>
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", runId).eq("status", status),
				)
				.take(ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE),
		),
	);
	const messages = batches.flat();

	await Promise.all(messages.map((message) => ctx.db.delete(message._id)));

	return batches.some(
		(batch) => batch.length === ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE,
	);
};

const deleteRunRuntimeBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const [eventsHaveMore, queuedMessagesHaveMore] = await Promise.all([
		deleteRunEventsBatch(ctx, runId),
		deleteQueuedMessagesBatch(ctx, runId),
	]);

	await deleteRunSnapshots(ctx, runId);

	return eventsHaveMore || queuedMessagesHaveMore;
};

const terminalizeExpiredRun = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	now: number,
) => {
	if (run.status === "stopping") {
		await ctx.db.patch(run._id, {
			status: "stopped",
			stopReason: run.stopReason ?? "cleanup_failed",
			pendingDecision: undefined,
			errorText: undefined,
			updatedAt: now,
			finishedAt: now,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "run.stopped",
			stopReason: run.stopReason ?? "cleanup_failed",
		});
	} else {
		await ctx.db.patch(run._id, {
			status: "failed",
			pendingDecision: undefined,
			errorText: "Assistant run expired after its stream producer stopped.",
			updatedAt: now,
			finishedAt: now,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "run.failed",
			errorText: "Assistant run expired after its stream producer stopped.",
		});
	}

	await deleteRunSnapshots(ctx, run._id);
	await discardQueuedForRunInternal(ctx, run._id);
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

const requireSavedRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const run = await ctx.db.get(runId);

	if (!run) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_SAVE_FAILED",
			message: "Failed to save assistant run.",
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
	await appendAssistantRunEvent(ctx, run, {
		type: "run.stopped",
		stopReason: "superseded",
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
			v.literal("allow_concurrent"),
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
				const activeRun = activeRuns[0];
				if (!activeRun) {
					throw new ConvexError({
						code: "ASSISTANT_RUN_NOT_FOUND",
						message: "Active assistant run not found.",
					});
				}
				return activeRun;
			}

			if (args.policy === "reject") {
				throw new ConvexError({
					code: "ASSISTANT_RUN_ACTIVE",
					message: "Chat already has an active assistant run.",
				});
			}

			if (args.policy === "supersede") {
				const now = Date.now();
				await Promise.all(
					activeRuns.map((run) => stopSupersededRun(ctx, run, now)),
				);
			}
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

		await appendAssistantRunEvent(ctx, run, {
			type: "run.started",
			assistantMessageId: run.assistantMessageId,
			model: run.model,
			reasoningEffort: run.reasoningEffort,
		});

		return run;
	},
});

export const cleanupExpiredAssistantRuns = internalMutation({
	args: {
		scheduleContinuation: v.optional(v.boolean()),
	},
	returns: v.object({
		checked: v.number(),
		expired: v.number(),
		refreshed: v.number(),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const now = Date.now();
		const expiresBefore = now - ASSISTANT_RUN_EXPIRATION_MS;
		let checked = 0;
		let expired = 0;
		let refreshed = 0;
		let hasMore = false;

		for (const status of expirableRunStatuses) {
			const remainingBatchSize = ASSISTANT_RUN_CLEANUP_BATCH_SIZE - checked;
			if (remainingBatchSize <= 0) {
				hasMore = true;
				break;
			}

			const runsWithProbe = await ctx.db
				.query("assistantRuns")
				.withIndex("by_status_and_updatedAt", (q) =>
					q.eq("status", status).lt("updatedAt", expiresBefore),
				)
				.take(remainingBatchSize + 1);

			if (runsWithProbe.length > remainingBatchSize) {
				hasMore = true;
			}

			const runs = runsWithProbe.slice(0, remainingBatchSize);

			for (const run of runs) {
				checked += 1;
				const streamUpdatedAt =
					run.status === "running"
						? await getActiveStreamUpdatedAt(ctx, run._id)
						: null;

				if (streamUpdatedAt && streamUpdatedAt >= expiresBefore) {
					await ctx.db.patch(run._id, {
						updatedAt: streamUpdatedAt,
					});
					refreshed += 1;
					continue;
				}

				await terminalizeExpiredRun(ctx, run, now);
				expired += 1;
			}
		}

		if (hasMore && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(
				0,
				internal.assistantRuns.cleanupExpiredAssistantRuns,
				{},
			);
		}

		return { checked, expired, refreshed, hasMore };
	},
});

export const removeOrphanedRun = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.object({
		deleted: v.boolean(),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);

		if (!run) {
			return { deleted: false, hasMore: false };
		}

		const chat = await ctx.db.get(run.chatId);
		if (chat && !chat.isArchived) {
			return { deleted: false, hasMore: false };
		}

		const hasMore = await deleteRunRuntimeBatch(ctx, run._id);

		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.assistantRuns.removeOrphanedRun,
				{
					runId: run._id,
				},
			);
			return { deleted: false, hasMore: true };
		}

		await ctx.db.delete(run._id);
		return { deleted: true, hasMore: false };
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

		return await requireSavedRun(ctx, run._id);
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

		if (
			run.status === "completed" ||
			run.status === "stopped" ||
			run.status === "failed" ||
			run.status === "stopping"
		) {
			await deleteRunSnapshots(ctx, run._id);
			return run;
		}

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
		await appendAssistantRunEvent(ctx, run, {
			type: "input.requested",
			decisionType: args.pendingDecision.type,
		});

		return await requireSavedRun(ctx, run._id);
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

		return await requireSavedRun(ctx, run._id);
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
		await appendAssistantRunEvent(ctx, run, {
			type: "message.completed",
			assistantMessageId: run.assistantMessageId,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "run.completed",
		});
		await deleteRunSnapshots(ctx, run._id);

		return await requireSavedRun(ctx, run._id);
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
			await appendAssistantRunEvent(ctx, run, {
				type: "run.failed",
				errorText: args.errorText,
			});
		}
		await deleteRunSnapshots(ctx, run._id);
		await discardQueuedForRunInternal(ctx, run._id);

		return await requireSavedRun(ctx, run._id);
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

		return await requireSavedRun(ctx, run._id);
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

		if (
			run.status === "stopped" ||
			run.status === "completed" ||
			run.status === "failed"
		) {
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
		await appendAssistantRunEvent(ctx, run, {
			type: "run.stopped",
			stopReason: run.stopReason,
		});
		await deleteRunSnapshots(ctx, run._id);
		await discardQueuedForRunInternal(ctx, run._id);

		return await requireSavedRun(ctx, run._id);
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
