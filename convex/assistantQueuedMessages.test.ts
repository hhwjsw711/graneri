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
const MAX_INPUT_TEXT_CHARS = 1_048_576;

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

const startRun = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) =>
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: `${chatId}-assistant-1`,
		model: "gpt-5",
		policy: "reject",
	});

const insertDuplicateActiveRun = async ({
	run,
	t,
	workspaceId,
}: {
	run: Awaited<ReturnType<typeof startRun>>;
	t: Awaited<ReturnType<typeof createWorkspace>>["t"];
	workspaceId: WorkspaceId;
}) => {
	await t.run(async (ctx) => {
		await ctx.db.insert("assistantRuns", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			assistantMessageId: `${run.assistantMessageId}-duplicate`,
			status: "running",
			model: "gpt-5",
			startedAt: 3_000,
			updatedAt: 3_000,
		});
	});
};

const queuedMessageInput = (messageId: string, text: string) => ({
	messageId,
	partsJson: JSON.stringify([{ type: "text", text }]),
	text,
	requestBodyJson: JSON.stringify({
		model: "gpt-5",
		text,
	}),
});
type QueuedMessageInput = ReturnType<typeof queuedMessageInput> & {
	metadataJson?: string;
};

test("queued follow-ups attach to the active assistant run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queue", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-queue", workspaceId });

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-queue",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Follow up"),
		},
	);

	expect(queuedMessage.runId).toBe(run._id);
	expect(queuedMessage.status).toBe("queued");

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-queue",
		},
	);
	expect(queuedMessages.map((message) => message.messageId)).toEqual([
		"queued-1",
	]);
});

test("empty queued follow-ups are rejected", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-empty-queue", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-empty-queue",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-empty-queue",
			runId: run._id,
			message: queuedMessageInput("queued-empty", "   "),
		}),
	).rejects.toThrow("Queued message cannot be empty.");
});

test("oversized queued follow-ups are rejected before claim", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-large-queue", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-large-queue",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-large-queue",
			runId: run._id,
			message: queuedMessageInput(
				"queued-large",
				"x".repeat(MAX_INPUT_TEXT_CHARS + 1),
			),
		}),
	).rejects.toThrow(
		`Input exceeds the maximum length of ${MAX_INPUT_TEXT_CHARS} characters.`,
	);
});

test("queued follow-ups reject invalid durable payloads before claim", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-invalid-queue", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-invalid-queue",
		workspaceId,
	});

	const enqueue = (message: QueuedMessageInput) =>
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-invalid-queue",
			runId: run._id,
			message,
		});

	await expect(
		enqueue({
			...queuedMessageInput("queued-invalid-parts", "Valid text"),
			partsJson: JSON.stringify([{ type: "text", text: "   " }]),
		}),
	).rejects.toThrow("Queued message parts are invalid.");
	await expect(
		enqueue({
			...queuedMessageInput("queued-invalid-metadata", "Valid text"),
			metadataJson: JSON.stringify([]),
		}),
	).rejects.toThrow("Queued message metadata is invalid.");
	await expect(
		enqueue({
			...queuedMessageInput("queued-invalid-body", "Valid text"),
			requestBodyJson: JSON.stringify([]),
		}),
	).rejects.toThrow("Queued message request body is invalid.");
	await expect(
		enqueue({
			...queuedMessageInput("", "Valid text"),
		}),
	).rejects.toThrow("Queued message id cannot be empty.");
	await expect(
		enqueue({
			...queuedMessageInput("queued-text-mismatch", "Stored text"),
			partsJson: JSON.stringify([
				{ type: "text", text: "Different model text" },
			]),
		}),
	).rejects.toThrow("Queued message text must match queued message parts.");
	await expect(
		enqueue({
			...queuedMessageInput("queued-local-folders", "Valid text"),
			requestBodyJson: JSON.stringify({
				localFolders: [{ id: "folder-1", path: "/tmp" }],
				model: "gpt-5",
			}),
		}),
	).rejects.toThrow(
		"Queued messages cannot persist local folder selections.",
	);
});

test("claimNextForRun claims one pending follow-up per run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claim", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-claim", workspaceId });

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claim",
		runId: run._id,
		message: queuedMessageInput("queued-1", "First"),
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claim",
		runId: run._id,
		message: queuedMessageInput("queued-2", "Second"),
	});

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	const secondClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(firstClaim?.messageId).toBe("queued-1");
	expect(firstClaim?.status).toBe("claimed");
	expect(secondClaim).toBeNull();

	if (!firstClaim) {
		throw new Error("Expected queued message to be claimed.");
	}
	await asOwner.mutation(api.assistantQueuedMessages.discardClaimed, {
		workspaceId,
		chatId: "chat-claim",
		queuedMessageId: firstClaim._id,
	});
	const emptyClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	expect(emptyClaim?.messageId).toBe("queued-2");
	expect(emptyClaim?.status).toBe("claimed");
});

