import { ConvexError, v } from "convex/values";
import {
	DEFAULT_CHAT_MODEL_ID,
	DEFAULT_REASONING_EFFORT,
	findReasoningEffort,
	isSupportedChatModel,
} from "../packages/ai/src/models.mjs";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const automationSchedulePeriodValidator = v.union(
	v.literal("hourly"),
	v.literal("daily"),
	v.literal("weekdays"),
	v.literal("weekly"),
);

const automationRunReasonValidator = v.union(
	v.literal("scheduled"),
	v.literal("manual"),
);

const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

const automationAppSourceProviderValidator = v.union(
	v.literal("google-calendar"),
	v.literal("google-drive"),
	v.literal("yandex-calendar"),
	v.literal("yandex-tracker"),
	v.literal("jira"),
	v.literal("jira-mcp"),
	v.literal("posthog"),
	v.literal("notion"),
	v.literal("zoom"),
	v.literal("context7"),
	v.literal("figma"),
	v.literal("linear"),
);

const automationAppSourceValidator = v.object({
	id: v.string(),
	label: v.string(),
	provider: automationAppSourceProviderValidator,
});

type AutomationAppSource = {
	id: string;
	label: string;
	provider:
		| "google-calendar"
		| "google-drive"
		| "yandex-calendar"
		| "yandex-tracker"
		| "jira"
		| "jira-mcp"
		| "posthog"
		| "notion"
		| "zoom"
		| "context7"
		| "figma"
		| "linear";
};

const automationListItemValidator = v.object({
	id: v.id("automations"),
	title: v.string(),
	prompt: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
	authorName: v.optional(v.string()),
	webSearchEnabled: v.boolean(),
	appsEnabled: v.boolean(),
	appSources: v.array(automationAppSourceValidator),
	schedulePeriod: automationSchedulePeriodValidator,
	scheduledAt: v.number(),
	timezone: v.string(),
	target: v.union(
		v.object({
			kind: v.literal("notes"),
			label: v.string(),
			noteIds: v.array(v.id("notes")),
		}),
		v.object({
			kind: v.literal("workspace"),
			label: v.string(),
		}),
	),
	chatId: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
	isPaused: v.boolean(),
	lastRunAt: v.union(v.number(), v.null()),
	nextRunAt: v.union(v.number(), v.null()),
});

const automationRunStartValidator = v.union(
	v.object({
		status: v.literal("started"),
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		authorName: v.optional(v.string()),
		title: v.string(),
		prompt: v.string(),
		model: v.string(),
		reasoningEffort: reasoningEffortValidator,
		chatId: v.string(),
		targetLabel: v.string(),
		webSearchEnabled: v.boolean(),
		appsEnabled: v.boolean(),
		appSources: v.array(automationAppSourceValidator),
		scheduledFor: v.number(),
		reason: automationRunReasonValidator,
		notes: v.array(
			v.object({
				title: v.string(),
				text: v.string(),
				updatedAt: v.number(),
			}),
		),
	}),
	v.object({
		status: v.literal("skipped"),
	}),
);

const automationRunActiveValidator = v.union(
	automationRunStartValidator,
	v.object({
		status: v.literal("stopped"),
	}),
);

const automationRunNowValidator = v.union(
	v.object({
		status: v.literal("started"),
		chatId: v.string(),
		runId: v.id("automationRuns"),
	}),
	v.object({
		status: v.literal("already_running"),
		chatId: v.string(),
	}),
	v.object({
		status: v.literal("chat_busy"),
		chatId: v.string(),
	}),
);

const runningAutomationRunValidator = v.union(
	v.object({
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
		title: v.string(),
		scheduledFor: v.number(),
		startedAt: v.number(),
	}),
	v.null(),
);

const MAX_RETURNED_AUTOMATIONS = 100;
const MAX_DUE_AUTOMATIONS = 50;
const MAX_CONTEXT_NOTES = 8;
const MAX_CONTEXT_NOTE_LENGTH = 2_000;
const MAX_APP_SOURCES = 8;
const STALE_SCHEDULED_FUNCTION_MS = 2 * 60 * 1000;
const DELETE_RUNS_BATCH_SIZE = 50;
const DELETE_AUTOMATIONS_BATCH_SIZE = 50;
const MAX_TARGET_NOTES = MAX_CONTEXT_NOTES;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type AutomationSchedulePeriod = Doc<"automations">["schedulePeriod"];
type AutomationTarget =
	| {
			kind: "notes";
			noteIds: Array<Id<"notes">>;
	  }
	| {
			kind: "workspace";
	  };

