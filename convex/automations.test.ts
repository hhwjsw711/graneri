import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://opengran.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

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
		workspaceId,
	};
};

test("creating an automation stores a chat confirmation message", async () => {
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

	expect(messages).toHaveLength(3);
	expect(messages[1]).toMatchObject({
		role: "user",
		text: "Check Gmail for high-value items.",
	});
	expect(messages[2]).toMatchObject({
		role: "assistant",
		text: expect.stringContaining(
			"Created the automation: `Gmail high-value triage`.",
		),
	});
	expect(messages[2].text).toContain(
		"It will run hourly and report back in this chat.",
	);
	expect(messages[2].text).not.toContain("for Workspace");
	expect(messages[2].metadataJson).toBeDefined();
	expect(JSON.parse(messages[2].metadataJson ?? "{}")).toMatchObject({
		source: "automation",
		event: "created",
		automationId: automation.id,
	});
});

test("creating a tool-only automation can target the workspace", async () => {
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

	expect(messages).toHaveLength(2);
	expect(messages[0]).toMatchObject({
		role: "user",
		text: prompt,
	});
	expect(JSON.parse(messages[0].metadataJson ?? "{}")).toMatchObject({
		mentionPositions: [
			{
				id: "app:posthog",
				label: "PostHog",
				from: prompt.indexOf("@PostHog"),
				to: prompt.indexOf("@PostHog") + "@PostHog".length,
				type: "tool",
				provider: "posthog",
			},
		],
	});
	expect(messages[1].text).toContain(
		"It will run daily at 12:00 AM and report back in this chat.",
	);
	expect(messages[1].text).not.toContain("for Workspace");
});

test("creating a note automation stores note mention metadata", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
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

	expect(messages).toHaveLength(2);
	expect(messages[0]).toMatchObject({
		role: "user",
		text: prompt,
	});
	expect(JSON.parse(messages[0].metadataJson ?? "{}")).toMatchObject({
		mentionPositions: [
			{
				id: noteId,
				label: "DAU Notes",
				from: prompt.indexOf("@DAU Notes"),
				to: prompt.indexOf("@DAU Notes") + "@DAU Notes".length,
				type: "note",
			},
		],
	});
});