test("claimReadyForRun claims a targeted follow-up and remaining ready input", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claim-ready", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claim-ready",
		workspaceId,
	});

	const first = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-ready",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const second = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-ready",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claim-ready",
		runId: run._id,
		message: queuedMessageInput("queued-3", "Third"),
	});

	const claimedMessages = await asOwner.mutation(
		api.assistantQueuedMessages.claimReadyForRun,
		{ runId: run._id, queuedMessageId: second._id },
	);

	expect(claimedMessages.map((message) => message.messageId)).toEqual([
		"queued-2",
		"queued-1",
		"queued-3",
	]);
	expect(claimedMessages.map((message) => message.status)).toEqual([
		"claimed",
		"claimed",
		"claimed",
	]);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimReadyForRun, {
			runId: run._id,
			queuedMessageId: first._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");
});

test("queued follow-ups only attach to the current active run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-current-active-queue", workspaceId });
	const oldRun = await startRun({
		asOwner,
		chatId: "chat-current-active-queue",
		workspaceId,
	});
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-current-active-queue",
		assistantMessageId: "chat-current-active-queue-assistant-2",
		model: "gpt-5",
		policy: "supersede",
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-current-active-queue",
			runId: oldRun._id,
			message: queuedMessageInput("queued-old-run", "Old run"),
		}),
	).rejects.toThrow("Assistant run is not active.");
});

test("claimNextForRun only claims for the current active run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-current-active-claim", workspaceId });
	const oldRun = await startRun({
		asOwner,
		chatId: "chat-current-active-claim",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-current-active-claim",
			runId: oldRun._id,
			message: queuedMessageInput("queued-old-run", "Old run"),
		},
	);
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-current-active-claim",
		assistantMessageId: "chat-current-active-claim-assistant-2",
		model: "gpt-5",
		policy: "supersede",
	});

	const oldRunClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: oldRun._id },
	);
	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);

	expect(oldRunClaim).toBeNull();
	expect(persistedQueuedMessage).toBeNull();
});

test("claimNextForRun fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-active-run", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-active-run",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-duplicate-active-run",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Follow up"),
	});
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
			runId: run._id,
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");

	const queuedMessage = await t.run(async (ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", run._id).eq("status", "queued"),
			)
			.first(),
	);
	expect(queuedMessage?.messageId).toBe("queued-1");
	expect(queuedMessage?.claimedAt).toBeUndefined();
});

test("listQueuedForChat fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-list", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-list",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-duplicate-list",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Do not list"),
	});
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.query(api.assistantQueuedMessages.listQueuedForChat, {
			workspaceId,
			chatId: "chat-duplicate-list",
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("claimNextForRun rejects invalid durable payloads before claiming", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claim-invalid", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claim-invalid",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-invalid",
			runId: run._id,
			message: queuedMessageInput("queued-invalid-claim", "Original"),
		},
	);
	await t.run(async (ctx) => {
		await ctx.db.patch(queuedMessage._id, {
			partsJson: JSON.stringify([{ type: "text", text: "Tampered" }]),
		});
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
			runId: run._id,
		}),
	).rejects.toThrow("Queued message text must match queued message parts.");
	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));

	expect(persistedMessage?.status).toBe("queued");
	expect(persistedMessage?.claimedAt).toBeUndefined();
});

test("claimNextForRun claims waiting user-decision follow-ups but not stopping runs", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-non-running-claim", workspaceId });
	const waitingRun = await startRun({
		asOwner,
		chatId: "chat-non-running-claim",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-non-running-claim",
		runId: waitingRun._id,
		message: queuedMessageInput("queued-waiting", "Wait"),
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: waitingRun._id,
		pendingDecision: {
			type: "clarify_scope",
			question: "Clarify scope",
		},
	});

	const waitingClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: waitingRun._id },
	);
	const waitingQueuedMessage = await t.run(async (ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", waitingRun._id).eq("status", "claimed"),
			)
			.first(),
	);

	expect(waitingClaim?.messageId).toBe("queued-waiting");
	expect(waitingQueuedMessage?.messageId).toBe("queued-waiting");
	expect(waitingQueuedMessage?.claimedAt).toEqual(expect.any(Number));

	await createChat({
		asOwner,
		chatId: "chat-stopping-non-running-claim",
		workspaceId,
	});
	const stoppingRun = await startRun({
		asOwner,
		chatId: "chat-stopping-non-running-claim",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-stopping-non-running-claim",
		runId: stoppingRun._id,
		message: queuedMessageInput("queued-stopping", "Stop"),
	});
	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: stoppingRun._id,
	});

	const stoppingClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: stoppingRun._id },
	);
	const stoppingQueuedMessage = await t.run(async (ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", stoppingRun._id).eq("status", "queued"),
			)
			.first(),
	);

	expect(stoppingClaim).toBeNull();
	expect(stoppingQueuedMessage?.messageId).toBe("queued-stopping");
	expect(stoppingQueuedMessage?.claimedAt).toBeUndefined();
});

