import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
		assistantMessageId: run.assistantMessageId,
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

const queuedMessageInput = (messageId: string, text: string) => ({
	messageId,
	partsJson: JSON.stringify([{ type: "text", text }]),
	text,
	requestBodyJson: JSON.stringify({ model: "gpt-5" }),
});

const listRunEventTypes = async ({
	asOwner,
	runId,
}: {
	asOwner: AsOwner;
	runId: Id<"assistantRuns">;
}) => {
	const events = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{
			runId,
		},
	);

	return events.map((eventRecord) => eventRecord.event.type);
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

test("removeOrphanedRun deletes runtime after its chat is gone", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-orphan-runtime", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-orphan-runtime",
		workspaceId,
	});

	await t.run(async (ctx) => {
		await ctx.db.delete(run.chatId);
	});

	const result = await t.mutation(internal.assistantRuns.removeOrphanedRun, {
		runId: run._id,
	});

	expect(result).toEqual({ deleted: true, hasMore: false });
	const rows = await t.run(async (ctx) => ({
		events: await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.take(1),
		run: await ctx.db.get(run._id),
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
	}));

	expect(rows.events).toHaveLength(0);
	expect(rows.run).toBeNull();
	expect(rows.streams).toHaveLength(0);
	expect(rows.toolCalls).toHaveLength(0);
});

test("removeOrphanedRun leaves runtime when its chat is active", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-active-runtime", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-active-runtime",
		workspaceId,
	});

	const result = await t.mutation(internal.assistantRuns.removeOrphanedRun, {
		runId: run._id,
	});

	expect(result).toEqual({ deleted: false, hasMore: false });
	expect(await t.run((ctx) => ctx.db.get(run._id))).not.toBeNull();
});

test("assistant run events record ordered stream lifecycle", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-events", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-events",
		workspaceId,
	});

	await asOwner.mutation(api.chatToolCalls.finishActiveStreamToolCall, {
		workspaceId,
		chatId: "chat-events",
		runId: run._id,
		toolCallId: "tool-call-1",
		status: "completed",
		outputJson: JSON.stringify({ result: "found" }),
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const events = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{
			runId: run._id,
		},
	);

	expect(events.map((eventRecord) => eventRecord.eventIndex)).toEqual([
		0, 1, 2, 3, 4,
	]);
	expect(events.map((eventRecord) => eventRecord.event.type)).toEqual([
		"run.started",
		"assistant.message.started",
		"tool.started",
		"tool.completed",
		"run.completed",
	]);

	const resumedEvents = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{
			runId: run._id,
			afterEventIndex: 1,
			limit: 2,
		},
	);
	expect(resumedEvents.map((eventRecord) => eventRecord.event.type)).toEqual([
		"tool.started",
		"tool.completed",
	]);
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
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toContain(
		"run.completed",
	);
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
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toContain(
		"run.failed",
	);
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
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toContain(
		"run.stopped",
	);
});

test("finishStoppedAssistantRun idempotently removes stale queued rows", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-stop-stale-queue", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-stop-stale-queue",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-stop-stale-queue",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Queued"),
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-stop-stale-queue",
		runId: run._id,
		message: queuedMessageInput("queued-2", "Claimed"),
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: run._id,
	});
	await asOwner.mutation(api.assistantRuns.finishStoppedAssistantRun, {
		runId: run._id,
	});
	await t.run(async (ctx) => {
		await ctx.db.insert("assistantQueuedMessages", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			runId: run._id,
			messageId: "stale-queued",
			partsJson: JSON.stringify([{ type: "text", text: "Stale queued" }]),
			text: "Stale queued",
			requestBodyJson: JSON.stringify({ model: "gpt-5" }),
			status: "queued",
			createdAt: 3_000,
			updatedAt: 3_000,
			claimedAt: undefined,
		});
		await ctx.db.insert("assistantQueuedMessages", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			runId: run._id,
			messageId: "stale-claimed",
			partsJson: JSON.stringify([{ type: "text", text: "Stale claimed" }]),
			text: "Stale claimed",
			requestBodyJson: JSON.stringify({ model: "gpt-5" }),
			status: "claimed",
			createdAt: 3_001,
			updatedAt: 3_001,
			claimedAt: 3_001,
		});
	});

	const stoppedRun = await asOwner.mutation(
		api.assistantRuns.finishStoppedAssistantRun,
		{ runId: run._id },
	);

	expect(stoppedRun.status).toBe("stopped");
	const leftoverRows = await t.run(async (ctx) => {
		const [queued, claimed] = await Promise.all([
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", run._id).eq("status", "queued"),
				)
				.take(10),
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", run._id).eq("status", "claimed"),
				)
				.take(10),
		]);
		return [...queued, ...claimed];
	});
	expect(leftoverRows).toHaveLength(0);
});

