import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return {
		asOwner,
		t,
		workspaceId,
	};
};

test("creating an automation leaves existing chat messages unchanged", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-existing",
		title: "Create automation",
		preview: "Create an automation",
		message: {
			id: "msg-user",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Create an automation" },
			]),
			text: "Create an automation",
			createdAt: 1_500,
		},
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Gmail high-value triage",
		prompt: "Check Gmail for high-value items.",
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "hourly",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
		},
		chatId: "chat-existing",
	});

	const messages = await asOwner.query(api.chats.getMessages, {
		workspaceId,
		chatId: automation.chatId,
	});

	expect(messages).toHaveLength(1);
	expect(messages[0]).toMatchObject({
		role: "user",
		text: "Create an automation",
	});
});

test("creating a workspace automation does not seed a chat transcript", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const prompt = "Check my DAUs @PostHog on a schedule.";

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "DAUs review",
		prompt,
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [
			{
				id: "app:posthog",
				label: "PostHog",
				provider: "posthog",
			},
		],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
		},
	});

	expect(automation.target).toMatchObject({
		kind: "workspace",
		label: "Workspace",
	});

	const messages = await asOwner.query(api.chats.getMessages, {
		workspaceId,
		chatId: automation.chatId,
	});

	expect(messages).toHaveLength(0);
});

test("creating a chat automation keeps the existing chat transcript unchanged", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-ai-created",
		title: "Create automation",
		preview: "everyday at 9am greet me",
		message: {
			id: "msg-user",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "everyday at 9am greet me" },
			]),
			text: "everyday at 9am greet me",
			createdAt: 1_500,
		},
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily greeting",
		prompt: "Greet me.",
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
		},
		chatId: "chat-ai-created",
	});

	const messages = await asOwner.query(api.chats.getMessages, {
		workspaceId,
		chatId: automation.chatId,
	});

	expect(messages).toHaveLength(1);
	expect(messages[0]).toMatchObject({
		role: "user",
		text: "everyday at 9am greet me",
	});
});

test("creating a note automation does not seed a chat transcript", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: null,
	});
	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "DAU Notes",
		content: JSON.stringify({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "DAUs" }] },
			],
		}),
		searchableText: "DAUs",
	});

	const prompt = "Review @DAU Notes every morning.";
	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "DAU notes review",
		prompt,
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "notes",
			noteIds: [noteId],
		},
	});

	const messages = await asOwner.query(api.chats.getMessages, {
		workspaceId,
		chatId: automation.chatId,
	});

	expect(messages).toHaveLength(0);
});

test("moving a chat to trash pauses its automation and restoring resumes it", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-with-automation",
		title: "Automation chat",
		preview: "Create an automation",
		message: {
			id: "msg-user",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Create an automation" },
			]),
			text: "Create an automation",
			createdAt: 1_500,
		},
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
		},
		chatId: "chat-with-automation",
	});

	expect(automation.isPaused).toBe(false);
	expect(automation.nextRunAt).not.toBeNull();

	await asOwner.mutation(api.chats.moveToTrash, {
		workspaceId,
		chatId: automation.chatId,
	});

	const automations = await asOwner.query(api.automations.list, {
		workspaceId,
	});
	const trashedChatAutomation = automations.find(
		(item) => item.id === automation.id,
	);

	expect(trashedChatAutomation).toMatchObject({
		id: automation.id,
		isPaused: true,
		nextRunAt: null,
	});

	await asOwner.mutation(api.chats.restore, {
		workspaceId,
		chatId: automation.chatId,
	});

	const restoredAutomations = await asOwner.query(api.automations.list, {
		workspaceId,
	});
	const restoredChatAutomation = restoredAutomations.find(
		(item) => item.id === automation.id,
	);

	expect(restoredChatAutomation?.isPaused).toBe(false);
	expect(restoredChatAutomation?.nextRunAt).not.toBeNull();
});

test("deleting a chat moves its automation to a fresh chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-to-delete",
		title: "Automation chat",
		preview: "Create an automation",
		message: {
			id: "msg-user",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Create an automation" },
			]),
			text: "Create an automation",
			createdAt: 1_500,
		},
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
		},
		chatId: "chat-to-delete",
	});

	await asOwner.mutation(api.chats.moveToTrash, {
		workspaceId,
		chatId: automation.chatId,
	});
	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: automation.chatId,
	});

	const deletedChat = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: automation.chatId,
	});
	const automations = await asOwner.query(api.automations.list, {
		workspaceId,
	});
	const movedAutomation = automations.find((item) => item.id === automation.id);

	expect(deletedChat).toBeNull();
	expect(movedAutomation?.chatId).not.toBe(automation.chatId);
	expect(movedAutomation?.chatId).toMatch(/^automation-/);
	expect(movedAutomation?.isPaused).toBe(false);
	expect(movedAutomation?.nextRunAt).not.toBeNull();
});

