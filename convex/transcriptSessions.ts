import { ConvexError, v } from "convex/values";
import { createTranscriptBlocksTextFromUtterances } from "../packages/ai/src/transcription.mjs";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

type TranscriptSessionStatus = Doc<"transcriptSessionStates">["status"];
type TranscriptRefinementStatus =
	Doc<"transcriptSessionStates">["refinementStatus"];
type SystemAudioSourceMode = "desktop-native" | "display-media" | "unsupported";

const transcriptSessionStatusValidator = v.union(
	v.literal("capturing"),
	v.literal("stopping"),
	v.literal("completed"),
	v.literal("failed"),
);

const terminalTranscriptSessionStatusValidator = v.union(
	v.literal("completed"),
	v.literal("failed"),
);

const transcriptRefinementStatusValidator = v.union(
	v.literal("idle"),
	v.literal("running"),
	v.literal("completed"),
	v.literal("failed"),
);

const systemAudioSourceModeValidator = v.union(
	v.literal("desktop-native"),
	v.literal("display-media"),
	v.literal("unsupported"),
);

const transcriptUtteranceInputValidator = v.object({
	utteranceId: v.string(),
	speaker: v.string(),
	source: v.union(v.literal("live"), v.literal("refined")),
	text: v.string(),
	startedAt: v.number(),
	endedAt: v.number(),
});

const transcriptSessionHotFields = {
	status: transcriptSessionStatusValidator,
	refinementStatus: transcriptRefinementStatusValidator,
	refinementError: v.optional(v.string()),
	systemAudioSourceMode: v.optional(systemAudioSourceModeValidator),
	endedAt: v.optional(v.number()),
	generatedNoteAt: v.optional(v.number()),
	updatedAt: v.number(),
	lastRefinedAt: v.optional(v.number()),
};

const transcriptSessionFields = {
	_id: v.id("transcriptSessions"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	noteId: v.id("notes"),
	startedAt: v.number(),
	finalTranscript: v.optional(v.string()),
	createdAt: v.number(),
	...transcriptSessionHotFields,
};

const transcriptUtteranceFields = {
	_id: v.id("transcriptUtterances"),
	_creationTime: v.number(),
	sessionId: v.id("transcriptSessions"),
	ownerTokenIdentifier: v.string(),
	noteId: v.id("notes"),
	utteranceId: v.string(),
	speaker: v.string(),
	source: v.union(v.literal("live"), v.literal("refined")),
	text: v.string(),
	startedAt: v.number(),
	endedAt: v.number(),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const transcriptSessionValidator = v.object(transcriptSessionFields);
const transcriptUtteranceValidator = v.object(transcriptUtteranceFields);

type HydratedTranscriptSession = Doc<"transcriptSessions"> & {
	status: TranscriptSessionStatus;
	refinementStatus: TranscriptRefinementStatus;
	refinementError?: string;
	systemAudioSourceMode?: SystemAudioSourceMode;
	endedAt?: number;
	generatedNoteAt?: number;
	updatedAt: number;
	lastRefinedAt?: number;
};

const transcriptSessionWithUtterancesValidator = v.union(
	v.object({
		session: transcriptSessionValidator,
		utterances: v.array(transcriptUtteranceValidator),
	}),
	v.null(),
);
const transcriptSessionSummaryValidator = v.union(
	transcriptSessionValidator,
	v.null(),
);

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access transcript sessions.",
		});
	}

	return identity;
};

const requireTokenIdentifier = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await requireIdentity(ctx);

	return identity.tokenIdentifier;
};

const requireOwnedNote = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	noteId: Id<"notes">,
) => {
	const note = await ctx.db.get(noteId);

	if (!note || note.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	return note;
};

const requireOwnedSession = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	sessionId: Id<"transcriptSessions">,
) => {
	const session = await ctx.db.get(sessionId);

	if (!session || session.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "TRANSCRIPT_SESSION_NOT_FOUND",
			message: "Transcript session not found.",
		});
	}

	return session;
};