test("waitForUserDecision cleans stale queued rows on terminal re-entry", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal-wait-cleanup", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-terminal-wait-cleanup",
		workspaceId,
	});

	await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		errorText: "failed",
	});
	await t.run(async (ctx) => {
		await ctx.db.insert("assistantQueuedMessages", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			runId: run._id,
			messageId: "stale-terminal-queued",
			partsJson: JSON.stringify([{ type: "text", text: "Stale queued" }]),
			text: "Stale queued",
			requestBodyJson: JSON.stringify({ model: "gpt-5" }),
			status: "queued",
			createdAt: 4_000,
			updatedAt: 4_000,
			claimedAt: undefined,
		});
		await ctx.db.insert("assistantQueuedMessages", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			runId: run._id,
			messageId: "stale-terminal-claimed",
			partsJson: JSON.stringify([{ type: "text", text: "Stale claimed" }]),
			text: "Stale claimed",
			requestBodyJson: JSON.stringify({ model: "gpt-5" }),
			status: "claimed",
			createdAt: 4_001,
			updatedAt: 4_001,
			claimedAt: 4_001,
		});
	});

	const failedRun = await asOwner.mutation(
		api.assistantRuns.waitForUserDecision,
		{
			runId: run._id,
			pendingDecision: {
				type: "clarify_scope",
				question: "Clarify?",
			},
		},
	);

	expect(failedRun.status).toBe("failed");
	const leftoverRows = await t.run(async (ctx) => {
		const [queued, claimed] = await Promise.all([
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", run._id).eq("status", "queued"),
				)
				.take(10),
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", run._id).eq("status", "claimed"),
				)
				.take(10),
		]);
		return [...queued, ...claimed];
	});
	expect(leftoverRows).toHaveLength(0);
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

	const oldRunEvents = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{
			runId: oldRun._id,
		},
	);
	expect(oldRunEvents.at(-1)?.event).toEqual({
		type: "run.stopped",
		stopReason: "superseded",
	});
});

test("assistant runs reject concurrent starts instead of leaving two active runs", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-concurrent", workspaceId });
	const oldRun = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-concurrent",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantRuns.startAssistantRun, {
			workspaceId,
			chatId: "chat-concurrent",
			assistantMessageId: "chat-concurrent-assistant-2",
			model: "gpt-5",
			policy: "reject",
		}),
	).rejects.toThrow("Chat already has an active assistant run.");

	const attachableRun = await asOwner.query(api.assistantRuns.getAttachableRun, {
		workspaceId,
		chatId: "chat-concurrent",
	});
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

	expect(attachableRun?._id).toBe(oldRun._id);
	expect(rows.oldRun?.status).toBe("running");
	expect(rows.oldRun?.stopReason).toBeUndefined();
	expect(rows.oldStreams).toHaveLength(1);
	expect(rows.oldToolCalls).toHaveLength(1);
	expect(await listRunEventTypes({ asOwner, runId: oldRun._id })).not.toContain(
		"run.stopped",
	);
});