test("deleting an automation leaves its chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-kept-after-automation-delete",
		title: "Automation chat",
		preview: "Create an automation",
		message: {
			id: "msg-user",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Create an automation" },
			]),
			text: "Create an automation",
			createdAt: 1_500,
		},
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: "gpt-5.4",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
		},
		chatId: "chat-kept-after-automation-delete",
	});

	await asOwner.mutation(api.automations.remove, {
		automationId: automation.id,
	});

	const chat = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: automation.chatId,
	});
	const automations = await asOwner.query(api.automations.list, {
		workspaceId,
	});

	expect(chat).not.toBeNull();
	expect(automations.some((item) => item.id === automation.id)).toBe(false);
});

test("owner cleanup removes automations and automation runs", async () => {
	const { t, workspaceId } = await createWorkspace();

	await t.run(async (ctx) => {
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			title: "Daily review",
			prompt: "Review the workspace.",
			model: "gpt-5.4",
			reasoningEffort: "medium",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			schedulePeriod: "daily",
			scheduledAt: 2_000,
			timezone: "UTC",
			targetKind: "workspace",
			targetLabel: "Workspace",
			chatId: "automation-cleanup-chat",
			isPaused: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("automationRuns", {
			automationId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "automation-cleanup-chat",
			scheduledFor: 2_000,
			reason: "manual",
			status: "completed",
			startedAt: 2_000,
			completedAt: 3_000,
			createdAt: 2_000,
			updatedAt: 3_000,
		});
	});

	await t.mutation(internal.automations.removeAllForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
	});

	const rows = await t.run(async (ctx) => ({
		automations: await ctx.db.query("automations").take(1),
		runs: await ctx.db.query("automationRuns").take(1),
	}));

	expect(rows.automations).toHaveLength(0);
	expect(rows.runs).toHaveLength(0);
});

test("removeOrphanedRuns deletes automation runs after automation is gone", async () => {
	const { t, workspaceId } = await createWorkspace();
	const automationId = await t.run(async (ctx) => {
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			title: "Daily review",
			prompt: "Review the workspace.",
			model: "gpt-5.4",
			reasoningEffort: "medium",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			schedulePeriod: "daily",
			scheduledAt: 2_000,
			timezone: "UTC",
			targetKind: "workspace",
			targetLabel: "Workspace",
			chatId: "automation-orphan-run-chat",
			isPaused: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("automationRuns", {
			automationId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "automation-orphan-run-chat",
			scheduledFor: 2_000,
			reason: "manual",
			status: "completed",
			startedAt: 2_000,
			completedAt: 3_000,
			createdAt: 2_000,
			updatedAt: 3_000,
		});
		await ctx.db.delete(automationId);

		return automationId;
	});

	const result = await t.mutation(internal.automations.removeOrphanedRuns, {
		automationId,
	});
	const runs = await t.run(async (ctx) =>
		ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", automationId),
			)
			.take(1),
	);

	expect(result).toEqual({ deletedCount: 1, hasMore: false });
	expect(runs).toHaveLength(0);
});

test("removeOrphanedRuns leaves automation runs while automation exists", async () => {
	const { t, workspaceId } = await createWorkspace();
	const automationId = await t.run(async (ctx) => {
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			title: "Daily review",
			prompt: "Review the workspace.",
			model: "gpt-5.4",
			reasoningEffort: "medium",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			schedulePeriod: "daily",
			scheduledAt: 2_000,
			timezone: "UTC",
			targetKind: "workspace",
			targetLabel: "Workspace",
			chatId: "automation-active-run-chat",
			isPaused: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("automationRuns", {
			automationId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "automation-active-run-chat",
			scheduledFor: 2_000,
			reason: "manual",
			status: "completed",
			startedAt: 2_000,
			completedAt: 3_000,
			createdAt: 2_000,
			updatedAt: 3_000,
		});

		return automationId;
	});

	const result = await t.mutation(internal.automations.removeOrphanedRuns, {
		automationId,
	});
	const runs = await t.run(async (ctx) =>
		ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", automationId),
			)
			.take(1),
	);

	expect(result).toEqual({ deletedCount: 0, hasMore: false });
	expect(runs).toHaveLength(1);
});