const listSessionUtterances = async (
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"transcriptSessions">,
) => {
	const utterances: Doc<"transcriptUtterances">[] = [];

	for await (const utterance of ctx.db
		.query("transcriptUtterances")
		.withIndex("by_sessionId_and_startedAt", (q) =>
			q.eq("sessionId", sessionId),
		)) {
		utterances.push(utterance);
	}

	return utterances;
};

const getTranscriptSessionState = async (
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"transcriptSessions">,
) =>
	await ctx.db
		.query("transcriptSessionStates")
		.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
		.unique();

const requireTranscriptSessionState = async (
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"transcriptSessions">,
) => {
	const state = await getTranscriptSessionState(ctx, sessionId);

	if (!state) {
		throw new ConvexError({
			code: "TRANSCRIPT_SESSION_STATE_NOT_FOUND",
			message: "Transcript session state not found.",
		});
	}

	return state;
};

const hydrateTranscriptSession = (
	session: Doc<"transcriptSessions">,
	state: Doc<"transcriptSessionStates">,
): HydratedTranscriptSession => ({
	...session,
	status: state.status,
	refinementStatus: state.refinementStatus,
	refinementError: state.refinementError,
	systemAudioSourceMode: state.systemAudioSourceMode,
	endedAt: state.endedAt,
	generatedNoteAt: state.generatedNoteAt,
	updatedAt: state.updatedAt,
	lastRefinedAt: state.lastRefinedAt,
});

const patchTranscriptSessionState = async (
	ctx: MutationCtx,
	sessionId: Id<"transcriptSessions">,
	patch: Partial<Doc<"transcriptSessionStates">>,
) => {
	const state = await requireTranscriptSessionState(ctx, sessionId);

	await ctx.db.patch(state._id, patch);
};

const getLatestNoteSession = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	noteId: Id<"notes">,
) => {
	const session = await ctx.db
		.query("transcriptSessions")
		.withIndex("by_ownerTokenIdentifier_and_noteId_and_startedAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier).eq("noteId", noteId),
		)
		.order("desc")
		.first();

	if (!session) {
		return null;
	}

	return hydrateTranscriptSession(
		session,
		await requireTranscriptSessionState(ctx, session._id),
	);
};

const createTranscriptText = (utterances: Doc<"transcriptUtterances">[]) =>
	createTranscriptBlocksTextFromUtterances(
		utterances.map((utterance) => ({
			endedAt: utterance.endedAt,
			id: utterance.utteranceId,
			speaker: utterance.speaker,
			startedAt: utterance.startedAt,
			text: utterance.text,
		})),
	);

const createMarkGeneratedStatePatch = ({
	now,
	status,
}: {
	now: number;
	status: TranscriptSessionStatus;
}): Partial<Doc<"transcriptSessionStates">> =>
	status === "stopping"
		? {
				status: "completed",
				endedAt: now,
				generatedNoteAt: now,
				updatedAt: now,
			}
		: {
				generatedNoteAt: now,
				updatedAt: now,
			};

const deleteUtterancesForSessionBatch = async (
	ctx: MutationCtx,
	sessionId: Id<"transcriptSessions">,
	limit = 200,
) => {
	const utterances = await ctx.db
		.query("transcriptUtterances")
		.withIndex("by_sessionId_and_startedAt", (q) =>
			q.eq("sessionId", sessionId),
		)
		.take(limit);

	await Promise.all(
		utterances.map((utterance) => ctx.db.delete(utterance._id)),
	);

	return utterances.length === limit;
};

const deleteSessionCascade = async (
	ctx: MutationCtx,
	sessionId: Id<"transcriptSessions">,
) => {
	for (;;) {
		const hasMore = await deleteUtterancesForSessionBatch(ctx, sessionId);

		if (!hasMore) {
			break;
		}
	}

	const state = await getTranscriptSessionState(ctx, sessionId);

	if (state) {
		await ctx.db.delete(state._id);
	}

	await ctx.db.delete(sessionId);
};