const automationTargetValidator = v.union(
	v.object({
		kind: v.literal("notes"),
		noteIds: v.array(v.id("notes")),
	}),
	v.object({
		kind: v.literal("workspace"),
	}),
);

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access automations.",
		});
	}

	return identity;
};

const requireOwnedWorkspace = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const workspace = await ctx.db.get(workspaceId);

	if (!workspace || workspace.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "WORKSPACE_NOT_FOUND",
			message: "Workspace not found.",
		});
	}

	return workspace;
};

const requireOwnedNote = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
) => {
	const note = await ctx.db.get(noteId);

	if (
		!note ||
		note.ownerTokenIdentifier !== ownerTokenIdentifier ||
		note.workspaceId !== workspaceId ||
		note.isArchived
	) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	return note;
};

const normalizeTargetNoteIds = (noteIds: Array<Id<"notes">>) => {
	const uniqueNoteIds = [...new Set(noteIds)];
	if (uniqueNoteIds.length === 0) {
		throw new ConvexError({
			code: "AUTOMATION_TARGET_REQUIRED",
			message: "Select at least one note or tool.",
		});
	}

	if (uniqueNoteIds.length > MAX_TARGET_NOTES) {
		throw new ConvexError({
			code: "AUTOMATION_TARGET_TOO_LARGE",
			message: `Select up to ${MAX_TARGET_NOTES} notes.`,
		});
	}

	return uniqueNoteIds;
};

const requireOwnedAutomationTarget = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	target: AutomationTarget,
) => {
	if (target.kind === "workspace") {
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);

		return {
			kind: "workspace" as const,
			targetNoteIds: undefined,
			targetLabel: "Workspace",
		};
	}

	const noteIds = normalizeTargetNoteIds(target.noteIds);
	const notes = [];
	for (const noteId of noteIds) {
		notes.push(
			await requireOwnedNote(ctx, ownerTokenIdentifier, workspaceId, noteId),
		);
	}

	return {
		kind: "notes" as const,
		targetNoteIds: noteIds,
		targetLabel:
			notes.length === 1
				? truncate(clampWhitespace(notes[0].title) || "Note", 80)
				: `${notes.length} notes`,
	};
};

const requireOwnedAutomation = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	automationId: Id<"automations">,
) => {
	const automation = await ctx.db.get(automationId);

	if (!automation || automation.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "AUTOMATION_NOT_FOUND",
			message: "Automation not found.",
		});
	}

	return automation;
};

const getAuthorName = (identity: Awaited<ReturnType<typeof requireIdentity>>) =>
	identity.name?.trim() || identity.email?.trim() || "Unknown user";

const clampWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const normalizeTitle = (title: string) => {
	const normalized = clampWhitespace(title);

	if (!normalized) {
		throw new ConvexError({
			code: "TITLE_REQUIRED",
			message: "Automation title is required.",
		});
	}

	return truncate(normalized, 80);
};

const normalizePrompt = (prompt: string) => {
	const normalized = clampWhitespace(prompt);

	if (!normalized) {
		throw new ConvexError({
			code: "PROMPT_REQUIRED",
			message: "Automation prompt is required.",
		});
	}

	return normalized;
};

const normalizeAppSources = (appSources: AutomationAppSource[] | undefined) => {
	const normalizedSources = [];
	const seenIds = new Set<string>();

	for (const source of appSources ?? []) {
		const id = clampWhitespace(source.id);
		const label = truncate(clampWhitespace(source.label), 80);

		if (!id || !label || seenIds.has(id)) {
			continue;
		}

		seenIds.add(id);
		normalizedSources.push({
			id,
			label,
			provider: source.provider,
		});
	}

	if (normalizedSources.length > MAX_APP_SOURCES) {
		throw new ConvexError({
			code: "TOO_MANY_APP_SOURCES",
			message: `Select up to ${MAX_APP_SOURCES} app sources.`,
		});
	}

	return normalizedSources;
};

const normalizeModel = (model: string | undefined) => {
	const normalized = clampWhitespace(model ?? "") || DEFAULT_CHAT_MODEL_ID;

	if (isSupportedChatModel(normalized)) {
		return normalized;
	}

	throw new ConvexError({
		code: "UNSUPPORTED_MODEL",
		message: "Unsupported automation model.",
	});
};

