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

const queuedMessageInput = (messageId: string, text: string) => ({
	messageId,
	partsJson: JSON.stringify([{ type: "text", text }]),
	text,
	requestBodyJson: JSON.stringify({
		model: "gpt-5",
		text,
	}),
});

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

test("claimNextForRun claims the oldest queued follow-up once", async () => {
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
	const emptyClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(firstClaim?.messageId).toBe("queued-1");
	expect(firstClaim?.status).toBe("claimed");
	expect(secondClaim?.messageId).toBe("queued-2");
	expect(secondClaim?.status).toBe("claimed");
	expect(emptyClaim).toBeNull();
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
	const nextMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(steeredMessage?.messageId).toBe("queued-2");
	expect(steeredMessage?.status).toBe("claimed");
	expect(nextMessage?.messageId).toBe("queued-1");
});

test("claimed queued follow-ups can be requeued after send failure", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-requeue", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-requeue", workspaceId });

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-requeue",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Retry me"),
	});

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(claimedMessage?.status).toBe("claimed");
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.assistantQueuedMessages.requeueClaimed, {
		queuedMessageId: claimedMessage._id,
	});

	const retriedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id },
	);

	expect(retriedMessage?._id).toBe(claimedMessage?._id);
	expect(retriedMessage?.status).toBe("claimed");
});

test("discardClaimed removes consumed queued follow-ups from future drain attempts", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
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
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-discard", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-discard", workspaceId });

	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-discard",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Discard me"),
	});
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

test("stale claimed queued follow-ups are claimable by chat", async () => {
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
		message: queuedMessageInput("queued-1", "Recover me"),
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

	expect(listedMessages.map((message) => message._id)).toEqual([
		firstClaim._id,
	]);
	expect(secondClaim?._id).toBe(firstClaim?._id);
	expect(secondClaim?.status).toBe("claimed");
	expect(secondClaim?.claimedAt).toBeGreaterThan(1_000);
});