test("attachable run query fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-multiple-active", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-multiple-active",
		workspaceId,
	});

	await t.run(async (ctx) => {
		await ctx.db.insert("assistantRuns", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			assistantMessageId: "chat-multiple-active-assistant-2",
			status: "waiting_for_user",
			model: "gpt-5",
			reasoningEffort: undefined,
			phase: undefined,
			pendingDecision: {
				type: "clarify_scope",
				question: "Choose a scope.",
			},
			stopReason: undefined,
			errorText: undefined,
			startedAt: run.startedAt + 1,
			updatedAt: run.updatedAt + 1,
			finishedAt: undefined,
		});
	});

	await expect(
		asOwner.query(api.assistantRuns.getAttachableRun, {
			workspaceId,
			chatId: "chat-multiple-active",
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
	await expect(
		asOwner.query(api.assistantRuns.getActiveRunStatus, {
			workspaceId,
			chatId: "chat-multiple-active",
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
	await expect(
		asOwner.query(api.assistantRuns.listActiveChatIds, {
			workspaceId,
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
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

	const attachableRun = await asOwner.query(
		api.assistantRuns.getAttachableRun,
		{
			workspaceId,
			chatId: "chat-attach",
		},
	);
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

	const activeStatus = await asOwner.query(
		api.assistantRuns.getActiveRunStatus,
		{
			workspaceId,
			chatId: "chat-active",
		},
	);
	const activeChatIds = await asOwner.query(
		api.assistantRuns.listActiveChatIds,
		{
			workspaceId,
		},
	);

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
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toEqual([
		"run.started",
		"input.requested",
	]);

	const attachableRun = await asOwner.query(
		api.assistantRuns.getAttachableRun,
		{
			workspaceId,
			chatId: "chat-decision",
		},
	);
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

test("appended user input resumes a waiting run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-append-decision", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-append-decision",
		assistantMessageId: "chat-append-decision-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: run._id,
		pendingDecision: {
			type: "clarify_scope",
			question: "Which scope should I use?",
		},
	});

	const resumedRun = await asOwner.mutation(
		api.assistantRuns.appendUserMessageToAssistantRun,
		{
			runId: run._id,
			messageId: "msg-user-answer",
		},
	);

	expect(resumedRun.status).toBe("running");
	expect(resumedRun.pendingDecision).toBeUndefined();
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toEqual([
		"run.started",
		"input.requested",
		"user.message.appended",
	]);
});

test("stopping a waiting-for-user run clears the pending decision", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-stop-decision", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-stop-decision",
		assistantMessageId: "chat-stop-decision-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: run._id,
		pendingDecision: {
			type: "clarify_scope",
			question: "Which notes should I search?",
		},
	});

	const stoppingRun = await asOwner.mutation(
		api.assistantRuns.requestStopAssistantRun,
		{
			runId: run._id,
			stopReason: "user_requested",
		},
	);
	expect(stoppingRun.status).toBe("stopping");
	expect(stoppingRun.pendingDecision).toBeUndefined();

	const stoppedRun = await asOwner.mutation(
		api.assistantRuns.finishStoppedAssistantRun,
		{ runId: run._id },
	);
	expect(stoppedRun.status).toBe("stopped");
	expect(stoppedRun.pendingDecision).toBeUndefined();
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toEqual([
		"run.started",
		"input.requested",
		"run.stopped",
	]);
});

test("cleanupExpiredAssistantRuns fails stale running runs and deletes snapshots", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-expired", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-expired",
		workspaceId,
	});

	await t.run(async (ctx) => {
		await ctx.db.patch(run._id, {
			updatedAt: 1,
		});
		const stream = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique();

		if (!stream) {
			throw new Error("Expected active stream snapshot.");
		}

		await ctx.db.patch(stream._id, {
			updatedAt: 1,
		});
	});

	const result = await t.mutation(
		internal.assistantRuns.cleanupExpiredAssistantRuns,
		{ scheduleContinuation: false },
	);

	expect(result.expired).toBe(1);
	const rows = await t.run(async (ctx) => ({
		run: await ctx.db.get(run._id),
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
	}));
	expect(rows.run?.status).toBe("failed");
	expect(rows.run?.errorText).toBe(
		"Assistant run expired after its stream producer stopped.",
	);
	expect(rows.streams).toHaveLength(0);
	expect(rows.toolCalls).toHaveLength(0);
	expect(await listRunEventTypes({ asOwner, runId: run._id })).toContain(
		"run.failed",
	);
});

