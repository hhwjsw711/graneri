import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

afterEach(() => {
	vi.useRealTimers();
});

test("workspace removal clears scheduled Convex cleanup across notes, chats, transcripts, and app activity", async () => {
	vi.useFakeTimers();

	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { workspaceId } = await t.run(async (ctx) => {
		const now = 1_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: now,
			updatedAt: now,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: false,
			createdAt: now,
			updatedAt: now,
		});
		const chatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "chat-1",
			noteId,
			starredSortOrder: 0,
			title: "Chat",
			preview: "Preview",
			isArchived: false,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: now,
		});
		await ctx.db.insert("chatMessages", {
			chatId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			messageId: "message-1",
			role: "user",
			partsJson: "[]",
			text: "Hello",
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			startedAt: now,
			finalTranscript: "Transcript",
			createdAt: now,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			status: "completed",
			refinementStatus: "completed",
			refinementError: undefined,
			endedAt: now + 10,
			generatedNoteAt: now + 20,
			createdAt: now,
			updatedAt: now + 20,
			lastRefinedAt: now + 15,
		});
		await ctx.db.insert("transcriptUtterances", {
			sessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			utteranceId: "utterance-1",
			speaker: "Owner",
			source: "live",
			text: "Hello",
			startedAt: now,
			endedAt: now + 5,
			createdAt: now,
			updatedAt: now,
		});
		const connectionId = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			provider: "jira",
			status: "connected",
			displayName: "Jira",
			baseUrl: "https://jira.example.com",
			email: "jira@example.com",
			token: "secret",
			webhookSecret: "webhook-secret",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("appConnectionActivities", {
			connectionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			lastWebhookReceivedAt: now + 30,
			lastMentionSyncAt: now + 40,
			createdAt: now,
			updatedAt: now + 40,
		});
		await ctx.db.insert("calendarPreferences", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			showGoogleCalendar: true,
			showGoogleDrive: false,
			showYandexCalendar: false,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("notificationPreferences", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			notifyForScheduledMeetings: true,
			notifyForAutoDetectedMeetings: false,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("templates", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			slug: "template",
			name: "Template",
			meetingContext: "Context",
			sections: [
				{
					id: "section-1",
					title: "Section",
					prompt: "Prompt",
				},
			],
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("recipes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			slug: "write-prd",
			name: "Write PRD",
			prompt: "Write a PRD draft.",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("inboxItems", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			provider: "jira",
			kind: "jira-mention",
			externalId: "jira-comment:1",
			issueKey: "OG-1",
			title: "Mention",
			preview: "Preview",
			url: "https://jira.example.com/browse/OG-1",
			occurredAt: now,
			isRead: false,
			isArchived: false,
			createdAt: now,
			updatedAt: now,
		});

		return { workspaceId };
	});

	await asOwner.mutation(api.workspaces.remove, { workspaceId });
	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const remainingCounts = await t.run(async (ctx) => ({
		workspaces: (await ctx.db.query("workspaces").take(10)).length,
		notes: (await ctx.db.query("notes").take(10)).length,
		chats: (await ctx.db.query("chats").take(10)).length,
		chatMessages: (await ctx.db.query("chatMessages").take(10)).length,
		transcriptSessions: (await ctx.db.query("transcriptSessions").take(10))
			.length,
		transcriptSessionStates: (
			await ctx.db.query("transcriptSessionStates").take(10)
		).length,
		transcriptUtterances: (await ctx.db.query("transcriptUtterances").take(10))
			.length,
		appConnections: (await ctx.db.query("appConnections").take(10)).length,
		appConnectionActivities: (
			await ctx.db.query("appConnectionActivities").take(10)
		).length,
		calendarPreferences: (await ctx.db.query("calendarPreferences").take(10))
			.length,
		notificationPreferences: (
			await ctx.db.query("notificationPreferences").take(10)
		).length,
		templates: (await ctx.db.query("templates").take(10)).length,
		recipes: (await ctx.db.query("recipes").take(10)).length,
		inboxItems: (await ctx.db.query("inboxItems").take(10)).length,
	}));

	expect(remainingCounts).toEqual({
		workspaces: 0,
		notes: 0,
		chats: 0,
		chatMessages: 0,
		transcriptSessions: 0,
		transcriptSessionStates: 0,
		transcriptUtterances: 0,
		appConnections: 0,
		appConnectionActivities: 0,
		calendarPreferences: 0,
		notificationPreferences: 0,
		templates: 0,
		recipes: 0,
		inboxItems: 0,
	});
});