test("claimNextForRun reclaims stale claimed follow-ups for the active run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reclaim-run", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-reclaim-run", workspaceId });

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-reclaim-run",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Retry me"),
	});

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!firstClaim) {
		throw new Error("Expected queued message to be claimed.");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(firstClaim._id, {
			claimedAt: 1_000,
			updatedAt: 1_000,
		});
	});

	const reclaimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(reclaimedMessage?._id).toBe(firstClaim._id);
	expect(reclaimedMessage?.messageId).toBe("queued-1");
	expect(reclaimedMessage?.status).toBe("claimed");
	expect(reclaimedMessage?.claimedAt).toBeGreaterThan(1_000);
});

test("queued follow-ups can be reordered before they drain", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reorder", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-reorder", workspaceId });

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reorder",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reorder",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	await asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
		workspaceId,
		chatId: "chat-reorder",
		queuedMessageIds: [secondMessage._id, firstMessage._id],
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-reorder",
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(queuedMessages.map((message) => message.messageId)).toEqual([
		"queued-2",
		"queued-1",
	]);
	expect(claimedMessage?.messageId).toBe("queued-2");
});

test("reorderQueuedForChat fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-reorder", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-reorder",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-reorder",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Do not reorder"),
		},
	);
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
			workspaceId,
			chatId: "chat-duplicate-reorder",
			queuedMessageIds: [queuedMessage._id],
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("reorderQueuedForChat rejects missing chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reorder-owner", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-reorder-owner",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reorder-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep order"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
			workspaceId,
			chatId: "chat-reorder-missing",
			queuedMessageIds: [queuedMessage._id],
		}),
	).rejects.toThrow("Chat not found.");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.createdAt).toBe(queuedMessage.createdAt);
	expect(persistedMessage?.status).toBe("queued");
});

test("queued follow-ups can be edited without changing queue position", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-queued", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-queued",
		workspaceId,
	});

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	const updatedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.updateQueued,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			queuedMessageId: firstMessage._id,
			message: queuedMessageInput("queued-1", "Edited first"),
		},
	);
	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-edit-queued",
		},
	);

	expect(updatedMessage._id).toBe(firstMessage._id);
	expect(updatedMessage.createdAt).toBe(firstMessage.createdAt);
	expect(updatedMessage.text).toBe("Edited first");
	expect(queuedMessages.map((message) => message._id)).toEqual([
		firstMessage._id,
		secondMessage._id,
	]);
	expect(queuedMessages.map((message) => message.text)).toEqual([
		"Edited first",
		"Second",
	]);
});

test("queued follow-ups cannot be edited to empty text", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-empty-queued", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-empty-queued",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-empty-queued",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			workspaceId,
			chatId: "chat-edit-empty-queued",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "   "),
		}),
	).rejects.toThrow("Queued message cannot be empty.");
});

test("queued follow-ups cannot be edited from another chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-edit-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-owner",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Original"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			workspaceId,
			chatId: "chat-edit-other",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "Cross-chat edit"),
		}),
	).rejects.toThrow("Queued message cannot be edited.");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.text).toBe("Original");
});

test("updateQueued fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-edit", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-edit",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-edit",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Original"),
		},
	);
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			workspaceId,
			chatId: "chat-duplicate-edit",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "Blocked edit"),
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.text).toBe("Original");
});

test("claimNextForRun can steer a specific queued follow-up", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-steer-specific", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-steer-specific",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-steer-specific",
		runId: run._id,
		message: queuedMessageInput("queued-1", "First"),
	});
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-steer-specific",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	const steeredMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id, queuedMessageId: secondMessage._id },
	);
	const blockedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(steeredMessage?.messageId).toBe("queued-2");
	expect(steeredMessage?.status).toBe("claimed");
	expect(blockedMessage).toBeNull();

	if (!steeredMessage) {
		throw new Error("Expected queued message to be claimed.");
	}
	await asOwner.mutation(api.assistantQueuedMessages.discardClaimed, {
		workspaceId,
		chatId: "chat-steer-specific",
		queuedMessageId: steeredMessage._id,
	});
	const nextMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	expect(nextMessage?.messageId).toBe("queued-1");
});