export const getLatestSummaryForNote = query({
	args: {
		noteId: v.id("notes"),
	},
	returns: transcriptSessionSummaryValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedNote(ctx, ownerTokenIdentifier, args.noteId);

		return await getLatestNoteSession(ctx, ownerTokenIdentifier, args.noteId);
	},
});

export const getStoredTranscriptForNote = query({
	args: {
		noteId: v.id("notes"),
	},
	returns: transcriptSessionWithUtterancesValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedNote(ctx, ownerTokenIdentifier, args.noteId);
		const session = await getLatestNoteSession(
			ctx,
			ownerTokenIdentifier,
			args.noteId,
		);

		if (!session) {
			return null;
		}

		const utterances = await listSessionUtterances(ctx, session._id);
		const aggregatedFinalTranscript =
			createTranscriptText(utterances) || session.finalTranscript;

		return {
			session: {
				...session,
				finalTranscript: aggregatedFinalTranscript || undefined,
			},
			utterances,
		};
	},
});

export const startSession = mutation({
	args: {
		noteId: v.id("notes"),
		systemAudioSourceMode: v.optional(systemAudioSourceModeValidator),
	},
	returns: v.id("transcriptSessions"),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedNote(ctx, ownerTokenIdentifier, args.noteId);
		const now = Date.now();
		const sessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier,
			noteId: args.noteId,
			startedAt: now,
			finalTranscript: undefined,
			createdAt: now,
		});

		await ctx.db.insert("transcriptSessionStates", {
			sessionId,
			ownerTokenIdentifier,
			noteId: args.noteId,
			status: "capturing",
			refinementStatus: "idle",
			refinementError: undefined,
			systemAudioSourceMode: args.systemAudioSourceMode,
			endedAt: undefined,
			generatedNoteAt: undefined,
			createdAt: now,
			updatedAt: now,
			lastRefinedAt: undefined,
		});

		return sessionId;
	},
});

export const appendUtterance = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
		utterance: transcriptUtteranceInputValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const text = args.utterance.text.trim();

		if (!text) {
			return null;
		}

		const existing = await ctx.db
			.query("transcriptUtterances")
			.withIndex("by_sessionId_and_utteranceId", (q) =>
				q
					.eq("sessionId", args.sessionId)
					.eq("utteranceId", args.utterance.utteranceId),
			)
			.unique();
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				speaker: args.utterance.speaker,
				source: args.utterance.source,
				text,
				startedAt: args.utterance.startedAt,
				endedAt: args.utterance.endedAt,
				updatedAt: now,
			});
		} else {
			await ctx.db.insert("transcriptUtterances", {
				sessionId: args.sessionId,
				ownerTokenIdentifier,
				noteId: session.noteId,
				utteranceId: args.utterance.utteranceId,
				speaker: args.utterance.speaker,
				source: args.utterance.source,
				text,
				startedAt: args.utterance.startedAt,
				endedAt: args.utterance.endedAt,
				createdAt: now,
				updatedAt: now,
			});
		}

		await patchTranscriptSessionState(ctx, session._id, {
			updatedAt: now,
		});

		return null;
	},
});

export const completeSession = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
		finalTranscript: v.optional(v.string()),
		status: v.optional(terminalTranscriptSessionStatusValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const now = Date.now();
		const state = await requireTranscriptSessionState(ctx, session._id);

		if (state.status !== "capturing" && state.status !== "stopping") {
			throw new ConvexError({
				code: "TRANSCRIPT_SESSION_NOT_ACTIVE",
				message: "Transcript session is not active.",
			});
		}

		await ctx.db.patch(state._id, {
			status: args.status ?? "completed",
			endedAt: now,
			updatedAt: now,
		});
		const finalTranscript =
			args.finalTranscript?.trim() ||
			createTranscriptText(await listSessionUtterances(ctx, args.sessionId));
		await ctx.db.patch(args.sessionId, {
			finalTranscript: finalTranscript || undefined,
		});

		return null;
	},
});

