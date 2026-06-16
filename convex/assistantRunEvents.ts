import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { assistantRunEventValidator } from "./assistantRunEventModel";
import { requireTokenIdentifier } from "./domain";

const assistantRunEventRecordValidator = v.object({
	_id: v.id("assistantRunEvents"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
	eventIndex: v.number(),
	event: assistantRunEventValidator,
	createdAt: v.number(),
});

export const appendAssistantRunEvent = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	event: Doc<"assistantRunEvents">["event"],
) => {
	const latestEvent = await ctx.db
		.query("assistantRunEvents")
		.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
		.order("desc")
		.first();
	const eventIndex = latestEvent ? latestEvent.eventIndex + 1 : 0;

	await ctx.db.insert("assistantRunEvents", {
		ownerTokenIdentifier: run.ownerTokenIdentifier,
		workspaceId: run.workspaceId,
		chatId: run.chatId,
		runId: run._id,
		eventIndex,
		event,
		createdAt: Date.now(),
	});

	return eventIndex;
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

export const listRunEventsAfter = query({
	args: {
		runId: v.id("assistantRuns"),
		afterEventIndex: v.optional(v.number()),
		limit: v.optional(v.number()),
	},
	returns: v.array(assistantRunEventRecordValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistantRunEvents",
		);
		await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);
		const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
		const afterEventIndex = args.afterEventIndex ?? -1;

		return await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) =>
				q.eq("runId", args.runId).gt("eventIndex", afterEventIndex),
			)
			.order("asc")
			.take(limit);
	},
});