test("claimNextForRun rejects targeted queued follow-ups from another run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-target-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-owner",
		workspaceId,
	});
	const otherRun = await startRun({
		asOwner,
		chatId: "chat-target-other",
		workspaceId,
	});
	const otherQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-other",
			runId: otherRun._id,
			message: queuedMessageInput("queued-other", "Other run"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
			runId: run._id,
			queuedMessageId: otherQueuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedOtherMessage = await t.run((ctx) =>
		ctx.db.get(otherQueuedMessage._id),
	);
	expect(persistedOtherMessage?.status).toBe("queued");
});

test("claimNextForRun rejects missing targeted queued follow-ups", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-missing", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-missing",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-missing",
			runId: run._id,
			message: queuedMessageInput("queued-delete", "Delete first"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
		workspaceId,
		chatId: "chat-target-missing",
		queuedMessageId: queuedMessage._id,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");
});

test("claimNextForRun rejects targeted queued follow-ups for inactive runs", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-inactive", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-inactive",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-inactive",
			runId: run._id,
			message: queuedMessageInput("queued-inactive", "Run already finished"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Assistant run is not active.");

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("claimNextForRun rejects targeted queued follow-ups while another claim is in flight", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-claimed", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-claimed",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-target-claimed",
		runId: run._id,
		message: queuedMessageInput("queued-claimed-1", "First"),
	});
	const secondQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-claimed",
			runId: run._id,
			message: queuedMessageInput("queued-claimed-2", "Second"),
		},
	);
	const existingClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!existingClaim) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
			runId: run._id,
			queuedMessageId: secondQueuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const [persistedClaim, persistedSecondMessage] = await t.run((ctx) =>
		Promise.all([
			ctx.db.get(existingClaim._id),
			ctx.db.get(secondQueuedMessage._id),
		]),
	);
	expect(persistedClaim?.status).toBe("claimed");
	expect(persistedSecondMessage?.status).toBe("queued");
});

test("discardClaimed removes consumed queued follow-ups from future drain attempts", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-consumed", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-consumed", workspaceId });

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-consumed",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Do not repeat"),
	});

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.assistantQueuedMessages.discardClaimed, {
		workspaceId,
		chatId: "chat-consumed",
		queuedMessageId: claimedMessage._id,
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-consumed",
		},
	);
	const nextClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{
			workspaceId,
			chatId: "chat-consumed",
		},
	);

	expect(queuedMessages).toHaveLength(0);
	expect(nextClaim).toBeNull();
	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(claimedMessage._id),
	);
	expect(persistedQueuedMessage).toBeNull();
});

test("discardClaimed rejects claimed rows from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-claimed-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-owner",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claimed-owner",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Keep claimed"),
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardClaimed, {
			workspaceId,
			chatId: "chat-claimed-other",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("claimed");
});

test("discardClaimed rejects queued rows", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-status", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-status",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claimed-status",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Still queued"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardClaimed, {
			workspaceId,
			chatId: "chat-claimed-status",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message is not claimed.");

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("stopping a run deletes claimed steered follow-ups", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-steer-stop", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-steer-stop",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-steer-stop",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Steer now"),
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

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-steer-stop",
		},
	);
	expect(queuedMessages).toHaveLength(0);
	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim).toBeNull();
});

test("terminal assistant runs cannot accept queued follow-ups", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-terminal", workspaceId });

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-terminal",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Too late"),
		}),
	).rejects.toThrow("Assistant run is not active.");
});

test("discardQueuedForRun removes queued follow-ups from chat listings", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-discard", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-discard", workspaceId });

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-discard",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Discard me"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.discardQueuedForRun, {
		runId: run._id,
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-discard",
		},
	);

	expect(queuedMessages).toHaveLength(0);
	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage).toBeNull();
});

test("discardQueued rejects queued rows from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queued-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-queued-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-queued-owner",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-queued-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep queued"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
			workspaceId,
			chatId: "chat-queued-other",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("discardQueued rejects claimed rows", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queued-status", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-queued-status",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-queued-status",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Claimed now"),
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
			workspaceId,
			chatId: "chat-queued-status",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("Queued message cannot be edited.");

	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("claimed");
});