export const requestStopSession = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const state = await requireTranscriptSessionState(ctx, session._id);

		if (state.status === "stopping") {
			return null;
		}

		if (state.status !== "capturing") {
			throw new ConvexError({
				code: "TRANSCRIPT_SESSION_NOT_CAPTURING",
				message: "Transcript session is not capturing.",
			});
		}

		await ctx.db.patch(state._id, {
			status: "stopping",
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const setRefinementStatus = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
		status: transcriptRefinementStatusValidator,
		error: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const now = Date.now();

		await patchTranscriptSessionState(ctx, session._id, {
			refinementStatus: args.status,
			refinementError: args.error?.trim() || undefined,
			updatedAt: now,
			lastRefinedAt:
				args.status === "completed" || args.status === "failed"
					? now
					: undefined,
		});

		return null;
	},
});

export const setSystemAudioSourceMode = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
		systemAudioSourceMode: systemAudioSourceModeValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const now = Date.now();

		await patchTranscriptSessionState(ctx, session._id, {
			systemAudioSourceMode: args.systemAudioSourceMode,
			updatedAt: now,
		});

		return null;
	},
});

export const markGenerated = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const state = await requireTranscriptSessionState(ctx, session._id);
		const now = Date.now();

		await ctx.db.patch(
			state._id,
			createMarkGeneratedStatePatch({
				now,
				status: state.status,
			}),
		);

		return null;
	},
});

export const replaceSpeakerUtterances = mutation({
	args: {
		sessionId: v.id("transcriptSessions"),
		targetSpeakers: v.array(v.string()),
		targetUtteranceIds: v.optional(v.array(v.string())),
		utterances: v.array(transcriptUtteranceInputValidator),
		finalTranscript: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const session = await requireOwnedSession(
			ctx,
			ownerTokenIdentifier,
			args.sessionId,
		);
		const currentUtterances = await listSessionUtterances(ctx, args.sessionId);
		const now = Date.now();

		await Promise.all(
			currentUtterances
				.filter((utterance) =>
					args.targetUtteranceIds?.length
						? args.targetUtteranceIds.includes(utterance.utteranceId)
						: args.targetSpeakers.includes(utterance.speaker),
				)
				.map((utterance) => ctx.db.delete(utterance._id)),
		);

		for (const utterance of args.utterances) {
			const text = utterance.text.trim();

			if (!text) {
				continue;
			}

			await ctx.db.insert("transcriptUtterances", {
				sessionId: args.sessionId,
				ownerTokenIdentifier,
				noteId: session.noteId,
				utteranceId: utterance.utteranceId,
				speaker: utterance.speaker,
				source: utterance.source,
				text,
				startedAt: utterance.startedAt,
				endedAt: utterance.endedAt,
				createdAt: now,
				updatedAt: now,
			});
		}

		await patchTranscriptSessionState(ctx, session._id, {
			refinementStatus: "completed",
			refinementError: undefined,
			lastRefinedAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(args.sessionId, {
			finalTranscript: args.finalTranscript?.trim() || undefined,
		});

		return null;
	},
});

export const removeForNote = internalMutation({
	args: {
		noteId: v.id("notes"),
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const sessions = await ctx.db
			.query("transcriptSessions")
			.withIndex("by_ownerTokenIdentifier_and_noteId_and_startedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("noteId", args.noteId),
			)
			.take(100);

		for (const session of sessions) {
			await deleteSessionCascade(ctx, session._id);
		}

		if (sessions.length === 100) {
			await ctx.scheduler.runAfter(
				0,
				internal.transcriptSessions.removeForNote,
				{
					noteId: args.noteId,
					ownerTokenIdentifier: args.ownerTokenIdentifier,
				},
			);
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
		const sessions = await ctx.db
			.query("transcriptSessions")
			.withIndex("by_ownerTokenIdentifier_and_startedAt", (q) =>
				q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.take(50);

		for (const session of sessions) {
			await deleteSessionCascade(ctx, session._id);
		}

		if (sessions.length === 50) {
			await ctx.scheduler.runAfter(
				0,
				internal.transcriptSessions.removeAllForOwner,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
				},
			);
		}

		return null;
	},
});