test("transcript sessions read hot state only from transcriptSessionStates", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { noteId, sessionId } = await t.run(async (ctx) => {
		const now = 2_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: now,
			updatedAt: now,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Transcript note",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: now,
			updatedAt: now,
		});
		const sessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			startedAt: now,
			finalTranscript: undefined,
			createdAt: now,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			status: "capturing",
			refinementStatus: "idle",
			refinementError: undefined,
			endedAt: undefined,
			generatedNoteAt: undefined,
			createdAt: now,
			updatedAt: now,
			lastRefinedAt: undefined,
		});

		return { noteId, sessionId };
	});

	await asOwner.mutation(api.transcriptSessions.setRefinementStatus, {
		sessionId,
		status: "running",
	});

	const latestSession = await asOwner.query(
		api.transcriptSessions.getStoredTranscriptForNote,
		{
			noteId,
		},
	);
	const storedState = await t.run(async (ctx) => {
		const session = await ctx.db.get(sessionId);
		const state = await ctx.db
			.query("transcriptSessionStates")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
			.unique();

		return {
			session,
			state,
		};
	});

	expect(latestSession?.session.refinementStatus).toBe("running");
	expect(storedState.session).not.toHaveProperty("refinementStatus");
	expect(storedState.state).toMatchObject({
		sessionId,
		refinementStatus: "running",
	});
});

test("transcript session summaries only reflect the latest session for a note", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { latestSessionId, noteId } = await t.run(async (ctx) => {
		const now = 2_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: now,
			updatedAt: now,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Transcript note",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: now,
			updatedAt: now,
		});
		const firstSessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			startedAt: now,
			finalTranscript: "Older transcript",
			createdAt: now,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId: firstSessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			status: "completed",
			refinementStatus: "completed",
			refinementError: undefined,
			endedAt: now + 10,
			generatedNoteAt: now + 20,
			createdAt: now,
			updatedAt: now + 20,
			lastRefinedAt: now + 15,
		});
		const latestSessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			startedAt: now + 100,
			finalTranscript: "Latest transcript",
			createdAt: now + 100,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId: latestSessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			status: "capturing",
			refinementStatus: "idle",
			refinementError: undefined,
			endedAt: undefined,
			generatedNoteAt: undefined,
			createdAt: now + 100,
			updatedAt: now + 110,
			lastRefinedAt: undefined,
		});

		return { latestSessionId, noteId };
	});

	const latestSummary = await asOwner.query(
		api.transcriptSessions.getLatestSummaryForNote,
		{
			noteId,
		},
	);

	expect(latestSummary?._id).toBe(latestSessionId);
	expect(latestSummary?.finalTranscript).toBe("Latest transcript");
	expect(latestSummary?.generatedNoteAt).toBeUndefined();
	expect(latestSummary?.startedAt).toBe(2_100);
});

test("jira webhook activity is stored off the credential-bearing connection row", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { connectionId, workspaceId } = await t.run(async (ctx) => {
		const now = 3_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: now,
			updatedAt: now,
		});
		const connectionId = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			provider: "jira",
			status: "connected",
			displayName: "Jira",
			baseUrl: "https://jira.example.com",
			email: "jira@example.com",
			token: "secret",
			webhookSecret: "webhook-secret",
			createdAt: now,
			updatedAt: now,
		});

		return { connectionId, workspaceId };
	});

	await t.mutation(internal.appConnections.recordJiraWebhookActivity, {
		connectionId,
		lastWebhookReceivedAt: 9_999,
		lastMentionSyncAt: 10_000,
	});

	const jiraConnection = await asOwner.query(api.appConnections.getJira, {
		workspaceId,
	});
	const storedRecords = await t.run(async (ctx) => {
		const connection = await ctx.db.get(connectionId);
		const activity = await ctx.db
			.query("appConnectionActivities")
			.withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
			.unique();

		return { connection, activity };
	});

	expect(jiraConnection).toMatchObject({
		sourceId: expect.any(String),
		lastWebhookReceivedAt: 9_999,
		lastMentionSyncAt: 10_000,
	});
	expect(storedRecords.connection).not.toHaveProperty("lastWebhookReceivedAt");
	expect(storedRecords.connection).not.toHaveProperty("lastMentionSyncAt");
	expect(storedRecords.activity).toMatchObject({
		connectionId,
		lastWebhookReceivedAt: 9_999,
		lastMentionSyncAt: 10_000,
	});
});