test("completed assistant runs leave queued follow-ups claimable by chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal-claim", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-terminal-claim",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-terminal-claim",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Claim after complete"),
	});

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{
			workspaceId,
			chatId: "chat-terminal-claim",
		},
	);

	expect(claimedMessage?.messageId).toBe("queued-1");
	expect(claimedMessage?.status).toBe("claimed");
});

test("claimNextForChat fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-active-chat", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-active-chat",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-duplicate-active-chat",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Wait for invariant"),
	});
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForChat, {
			workspaceId,
			chatId: "chat-duplicate-active-chat",
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("getClaimedForChat fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-claimed", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-claimed",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-duplicate-claimed",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Claimed"),
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.query(api.assistantQueuedMessages.getClaimedForChat, {
			workspaceId,
			chatId: "chat-duplicate-claimed",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("getClaimedForChat rejects claimed rows from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-replay-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-claimed-replay-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-replay-owner",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claimed-replay-owner",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Keep claimed"),
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.query(api.assistantQueuedMessages.getClaimedForChat, {
			workspaceId,
			chatId: "chat-claimed-replay-other",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("claimed");
});

test("getClaimedForChat rejects missing chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-replay-missing", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-replay-missing",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claimed-replay-missing",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Keep claimed"),
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.query(api.assistantQueuedMessages.getClaimedForChat, {
			workspaceId,
			chatId: "chat-claimed-replay-missing-other",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("Chat not found.");

	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("claimed");
});

test("getClaimedForChat rejects queued rows", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-replay-status", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-replay-status",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claimed-replay-status",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Still queued"),
		},
	);

	await expect(
		asOwner.query(api.assistantQueuedMessages.getClaimedForChat, {
			workspaceId,
			chatId: "chat-claimed-replay-status",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message is not claimed.");

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("claimNextForChat rejects invalid durable payloads before claiming", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal-invalid", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-terminal-invalid",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-terminal-invalid",
			runId: run._id,
			message: queuedMessageInput("queued-invalid-replay", "Original"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});
	await t.run(async (ctx) => {
		await ctx.db.patch(queuedMessage._id, {
			text: "Tampered",
		});
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimNextForChat, {
			workspaceId,
			chatId: "chat-terminal-invalid",
		}),
	).rejects.toThrow("Queued message text must match queued message parts.");
	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));

	expect(persistedMessage?.status).toBe("queued");
	expect(persistedMessage?.claimedAt).toBeUndefined();
});

test("claimNextForChat reclaims stale claimed follow-ups after the run completes", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reclaim-chat", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-reclaim-chat",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-reclaim-chat",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Replay me"),
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{
			workspaceId,
			chatId: "chat-reclaim-chat",
		},
	);
	if (!firstClaim) {
		throw new Error("Expected queued message to be claimed.");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(firstClaim._id, {
			claimedAt: 1_000,
			updatedAt: 1_000,
		});
	});

	const reclaimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{
			workspaceId,
			chatId: "chat-reclaim-chat",
		},
	);

	expect(reclaimedMessage?._id).toBe(firstClaim._id);
	expect(reclaimedMessage?.messageId).toBe("queued-1");
	expect(reclaimedMessage?.status).toBe("claimed");
	expect(reclaimedMessage?.claimedAt).toBeGreaterThan(1_000);
});

test("getClaimedForChat rejects invalid claimed durable payloads", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-invalid", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-invalid",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-claimed-invalid",
		runId: run._id,
		message: queuedMessageInput("queued-invalid-claimed", "Original"),
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{
			workspaceId,
			chatId: "chat-claimed-invalid",
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(claimedMessage._id, {
			partsJson: JSON.stringify([{ type: "text", text: "Tampered" }]),
		});
	});

	await expect(
		asOwner.query(api.assistantQueuedMessages.getClaimedForChat, {
			workspaceId,
			chatId: "chat-claimed-invalid",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("Queued message text must match queued message parts.");
});

test("completed assistant runs delete claimed follow-ups instead of recovering them", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-stale-claim", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-stale-claim",
		workspaceId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-stale-claim",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Delete me"),
	});

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);
	if (!firstClaim) {
		throw new Error("Expected queued message to be claimed.");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(firstClaim._id, {
			claimedAt: 1_000,
			updatedAt: 1_000,
		});
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const listedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-stale-claim",
		},
	);
	const secondClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{
			workspaceId,
			chatId: "chat-stale-claim",
		},
	);

	expect(listedMessages).toHaveLength(0);
	expect(secondClaim).toBeNull();
	const persistedClaim = await t.run((ctx) => ctx.db.get(firstClaim._id));
	expect(persistedClaim).toBeNull();
});