const normalizeReasoningEffort = (reasoningEffort: string | undefined) =>
	findReasoningEffort(reasoningEffort)?.id ?? DEFAULT_REASONING_EFFORT;

const normalizeTimezone = (timezone: string | undefined) =>
	clampWhitespace(timezone ?? "") || "UTC";

const createAutomationChatId = () =>
	`automation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getTimeParts = (scheduledAt: number) => {
	const scheduledDate = new Date(scheduledAt);

	return {
		dayOfWeek: scheduledDate.getUTCDay(),
		hours: scheduledDate.getUTCHours(),
		minutes: scheduledDate.getUTCMinutes(),
	};
};

const getDailyCandidate = (from: number, scheduledAt: number) => {
	const { hours, minutes } = getTimeParts(scheduledAt);
	const candidate = new Date(from);
	candidate.setUTCHours(hours, minutes, 0, 0);

	if (candidate.getTime() <= from) {
		candidate.setUTCDate(candidate.getUTCDate() + 1);
	}

	return candidate.getTime();
};

const getHourlyCandidate = (from: number, scheduledAt: number) => {
	const { minutes } = getTimeParts(scheduledAt);
	const candidate = new Date(from);
	candidate.setUTCMinutes(minutes, 0, 0);

	if (candidate.getTime() <= from) {
		candidate.setTime(candidate.getTime() + HOUR_MS);
	}

	return candidate.getTime();
};

const getWeekdayCandidate = (from: number, scheduledAt: number) => {
	let candidate = getDailyCandidate(from, scheduledAt);

	for (let attempt = 0; attempt < 7; attempt += 1) {
		const day = new Date(candidate).getUTCDay();
		if (day >= 1 && day <= 5) {
			return candidate;
		}
		candidate += DAY_MS;
	}

	return candidate;
};

const getWeeklyCandidate = (from: number, scheduledAt: number) => {
	const { dayOfWeek, hours, minutes } = getTimeParts(scheduledAt);
	const candidate = new Date(from);
	candidate.setUTCHours(hours, minutes, 0, 0);

	const dayOffset = (dayOfWeek - candidate.getUTCDay() + 7) % 7;
	candidate.setUTCDate(candidate.getUTCDate() + dayOffset);

	if (candidate.getTime() <= from) {
		candidate.setUTCDate(candidate.getUTCDate() + 7);
	}

	return candidate.getTime();
};

const getNextRunAt = ({
	from,
	scheduledAt,
	schedulePeriod,
}: {
	from: number;
	scheduledAt: number;
	schedulePeriod: AutomationSchedulePeriod;
}) => {
	switch (schedulePeriod) {
		case "hourly":
			return getHourlyCandidate(from, scheduledAt);
		case "weekdays":
			return getWeekdayCandidate(from, scheduledAt);
		case "weekly":
			return getWeeklyCandidate(from, scheduledAt);
		case "daily":
			return getDailyCandidate(from, scheduledAt);
	}
};

const cancelScheduledFunction = async (
	ctx: MutationCtx,
	scheduledFunctionId: Id<"_scheduled_functions"> | undefined,
) => {
	if (!scheduledFunctionId) {
		return;
	}

	try {
		await ctx.scheduler.cancel(scheduledFunctionId);
	} catch (error) {
		console.warn("Failed to cancel automation scheduled function", error);
	}
};

const scheduleAutomationRun = async (
	ctx: MutationCtx,
	automationId: Id<"automations">,
	nextRunAt: number,
) =>
	await ctx.scheduler.runAt(
		nextRunAt,
		internal.automationActions.runAutomation,
		{
			automationId,
			scheduledFor: nextRunAt,
			reason: "scheduled",
		},
	);

const toListItem = (automation: Doc<"automations">) => ({
	id: automation._id,
	title: automation.title,
	prompt: automation.prompt,
	model: normalizeModel(automation.model),
	reasoningEffort: normalizeReasoningEffort(automation.reasoningEffort),
	authorName: automation.authorName,
	webSearchEnabled: automation.webSearchEnabled ?? false,
	appsEnabled: automation.appsEnabled ?? true,
	appSources: automation.appSources ?? [],
	schedulePeriod: automation.schedulePeriod,
	scheduledAt: automation.scheduledAt,
	timezone: automation.timezone,
	target:
		automation.targetKind === "notes"
			? {
					kind: "notes" as const,
					label: automation.targetLabel,
					noteIds: automation.targetNoteIds ?? [],
				}
			: {
					kind: "workspace" as const,
					label: automation.targetLabel,
				},
	chatId: automation.chatId,
	createdAt: automation.createdAt,
	updatedAt: automation.updatedAt,
	isPaused: automation.isPaused,
	lastRunAt: automation.lastRunAt ?? null,
	nextRunAt: automation.nextRunAt ?? null,
});

const getRecentContextNotes = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
) => {
	if (automation.targetKind === "notes") {
		const notes = [];
		for (const noteId of automation.targetNoteIds ?? []) {
			const note = await ctx.db.get(noteId);
			if (
				note &&
				note.ownerTokenIdentifier === automation.ownerTokenIdentifier &&
				note.workspaceId === automation.workspaceId &&
				!note.isArchived
			) {
				notes.push(note);
			}
		}

		return notes.map((note) => ({
			title: note.title,
			text: truncate(note.searchableText, MAX_CONTEXT_NOTE_LENGTH),
			updatedAt: note.updatedAt,
		}));
	}

	return [];
};

const getActiveChatForAutomation = async (
	ctx: QueryCtx | MutationCtx,
	automation: Doc<"automations">,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", automation.ownerTokenIdentifier)
				.eq("workspaceId", automation.workspaceId)
				.eq("chatId", automation.chatId),
		)
		.unique();

const chatHasNonTerminalAssistantRun = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const nonTerminalStatuses = [
		"running",
		"waiting_for_user",
		"stopping",
	] as const;

	for (const status of nonTerminalStatuses) {
		const run = await ctx.db
			.query("assistantRuns")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chatId).eq("status", status),
			)
			.first();

		if (run) {
			return true;
		}
	}

	return false;
};

const beginAutomationRun = async (
	ctx: MutationCtx,
	args: {
		automationId: Id<"automations">;
		scheduledFor: number;
		reason: Doc<"automationRuns">["reason"];
	},
) => {
	const automation = await ctx.db.get(args.automationId);
	if (!automation) {
		return { status: "skipped" as const };
	}

	if (automation.activeRunId) {
		return { status: "skipped" as const };
	}

	if (
		args.reason === "scheduled" &&
		(automation.isPaused || automation.nextRunAt !== args.scheduledFor)
	) {
		return { status: "skipped" as const };
	}

	const chat = await getActiveChatForAutomation(ctx, automation);
	if (chat && (await chatHasNonTerminalAssistantRun(ctx, chat._id))) {
		return { status: "skipped" as const };
	}

	const now = Date.now();
	const runId = await ctx.db.insert("automationRuns", {
		automationId: automation._id,
		ownerTokenIdentifier: automation.ownerTokenIdentifier,
		workspaceId: automation.workspaceId,
		chatId: automation.chatId,
		scheduledFor: args.scheduledFor,
		reason: args.reason,
		status: "running",
		error: undefined,
		startedAt: now,
		completedAt: undefined,
		userMessageId: undefined,
		assistantMessageId: undefined,
		createdAt: now,
		updatedAt: now,
	});

	await ctx.db.patch(automation._id, {
		activeRunId: runId,
		lastRunAt: now,
		scheduledFunctionId: undefined,
		updatedAt: now,
	});

	return buildAutomationRunStart(ctx, automation, runId, args);
};

const buildAutomationRunStart = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	runId: Id<"automationRuns">,
	args: {
		scheduledFor: number;
		reason: Doc<"automationRuns">["reason"];
	},
) => ({
	status: "started" as const,
	automationId: automation._id,
	runId,
	ownerTokenIdentifier: automation.ownerTokenIdentifier,
	workspaceId: automation.workspaceId,
	authorName: automation.authorName,
	title: automation.title,
	prompt: automation.prompt,
	model: normalizeModel(automation.model),
	reasoningEffort: normalizeReasoningEffort(automation.reasoningEffort),
	chatId: automation.chatId,
	targetLabel: automation.targetLabel,
	webSearchEnabled: automation.webSearchEnabled ?? false,
	appsEnabled: automation.appsEnabled ?? true,
	appSources: automation.appSources ?? [],
	scheduledFor: args.scheduledFor,
	reason: args.reason,
	notes: await getRecentContextNotes(ctx, automation),
});

const getNextScheduleAfterRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	run: Doc<"automationRuns"> | null,
	now: number,
) => {
	const shouldScheduleNext =
		run?.reason === "scheduled" &&
		!automation.isPaused &&
		automation.nextRunAt === run.scheduledFor;

	if (!shouldScheduleNext) {
		return {
			nextRunAt: automation.nextRunAt,
			scheduledFunctionId: automation.scheduledFunctionId,
		};
	}

	const nextRunAt = getNextRunAt({
		from: Math.max(now, run.scheduledFor),
		scheduledAt: automation.scheduledAt,
		schedulePeriod: automation.schedulePeriod,
	});
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automation._id,
		nextRunAt,
	);

	return { nextRunAt, scheduledFunctionId };
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(automationListItemValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		const automations = await ctx.db
			.query("automations")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.order("desc")
			.take(MAX_RETURNED_AUTOMATIONS);

		return automations.map(toListItem);
	},
});

export const getRunningRunForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: runningAutomationRunValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		const automation = await ctx.db
			.query("automations")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("chatId", args.chatId),
			)
			.unique();

		if (!automation?.activeRunId) {
			return null;
		}

		const run = await ctx.db.get(automation.activeRunId);

		if (!run || run.status !== "running") {
			return null;
		}

		return {
			automationId: automation._id,
			runId: run._id,
			title: automation.title,
			scheduledFor: run.scheduledFor,
			startedAt: run.startedAt,
		};
	},
});

export const create = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		title: v.string(),
		prompt: v.string(),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		webSearchEnabled: v.optional(v.boolean()),
		appsEnabled: v.optional(v.boolean()),
		appSources: v.optional(v.array(automationAppSourceValidator)),
		schedulePeriod: automationSchedulePeriodValidator,
		scheduledAt: v.number(),
		timezone: v.optional(v.string()),
		target: automationTargetValidator,
		chatId: v.optional(v.string()),
	},
	returns: automationListItemValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const target = await requireOwnedAutomationTarget(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.target,
		);
		const now = Date.now();
		const prompt = normalizePrompt(args.prompt);
		const appSources = normalizeAppSources(args.appSources);
		const chatId = args.chatId
			? clampWhitespace(args.chatId)
			: createAutomationChatId();
		if (args.chatId) {
			const chat = await ctx.db
				.query("chats")
				.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", args.workspaceId)
						.eq("chatId", chatId),
				)
				.unique();

			if (!chat || chat.isArchived) {
				throw new ConvexError({
					code: "CHAT_NOT_FOUND",
					message: "Chat not found.",
				});
			}
		}
		const existingAutomation = await ctx.db
			.query("automations")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("chatId", chatId),
			)
			.unique();

		if (existingAutomation) {
			throw new ConvexError({
				code: "AUTOMATION_CHAT_ALREADY_EXISTS",
				message: "This chat already has an automation.",
			});
		}
		const nextRunAt = getNextRunAt({
			from: now,
			scheduledAt: args.scheduledAt,
			schedulePeriod: args.schedulePeriod,
		});
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			title: normalizeTitle(args.title),
			prompt,
			model: normalizeModel(args.model),
			reasoningEffort: normalizeReasoningEffort(args.reasoningEffort),
			webSearchEnabled: args.webSearchEnabled ?? false,
			appsEnabled: args.appsEnabled ?? true,
			appSources,
			schedulePeriod: args.schedulePeriod,
			scheduledAt: args.scheduledAt,
			timezone: normalizeTimezone(args.timezone),
			targetKind: target.kind,
			targetNoteIds: target.targetNoteIds,
			targetLabel: target.targetLabel,
			chatId,
			isPaused: false,
			nextRunAt,
			lastRunAt: undefined,
			activeRunId: undefined,
			scheduledFunctionId: undefined,
			createdAt: now,
			updatedAt: now,
		});
		const scheduledFunctionId = await scheduleAutomationRun(
			ctx,
			automationId,
			nextRunAt,
		);
		await ctx.db.patch(automationId, {
			scheduledFunctionId,
		});

		const automation = await ctx.db.get(automationId);
		if (!automation) {
			throw new ConvexError({
				code: "AUTOMATION_SAVE_FAILED",
				message: "Failed to save automation.",
			});
		}
		return toListItem(automation);
	},
});

export const update = mutation({
	args: {
		automationId: v.id("automations"),
		title: v.string(),
		prompt: v.string(),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		webSearchEnabled: v.optional(v.boolean()),
		appsEnabled: v.optional(v.boolean()),
		appSources: v.optional(v.array(automationAppSourceValidator)),
		schedulePeriod: automationSchedulePeriodValidator,
		scheduledAt: v.number(),
		timezone: v.optional(v.string()),
		target: automationTargetValidator,
	},
	returns: automationListItemValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const automation = await requireOwnedAutomation(
			ctx,
			ownerTokenIdentifier,
			args.automationId,
		);
		const target = await requireOwnedAutomationTarget(
			ctx,
			ownerTokenIdentifier,
			automation.workspaceId,
			args.target,
		);
		await cancelScheduledFunction(ctx, automation.scheduledFunctionId);
		const now = Date.now();
		const prompt = normalizePrompt(args.prompt);
		const appSources = normalizeAppSources(args.appSources);
		const nextRunAt = automation.isPaused
			? undefined
			: getNextRunAt({
					from: now,
					scheduledAt: args.scheduledAt,
					schedulePeriod: args.schedulePeriod,
				});
		const scheduledFunctionId = nextRunAt
			? await scheduleAutomationRun(ctx, automation._id, nextRunAt)
			: undefined;

		await ctx.db.patch(automation._id, {
			title: normalizeTitle(args.title),
			prompt,
			model: normalizeModel(args.model),
			reasoningEffort: normalizeReasoningEffort(args.reasoningEffort),
			webSearchEnabled: args.webSearchEnabled ?? false,
			appsEnabled: args.appsEnabled ?? true,
			appSources,
			schedulePeriod: args.schedulePeriod,
			scheduledAt: args.scheduledAt,
			timezone: normalizeTimezone(args.timezone),
			targetKind: target.kind,
			targetNoteIds: target.targetNoteIds,
			targetLabel: target.targetLabel,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});

		const updatedAutomation = await ctx.db.get(automation._id);
		if (!updatedAutomation) {
			throw new ConvexError({
				code: "AUTOMATION_SAVE_FAILED",
				message: "Failed to save automation.",
			});
		}

		return toListItem(updatedAutomation);
	},
});

export const togglePaused = mutation({
	args: {
		automationId: v.id("automations"),
	},
	returns: automationListItemValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const automation = await requireOwnedAutomation(
			ctx,
			ownerTokenIdentifier,
			args.automationId,
		);
		const now = Date.now();

		if (!automation.isPaused) {
			await cancelScheduledFunction(ctx, automation.scheduledFunctionId);
			await ctx.db.patch(automation._id, {
				isPaused: true,
				nextRunAt: undefined,
				scheduledFunctionId: undefined,
				updatedAt: now,
			});
		} else {
			const nextRunAt = getNextRunAt({
				from: now,
				scheduledAt: automation.scheduledAt,
				schedulePeriod: automation.schedulePeriod,
			});
			const scheduledFunctionId = await scheduleAutomationRun(
				ctx,
				automation._id,
				nextRunAt,
			);
			await ctx.db.patch(automation._id, {
				isPaused: false,
				nextRunAt,
				scheduledFunctionId,
				updatedAt: now,
			});
		}

		const updatedAutomation = await ctx.db.get(automation._id);
		if (!updatedAutomation) {
			throw new ConvexError({
				code: "AUTOMATION_SAVE_FAILED",
				message: "Failed to save automation.",
			});
		}

		return toListItem(updatedAutomation);
	},
});

export const runNow = mutation({
	args: {
		automationId: v.id("automations"),
	},
	returns: automationRunNowValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const automation = await requireOwnedAutomation(
			ctx,
			ownerTokenIdentifier,
			args.automationId,
		);
		const now = Date.now();

		if (automation.activeRunId) {
			return {
				status: "already_running" as const,
				chatId: automation.chatId,
			};
		}

		const chat = await getActiveChatForAutomation(ctx, automation);
		if (chat && (await chatHasNonTerminalAssistantRun(ctx, chat._id))) {
			return {
				status: "chat_busy" as const,
				chatId: automation.chatId,
			};
		}

		const run = await beginAutomationRun(ctx, {
			automationId: automation._id,
			scheduledFor: now,
			reason: "manual",
		});
		if (run.status !== "started") {
			return {
				status: "already_running" as const,
				chatId: automation.chatId,
			};
		}

		await ctx.scheduler.runAfter(0, internal.automationActions.runAutomation, {
			automationId: automation._id,
			scheduledFor: now,
			reason: "manual",
			reservedRunId: run.runId,
		});

		return {
			status: "started" as const,
			chatId: automation.chatId,
			runId: run.runId,
		};
	},
});

export const remove = mutation({
	args: {
		automationId: v.id("automations"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const automation = await requireOwnedAutomation(
			ctx,
			ownerTokenIdentifier,
			args.automationId,
		);
		await cancelScheduledFunction(ctx, automation.scheduledFunctionId);
		await ctx.db.delete(automation._id);
		await ctx.scheduler.runAfter(0, internal.automations.removeOrphanedRuns, {
			automationId: automation._id,
		});

		return null;
	},
});

const getLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) =>
	await ctx.db
		.query("automations")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId),
		)
		.unique();

const scheduleNextAutomationRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	now: number,
) => {
	const nextRunAt = getNextRunAt({
		from: now,
		scheduledAt: automation.scheduledAt,
		schedulePeriod: automation.schedulePeriod,
	});
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automation._id,
		nextRunAt,
	);

	return { nextRunAt, scheduledFunctionId };
};

export const pauseLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automation = await getLinkedAutomationForChat(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!automation || automation.isPaused) {
		return;
	}

	await cancelScheduledFunction(ctx, automation.scheduledFunctionId);
	await ctx.db.patch(automation._id, {
		isPaused: true,
		nextRunAt: undefined,
		scheduledFunctionId: undefined,
		updatedAt: now,
	});
};

export const resumeLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automation = await getLinkedAutomationForChat(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!automation?.isPaused) {
		return;
	}

	const { nextRunAt, scheduledFunctionId } = await scheduleNextAutomationRun(
		ctx,
		automation,
		now,
	);

	await ctx.db.patch(automation._id, {
		isPaused: false,
		nextRunAt,
		scheduledFunctionId,
		updatedAt: now,
	});
};

export const moveLinkedAutomationToFreshChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automation = await getLinkedAutomationForChat(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!automation) {
		return;
	}

	await cancelScheduledFunction(ctx, automation.scheduledFunctionId);
	const { nextRunAt, scheduledFunctionId } = await scheduleNextAutomationRun(
		ctx,
		automation,
		now,
	);

	await ctx.db.patch(automation._id, {
		chatId: createAutomationChatId(),
		isPaused: false,
		nextRunAt,
		scheduledFunctionId,
		updatedAt: now,
	});
};

export const beginRun = internalMutation({
	args: {
		automationId: v.id("automations"),
		scheduledFor: v.number(),
		reason: automationRunReasonValidator,
	},
	returns: automationRunStartValidator,
	handler: async (ctx, args) => await beginAutomationRun(ctx, args),
});

export const activateRun = internalMutation({
	args: {
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
		scheduledFor: v.number(),
		reason: automationRunReasonValidator,
	},
	returns: automationRunActiveValidator,
	handler: async (ctx, args) => {
		const [automation, run] = await Promise.all([
			ctx.db.get(args.automationId),
			ctx.db.get(args.runId),
		]);

		if (
			!automation ||
			!run ||
			run.status !== "running" ||
			automation.activeRunId !== run._id
		) {
			return { status: "stopped" as const };
		}

		return await buildAutomationRunStart(ctx, automation, run._id, args);
	},
});

export const isRunActive = internalMutation({
	args: {
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const [automation, run] = await Promise.all([
			ctx.db.get(args.automationId),
			ctx.db.get(args.runId),
		]);

		return Boolean(
			automation &&
				run &&
				run.status === "running" &&
				automation.activeRunId === run._id,
		);
	},
});

export const stopRun = mutation({
	args: {
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const automation = await requireOwnedAutomation(
			ctx,
			identity.tokenIdentifier,
			args.automationId,
		);
		const run = await ctx.db.get(args.runId);

		if (!run || run.automationId !== automation._id) {
			throw new ConvexError({
				code: "AUTOMATION_RUN_NOT_FOUND",
				message: "Automation run not found.",
			});
		}

		if (run.status !== "running" || automation.activeRunId !== run._id) {
			return null;
		}

		const now = Date.now();
		const { nextRunAt, scheduledFunctionId } = await getNextScheduleAfterRun(
			ctx,
			automation,
			run,
			now,
		);
		await ctx.db.patch(run._id, {
			status: "stopped",
			error: "Stopped by user.",
			completedAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(automation._id, {
			activeRunId: undefined,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});

		return null;
	},
});

export const completeRun = internalMutation({
	args: {
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
		userMessageId: v.string(),
		assistantMessageId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		const automation = await ctx.db.get(args.automationId);
		const now = Date.now();

		if (run && run.status !== "running") {
			return null;
		}

		if (run) {
			await ctx.db.patch(run._id, {
				status: "completed",
				completedAt: now,
				userMessageId: args.userMessageId,
				assistantMessageId: args.assistantMessageId,
				updatedAt: now,
			});
		}

		if (!automation || automation.activeRunId !== args.runId) {
			return null;
		}

		const { nextRunAt, scheduledFunctionId } = await getNextScheduleAfterRun(
			ctx,
			automation,
			run,
			now,
		);

		await ctx.db.patch(automation._id, {
			activeRunId: undefined,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});

		return null;
	},
});

export const failRun = internalMutation({
	args: {
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
		error: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		const automation = await ctx.db.get(args.automationId);
		const now = Date.now();

		if (run && run.status !== "running") {
			return null;
		}

		if (run) {
			await ctx.db.patch(run._id, {
				status: "failed",
				error: truncate(args.error, 1_000),
				completedAt: now,
				updatedAt: now,
			});
		}

		if (!automation || automation.activeRunId !== args.runId) {
			return null;
		}

		const { nextRunAt, scheduledFunctionId } = await getNextScheduleAfterRun(
			ctx,
			automation,
			run,
			now,
		);

		await ctx.db.patch(automation._id, {
			activeRunId: undefined,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});

		return null;
	},
});

export const reconcileDueAutomations = internalMutation({
	args: {},
	returns: v.object({
		scheduledCount: v.number(),
	}),
	handler: async (ctx) => {
		const now = Date.now();
		const dueAutomations = await ctx.db
			.query("automations")
			.withIndex("by_isPaused_and_nextRunAt", (q) =>
				q.eq("isPaused", false).lt("nextRunAt", now + 1),
			)
			.take(MAX_DUE_AUTOMATIONS);
		let scheduledCount = 0;

		for (const automation of dueAutomations) {
			if (automation.activeRunId) {
				continue;
			}

			if (
				automation.scheduledFunctionId &&
				automation.nextRunAt &&
				automation.nextRunAt > now - STALE_SCHEDULED_FUNCTION_MS
			) {
				continue;
			}

			const scheduledFunctionId = await ctx.scheduler.runAfter(
				0,
				internal.automationActions.runAutomation,
				{
					automationId: automation._id,
					scheduledFor: automation.nextRunAt ?? now,
					reason: "scheduled",
				},
			);
			await ctx.db.patch(automation._id, {
				scheduledFunctionId,
				updatedAt: now,
			});
			scheduledCount += 1;
		}

		return { scheduledCount };
	},
});

export const removeOrphanedRuns = internalMutation({
	args: {
		automationId: v.id("automations"),
	},
	returns: v.object({
		deletedCount: v.number(),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const automation = await ctx.db.get(args.automationId);

		if (automation) {
			return { deletedCount: 0, hasMore: false };
		}

		const runs = await ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", args.automationId),
			)
			.take(DELETE_RUNS_BATCH_SIZE);

		await Promise.all(runs.map((run) => ctx.db.delete(run._id)));

		const hasMore = runs.length === DELETE_RUNS_BATCH_SIZE;

		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.automations.removeOrphanedRuns, {
				automationId: args.automationId,
			});
		}

		return { deletedCount: runs.length, hasMore };
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const runs = await ctx.db
			.query("automationRuns")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.take(DELETE_RUNS_BATCH_SIZE);

		await Promise.all(runs.map((run) => ctx.db.delete(run._id)));

		if (runs.length === DELETE_RUNS_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.automations.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
			return null;
		}

		const automations = await ctx.db
			.query("automations")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.take(DELETE_AUTOMATIONS_BATCH_SIZE);

		await Promise.all(
			automations.map(async (automation) => {
				await cancelScheduledFunction(ctx, automation.scheduledFunctionId);
				await ctx.db.delete(automation._id);
			}),
		);

		if (automations.length === DELETE_AUTOMATIONS_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.automations.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});