test("cleanupExpiredAssistantRuns processes stale runs in bounded batches", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const runs: Array<Id<"assistantRuns">> = [];

	for (let index = 0; index < 9; index += 1) {
		const chatId = `chat-expired-batch-${index}`;
		await createChat({ asOwner, chatId, workspaceId });
		const run = await startRunWithSnapshots({ asOwner, chatId, workspaceId });
		runs.push(run._id);
	}

	await t.run(async (ctx) => {
		for (const runId of runs) {
			await ctx.db.patch(runId, {
				updatedAt: 1,
			});
			const stream = await ctx.db
				.query("chatActiveStreams")
				.withIndex("by_runId", (q) => q.eq("runId", runId))
				.unique();

			if (!stream) {
				throw new Error("Expected active stream snapshot.");
			}

			await ctx.db.patch(stream._id, {
				updatedAt: 1,
			});
		}
	});

	const firstResult = await t.mutation(
		internal.assistantRuns.cleanupExpiredAssistantRuns,
		{ scheduleContinuation: false },
	);

	expect(firstResult.checked).toBe(8);
	expect(firstResult.expired).toBe(8);
	expect(firstResult.hasMore).toBe(true);

	const secondResult = await t.mutation(
		internal.assistantRuns.cleanupExpiredAssistantRuns,
		{ scheduleContinuation: false },
	);

	expect(secondResult.checked).toBeLessThanOrEqual(1);
	expect(secondResult.hasMore).toBe(false);
});

test("cleanupExpiredAssistantRuns keeps stale runs with fresh active stream snapshots", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-fresh-stream", workspaceId });
	const run = await startRunWithSnapshots({
		asOwner,
		chatId: "chat-fresh-stream",
		workspaceId,
	});
	const freshStreamUpdatedAt = Date.now();

	await t.run(async (ctx) => {
		await ctx.db.patch(run._id, {
			updatedAt: 1,
		});
		const stream = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique();

		if (!stream) {
			throw new Error("Expected active stream snapshot.");
		}

		await ctx.db.patch(stream._id, {
			updatedAt: freshStreamUpdatedAt,
		});
	});

	const result = await t.mutation(
		internal.assistantRuns.cleanupExpiredAssistantRuns,
		{ scheduleContinuation: false },
	);

	expect(result.refreshed).toBe(1);
	const rows = await t.run(async (ctx) => ({
		run: await ctx.db.get(run._id),
		streams: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1),
	}));
	expect(rows.run?.status).toBe("running");
	expect(rows.run?.updatedAt).toBe(freshStreamUpdatedAt);
	expect(rows.streams).toHaveLength(1);
});

test("cleanupExpiredAssistantRuns preserves waiting-for-user runs", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-waiting-expired", workspaceId });
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-waiting-expired",
		assistantMessageId: "chat-waiting-expired-assistant-1",
		model: "gpt-5",
		policy: "reject",
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: run._id,
		pendingDecision: {
			type: "clarify_scope",
			question: "Which notes should I search?",
		},
	});
	await t.run(async (ctx) => {
		await ctx.db.patch(run._id, {
			updatedAt: 1,
		});
	});

	const result = await t.mutation(
		internal.assistantRuns.cleanupExpiredAssistantRuns,
		{ scheduleContinuation: false },
	);

	expect(result.expired).toBe(0);
	const savedRun = await t.run((ctx) => ctx.db.get(run._id));
	expect(savedRun?.status).toBe("waiting_for_user");
	expect(savedRun?.pendingDecision).toEqual({
		type: "clarify_scope",
		question: "Which notes should I search?",
	});
});
