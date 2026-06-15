import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
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
		t,
		workspaceId,
	};
};

type WorkspaceFixture = Awaited<ReturnType<typeof createWorkspace>>;
type AsOwner = WorkspaceFixture["asOwner"];
type WorkspaceId = WorkspaceFixture["workspaceId"];

const createChat = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) => {
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId,
		preview: "Prompt",
		message: {
			id: `${chatId}-user-1`,
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
};

const startRunWithSnapshots = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) => {
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: `${chatId}-assistant-1`,
		model: "gpt-5",
		policy: "reject",
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
	});
	await asOwner.mutation(api.chats.appendActiveStreamText, {
		workspaceId,
		chatId,
		runId: run._id,
		delta: "Partial answer",
	});
	await asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
		workspaceId,
		chatId,
		runId: run._id,
		toolCallId: "tool-call-1",
		toolName: "search",
	});

	return run;
};

test("finishAssistantRun leaves no snapshots for runId", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-complete", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-complete",
		workspaceId,
	});

	const finishedRun = await asOwner.mutation(
		api.assistantRuns.finishAssistantRun,
		{ runId: run._id },
	);

	expect(finishedRun.status).toBe("completed");
	const snapshots = await t.run(async (ctx) => ({
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
	}));
	expect(snapshots.streams).toHaveLength(0);
	expect(snapshots.toolCalls).toHaveLength(0);
});

test("finishAssistantRun deletes all snapshots for runId without batch caps", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-complete-many", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-complete-many",
		assistantMessageId: "chat-complete-many-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});

	await t.run(async (ctx) => {
		for (let index = 0; index < 25; index += 1) {
			await ctx.db.insert("chatActiveStreams", {
				runId: run._id,
				chatId: run.chatId,
				assistantMessageId: run.assistantMessageId,
				text: `Partial ${index}`,
				updatedAt: 3_000 + index,
			});
		}

		for (let index = 0; index < 125; index += 1) {
			await ctx.db.insert("chatToolCalls", {
				runId: run._id,
				chatId: run.chatId,
				toolCallId: `tool-call-${index}`,
				toolName: "search",
				status: "pending",
				createdAt: 4_000 + index,
				updatedAt: 4_000 + index,
			});
		}
	});

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const snapshots = await t.run(async (ctx) => ({
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
	}));
	expect(snapshots.streams).toHaveLength(0);
	expect(snapshots.toolCalls).toHaveLength(0);
});

test("failAssistantRun leaves no snapshots for runId", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-fail", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-fail",
		workspaceId,
	});

	const failedRun = await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		errorText: "save failed",
	});

	expect(failedRun.status).toBe("failed");
	const snapshots = await t.run(async (ctx) => ({
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
	}));
	expect(snapshots.streams).toHaveLength(0);
	expect(snapshots.toolCalls).toHaveLength(0);
});

test("finishStoppedAssistantRun leaves no snapshots for runId", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-stop", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-stop",
		workspaceId,
	});

	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: run._id,
	});
	const stoppedRun = await asOwner.mutation(
		api.assistantRuns.finishStoppedAssistantRun,
		{ runId: run._id },
	);

	expect(stoppedRun.status).toBe("stopped");
	const snapshots = await t.run(async (ctx) => ({
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
	}));
	expect(snapshots.streams).toHaveLength(0);
	expect(snapshots.toolCalls).toHaveLength(0);
});

test("supersede stops old run and deletes old snapshots before creating new run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-supersede", workspaceId });
	const oldRun = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-supersede",
		workspaceId,
	});

	const newRun = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-supersede",
		assistantMessageId: "chat-supersede-assistant-2",
		model: "gpt-5",
		policy: "supersede",
	});

	expect(newRun._id).not.toBe(oldRun._id);
	const rows = await t.run(async (ctx) => ({
		oldRun: await ctx.db.get(oldRun._id),
		oldStreams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", oldRun._id))
			.take(10),
		oldToolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", oldRun._id))
			.take(10),
	}));

	expect(rows.oldRun?.status).toBe("stopped");
	expect(rows.oldRun?.stopReason).toBe("superseded");
	expect(rows.oldStreams).toHaveLength(0);
	expect(rows.oldToolCalls).toHaveLength(0);
});

test("attachable run query returns only non-terminal runs", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-attach", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-attach",
		assistantMessageId: "chat-attach-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});

	const attachableRun = await asOwner.query(api.assistantRuns.getAttachableRun, {
		workspaceId,
		chatId: "chat-attach",
	});
	expect(attachableRun?._id).toBe(run._id);

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const terminalRun = await asOwner.query(api.assistantRuns.getAttachableRun, {
		workspaceId,
		chatId: "chat-attach",
	});
	expect(terminalRun).toBeNull();
});

test("active run queries are driven by non-terminal assistant runs", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-active", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-active",
		assistantMessageId: "chat-active-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});

	const activeStatus = await asOwner.query(api.assistantRuns.getActiveRunStatus, {
		workspaceId,
		chatId: "chat-active",
	});
	const activeChatIds = await asOwner.query(api.assistantRuns.listActiveChatIds, {
		workspaceId,
	});

	expect(activeStatus).toBe("streaming");
	expect(activeChatIds).toContain("chat-active");

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const terminalStatus = await asOwner.query(
		api.assistantRuns.getActiveRunStatus,
		{
			workspaceId,
			chatId: "chat-active",
		},
	);
	const terminalChatIds = await asOwner.query(
		api.assistantRuns.listActiveChatIds,
		{
			workspaceId,
		},
	);

	expect(terminalStatus).toBeNull();
	expect(terminalChatIds).not.toContain("chat-active");
});

test("assistant runs can durably wait for and resume from user decisions", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-decision", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-decision",
		assistantMessageId: "chat-decision-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});

	const waitingRun = await asOwner.mutation(
		api.assistantRuns.waitForUserDecision,
		{
			runId: run._id,
			phase: "selecting-source",
			pendingDecision: {
				type: "authorize_source",
				source: "google_drive",
				reason: "Search Drive for the requested context.",
			},
		},
	);

	expect(waitingRun.status).toBe("waiting_for_user");
	expect(waitingRun.phase).toBe("selecting-source");
	expect(waitingRun.pendingDecision).toEqual({
		type: "authorize_source",
		source: "google_drive",
		reason: "Search Drive for the requested context.",
	});

	const attachableRun = await asOwner.query(api.assistantRuns.getAttachableRun, {
		workspaceId,
		chatId: "chat-decision",
	});
	expect(attachableRun?._id).toBe(run._id);

	await expect(
		asOwner.mutation(api.assistantRuns.finishAssistantRun, {
			runId: run._id,
		}),
	).rejects.toThrow("Assistant run cannot be completed.");

	const resumedRun = await asOwner.mutation(
		api.assistantRuns.resumeAssistantRunAfterUserDecision,
		{
			runId: run._id,
			phase: "running-tools",
		},
	);

	expect(resumedRun.status).toBe("running");
	expect(resumedRun.pendingDecision).toBeUndefined();
	expect(resumedRun.phase).toBe("running-tools");
});
