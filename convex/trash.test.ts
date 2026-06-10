import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
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

test("trash cleanup removes expired archived items without touching recent trash", async () => {
	vi.useFakeTimers();

	const t = convexTest(schema, modules);
	const cutoffTimestamp = 10_000;

	const {
		cleanupWorkspaceId,
		expiredLinkedChatId,
		expiredRecentlyUpdatedNoteId,
		expiredRecentlyUpdatedStandaloneChatId,
		expiredNoteId,
		expiredStandaloneChatId,
		otherWorkspaceExpiredNoteId,
		recentOldUpdatedNoteId,
		recentOldUpdatedStandaloneChatId,
		recentNoteId,
		recentStandaloneChatId,
	} = await t.run(async (ctx) => {
		const cleanupWorkspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Cleanup workspace",
			normalizedName: "cleanup-workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const otherWorkspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Other workspace",
			normalizedName: "other-workspace",
			role: "startup-generalist",
			createdAt: 2_000,
			updatedAt: 2_000,
		});

		const expiredNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			starredSortOrder: 0,
			title: "Expired note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: true,
			archivedAt: 5_000,
			createdAt: 1_000,
			updatedAt: 5_000,
		});
		const expiredLinkedChatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			chatId: "expired-linked-chat",
			noteId: expiredNoteId,
			starredSortOrder: 0,
			title: "Expired linked chat",
			preview: "Expired linked chat",
			isArchived: true,
			archivedAt: 5_000,
			createdAt: 1_000,
			updatedAt: 5_000,
			lastMessageAt: 5_000,
		});
		await ctx.db.insert("chatMessages", {
			chatId: expiredLinkedChatId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			messageId: "expired-linked-message",
			role: "user",
			partsJson: "[]",
			text: "Expired linked message",
			createdAt: 5_000,
		});
		await ctx.db.insert("noteRevisions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			noteId: expiredNoteId,
			authorName: "Owner",
			title: "Expired note revision",
			content: "Old body",
			searchableText: "Old body",
			createdAt: 4_000,
		});
		const expiredThreadId = await ctx.db.insert("noteCommentThreads", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			noteId: expiredNoteId,
			createdByName: "Owner",
			excerpt: "Body",
			isResolved: false,
			isRead: false,
			isMutedReplies: false,
			commentCount: 1,
			latestCommentPreview: "Expired comment",
			latestCommentIsReply: false,
			createdAt: 4_500,
			updatedAt: 4_500,
			lastCommentAt: 4_500,
		});
		await ctx.db.insert("noteComments", {
			threadId: expiredThreadId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			noteId: expiredNoteId,
			authorName: "Owner",
			body: "Expired comment",
			createdAt: 4_500,
			updatedAt: 4_500,
		});
		const expiredSessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId: expiredNoteId,
			startedAt: 5_000,
			finalTranscript: "Expired transcript",
			createdAt: 5_000,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId: expiredSessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId: expiredNoteId,
			status: "completed",
			refinementStatus: "completed",
			refinementError: undefined,
			endedAt: 5_010,
			generatedNoteAt: 5_020,
			createdAt: 5_000,
			updatedAt: 5_020,
			lastRefinedAt: 5_015,
		});
		await ctx.db.insert("transcriptUtterances", {
			sessionId: expiredSessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId: expiredNoteId,
			utteranceId: "expired-utterance",
			speaker: "Owner",
			source: "live",
			text: "Expired utterance",
			startedAt: 5_000,
			endedAt: 5_005,
			createdAt: 5_000,
			updatedAt: 5_000,
		});

		const recentNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			starredSortOrder: 0,
			title: "Recent note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: true,
			archivedAt: 15_000,
			createdAt: 1_000,
			updatedAt: 15_000,
		});
		const recentOldUpdatedNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			starredSortOrder: 0,
			title: "Recently archived old note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: true,
			archivedAt: 15_000,
			createdAt: 1_000,
			updatedAt: 5_000,
		});
		const expiredRecentlyUpdatedNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			starredSortOrder: 0,
			title: "Expired recently updated note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: true,
			archivedAt: 5_000,
			createdAt: 1_000,
			updatedAt: 15_000,
		});

		const expiredStandaloneChatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			chatId: "expired-standalone-chat",
			starredSortOrder: 0,
			title: "Expired standalone chat",
			preview: "Expired standalone chat",
			isArchived: true,
			archivedAt: 5_000,
			createdAt: 1_000,
			updatedAt: 5_000,
			lastMessageAt: 5_000,
		});
		await ctx.db.insert("chatMessages", {
			chatId: expiredStandaloneChatId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			messageId: "expired-standalone-message",
			role: "assistant",
			partsJson: "[]",
			text: "Expired standalone message",
			createdAt: 5_000,
		});

		const recentStandaloneChatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			chatId: "recent-standalone-chat",
			starredSortOrder: 0,
			title: "Recent standalone chat",
			preview: "Recent standalone chat",
			isArchived: true,
			archivedAt: 15_000,
			createdAt: 1_000,
			updatedAt: 15_000,
			lastMessageAt: 15_000,
		});
		const recentOldUpdatedStandaloneChatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			chatId: "recent-old-updated-standalone-chat",
			starredSortOrder: 0,
			title: "Recently archived old updated standalone chat",
			preview: "Recently archived old updated standalone chat",
			isArchived: true,
			archivedAt: 15_000,
			createdAt: 1_000,
			updatedAt: 5_000,
			lastMessageAt: 5_000,
		});
		const expiredRecentlyUpdatedStandaloneChatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			chatId: "expired-recently-updated-standalone-chat",
			starredSortOrder: 0,
			title: "Expired recently updated standalone chat",
			preview: "Expired recently updated standalone chat",
			isArchived: true,
			archivedAt: 5_000,
			createdAt: 1_000,
			updatedAt: 15_000,
			lastMessageAt: 15_000,
		});
		await ctx.db.insert("chatMessages", {
			chatId: recentStandaloneChatId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			messageId: "recent-standalone-message",
			role: "assistant",
			partsJson: "[]",
			text: "Recent standalone message",
			createdAt: 15_000,
		});
		const otherWorkspaceExpiredNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: otherWorkspaceId,
			starredSortOrder: 0,
			title: "Other expired note",
			content: "Body",
			searchableText: "Body",
			visibility: "private",
			isArchived: true,
			archivedAt: 5_000,
			createdAt: 2_000,
			updatedAt: 5_000,
		});

		return {
			cleanupWorkspaceId,
			expiredNoteId,
			expiredLinkedChatId,
			expiredRecentlyUpdatedNoteId,
			expiredRecentlyUpdatedStandaloneChatId,
			recentNoteId,
			recentOldUpdatedNoteId,
			expiredStandaloneChatId,
			recentStandaloneChatId,
			recentOldUpdatedStandaloneChatId,
			otherWorkspaceExpiredNoteId,
		};
	});

	const result = await t.mutation(
		internal.trash.cleanupExpiredItemsForWorkspace,
		{
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: cleanupWorkspaceId,
			cutoffTimestamp,
		},
	);

	expect(result).toEqual({
		deletedNoteCount: 2,
		scheduledChatCount: 2,
		hasMore: false,
	});

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const remaining = await t.run(async (ctx) => {
		const recentStandaloneMessages = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_createdAt", (q) =>
				q.eq("chatId", recentStandaloneChatId),
			)
			.take(10);

		return {
			expiredNote: await ctx.db.get(expiredNoteId),
			expiredRecentlyUpdatedNote: await ctx.db.get(expiredRecentlyUpdatedNoteId),
			recentNote: await ctx.db.get(recentNoteId),
			recentOldUpdatedNote: await ctx.db.get(recentOldUpdatedNoteId),
			expiredLinkedChat: await ctx.db.get(expiredLinkedChatId),
			expiredStandaloneChat: await ctx.db.get(expiredStandaloneChatId),
			expiredRecentlyUpdatedStandaloneChat: await ctx.db.get(
				expiredRecentlyUpdatedStandaloneChatId,
			),
			recentStandaloneChat: await ctx.db.get(recentStandaloneChatId),
			recentOldUpdatedStandaloneChat: await ctx.db.get(
				recentOldUpdatedStandaloneChatId,
			),
			otherWorkspaceExpiredNote: await ctx.db.get(otherWorkspaceExpiredNoteId),
			transcriptSessions: (await ctx.db.query("transcriptSessions").take(10))
				.length,
			transcriptSessionStates: (
				await ctx.db.query("transcriptSessionStates").take(10)
			).length,
			transcriptUtterances: (
				await ctx.db.query("transcriptUtterances").take(10)
			).length,
			noteRevisions: (await ctx.db.query("noteRevisions").take(10)).length,
			noteCommentThreads: (await ctx.db.query("noteCommentThreads").take(10))
				.length,
			noteComments: (await ctx.db.query("noteComments").take(10)).length,
			expiredLinkedMessages: (
				await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_createdAt", (q) =>
						q.eq("chatId", expiredLinkedChatId),
					)
					.take(10)
			).length,
			expiredStandaloneMessages: (
				await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_createdAt", (q) =>
						q.eq("chatId", expiredStandaloneChatId),
					)
					.take(10)
			).length,
			recentStandaloneMessages: recentStandaloneMessages.length,
		};
	});

	expect(remaining.expiredNote).toBeNull();
	expect(remaining.expiredRecentlyUpdatedNote).toBeNull();
	expect(remaining.recentNote).not.toBeNull();
	expect(remaining.recentOldUpdatedNote).not.toBeNull();
	expect(remaining.expiredLinkedChat).toBeNull();
	expect(remaining.expiredStandaloneChat).toBeNull();
	expect(remaining.expiredRecentlyUpdatedStandaloneChat).toBeNull();
	expect(remaining.recentStandaloneChat).not.toBeNull();
	expect(remaining.recentOldUpdatedStandaloneChat).not.toBeNull();
	expect(remaining.otherWorkspaceExpiredNote).not.toBeNull();
	expect(remaining.transcriptSessions).toBe(0);
	expect(remaining.transcriptSessionStates).toBe(0);
	expect(remaining.transcriptUtterances).toBe(0);
	expect(remaining.noteRevisions).toBe(0);
	expect(remaining.noteCommentThreads).toBe(0);
	expect(remaining.noteComments).toBe(0);
	expect(remaining.expiredLinkedMessages).toBe(0);
	expect(remaining.expiredStandaloneMessages).toBe(0);
	expect(remaining.recentStandaloneMessages).toBe(1);
});
