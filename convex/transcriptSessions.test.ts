import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createNoteFixture = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const noteId = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		});

		return await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
	});

	return { asOwner, noteId, t };
};

type NoteFixture = Awaited<ReturnType<typeof createNoteFixture>>;
type TranscriptSessionId = Id<"transcriptSessions">;

const getSessionState = async (
	t: NoteFixture["t"],
	sessionId: TranscriptSessionId,
) =>
	await t.run(async (ctx) =>
		ctx.db
			.query("transcriptSessionStates")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
			.unique(),
	);

test("requestStopSession records durable stop intent before capture cleanup", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);

	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});
	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});

	const state = await getSessionState(t, sessionId);

	expect(state?.status).toBe("stopping");
	expect(state?.endedAt).toBeUndefined();
});

test("completeSession terminalizes a stopping transcript session", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);

	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
		finalTranscript: " Final transcript ",
	});

	const state = await getSessionState(t, sessionId);
	const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

	expect(state?.status).toBe("completed");
	expect(state?.endedAt).toEqual(expect.any(Number));
	expect(session?.finalTranscript).toBe("Final transcript");
});

test("completeSession stores aggregate utterance transcript when no final text is provided", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);

	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u1",
			speaker: "you",
			source: "live",
			text: " First captured sentence. ",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u2",
			speaker: "you",
			source: "live",
			text: "Second captured sentence.",
			startedAt: 2_000,
			endedAt: 2_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

	expect(session?.finalTranscript).toBe(
		"You: First captured sentence. Second captured sentence.",
	);
});

test("completeSession stores readable dynamic transcript sections", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);
	const firstExplanation =
		"Frontier post training has a lot of moving pieces and the recipe quality depends on how data, policy optimization, evaluation, distillation, preference modeling, and inference constraints reinforce each other during a real production rollout.";

	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u1",
			speaker: "them",
			source: "live",
			text: firstExplanation,
			startedAt: 1_000,
			endedAt: 2_000,
		},
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u2",
			speaker: "them",
			source: "live",
			text: "The next point is about why the serving cost changes the business model.",
			startedAt: 2_500,
			endedAt: 3_000,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

	expect(session?.finalTranscript).toBe(
		`Them: ${firstExplanation}\n\nThem: The next point is about why the serving cost changes the business model.`,
	);
});

test("completeSession preserves alternating speaker turns in persisted transcript text", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);

	for (const utterance of [
		{
			utteranceId: "them-1",
			speaker: "them",
			source: "live" as const,
			text: "Can you walk me through the rollout risk?",
			startedAt: 1_000,
			endedAt: 2_000,
		},
		{
			utteranceId: "you-1",
			speaker: "you",
			source: "live" as const,
			text: "The main risk is migration timing during active sessions.",
			startedAt: 2_100,
			endedAt: 3_000,
		},
		{
			utteranceId: "them-2",
			speaker: "them",
			source: "live" as const,
			text: "What happens if reconnect overlaps with note generation?",
			startedAt: 3_100,
			endedAt: 4_000,
		},
		{
			utteranceId: "you-2",
			speaker: "you",
			source: "live" as const,
			text: "We keep the draft append only and regenerate sections from utterances.",
			startedAt: 4_100,
			endedAt: 5_000,
		},
	]) {
		await asOwner.mutation(api.transcriptSessions.appendUtterance, {
			sessionId,
			utterance,
		});
	}

	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

	expect(session?.finalTranscript).toBe(
		[
			"Them: Can you walk me through the rollout risk?",
			"You: The main risk is migration timing during active sessions.",
			"Them: What happens if reconnect overlaps with note generation?",
			"You: We keep the draft append only and regenerate sections from utterances.",
		].join("\n\n"),
	);
});

test("stored transcript reads utterances from the latest session only", async () => {
	const { asOwner, noteId } = await createNoteFixture();
	const firstSessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId: firstSessionId,
		utterance: {
			utteranceId: "old",
			speaker: "you",
			source: "live",
			text: "Old recording text.",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId: firstSessionId,
	});
	const latestSessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId: latestSessionId,
		utterance: {
			utteranceId: "latest",
			speaker: "you",
			source: "live",
			text: "Latest recording text.",
			startedAt: 2_000,
			endedAt: 2_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId: latestSessionId,
	});

	const storedTranscript = await asOwner.query(
		api.transcriptSessions.getStoredTranscriptForNote,
		{
			noteId,
		},
	);

	expect(storedTranscript?.session._id).toBe(latestSessionId);
	expect(storedTranscript?.session.finalTranscript).toContain(
		"Latest recording text.",
	);
	expect(storedTranscript?.session.finalTranscript).not.toContain(
		"Old recording text.",
	);
	expect(storedTranscript?.utterances).toHaveLength(1);
	expect(storedTranscript?.utterances[0]?.sessionId).toBe(latestSessionId);
});

test("markGenerated terminalizes a recovered stopping transcript session", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);

	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});
	await asOwner.mutation(api.transcriptSessions.markGenerated, {
		sessionId,
	});

	const state = await getSessionState(t, sessionId);

	expect(state?.status).toBe("completed");
	expect(state?.endedAt).toEqual(expect.any(Number));
	expect(state?.generatedNoteAt).toEqual(expect.any(Number));
});

test("completeSession rejects already terminal transcript sessions", async () => {
	const { asOwner, noteId } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
		},
	);

	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
		status: "failed",
	});

	await expect(
		asOwner.mutation(api.transcriptSessions.completeSession, {
			sessionId,
		}),
	).rejects.toThrow(ConvexError);
});
