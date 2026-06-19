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
	const saved = await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-agents",
		preview: "Prompt",
		message: {
			id: "chat-agents-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});

	return {
		asOwner,
		chatId: saved.chat._id,
		t,
		workspaceId,
	};
};

test("assistant agents reject duplicate canonical paths", async () => {
	const { asOwner, chatId, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.assistantAgents.createAgent, {
		workspaceId,
		rootChatId: chatId,
		agentPath: "/root/research",
		model: "gpt-5",
		initialTaskMessage: "Research queue parity.",
	});

	await expect(
		asOwner.mutation(api.assistantAgents.createAgent, {
			workspaceId,
			rootChatId: chatId,
			agentPath: "research",
			model: "gpt-5",
			initialTaskMessage: "Duplicate.",
		}),
	).rejects.toThrow("Assistant agent path already exists.");
});

test("assistant agent mailbox claims queued rows in FIFO order", async () => {
	const { asOwner, chatId, workspaceId } = await createWorkspace();
	const created = await asOwner.mutation(api.assistantAgents.createAgent, {
		workspaceId,
		rootChatId: chatId,
		agentPath: "/root/worker",
		model: "gpt-5",
		initialTaskMessage: "First task.",
	});

	await asOwner.mutation(api.assistantAgents.enqueueMailbox, {
		receiverAgentId: created.agentId,
		message: "Second task.",
		triggerTurn: true,
	});

	const claimed = await asOwner.mutation(
		api.assistantAgents.claimMailboxForAgent,
		{
			receiverAgentId: created.agentId,
			limit: 2,
		},
	);

	expect(claimed.map((row) => row?.message)).toEqual([
		"First task.",
		"Second task.",
	]);
	expect(claimed.every((row) => row?.status === "claimed")).toBe(true);
});

test("stale claimed mailbox rows are requeued before the next claim", async () => {
	const { asOwner, chatId, t, workspaceId } = await createWorkspace();
	const created = await asOwner.mutation(api.assistantAgents.createAgent, {
		workspaceId,
		rootChatId: chatId,
		agentPath: "/root/worker",
		model: "gpt-5",
		initialTaskMessage: "First task.",
	});
	const firstClaim = await asOwner.mutation(
		api.assistantAgents.claimMailboxForAgent,
		{
			receiverAgentId: created.agentId,
			limit: 1,
		},
	);
	const mailboxId = firstClaim[0]?._id;
	if (!mailboxId) {
		throw new Error("mailbox claim fixture failed");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(mailboxId, {
			claimedAt: Date.now() - 10 * 60 * 1000,
			updatedAt: Date.now() - 10 * 60 * 1000,
		});
	});

	const secondClaim = await asOwner.mutation(
		api.assistantAgents.claimMailboxForAgent,
		{
			receiverAgentId: created.agentId,
			limit: 1,
		},
	);

	expect(secondClaim.map((row) => row?._id)).toEqual([mailboxId]);
	expect(secondClaim[0]?.status).toBe("claimed");
});

test("completion can create a durable mailbox notification for the parent", async () => {
	const { asOwner, chatId, workspaceId } = await createWorkspace();
	const parent = await asOwner.mutation(api.assistantAgents.createAgent, {
		workspaceId,
		rootChatId: chatId,
		agentPath: "/root/parent",
		model: "gpt-5",
		initialTaskMessage: "Parent task.",
	});
	const initialParentMailbox = await asOwner.mutation(
		api.assistantAgents.claimMailboxForAgent,
		{
			receiverAgentId: parent.agentId,
			limit: 1,
		},
	);
	await asOwner.mutation(api.assistantAgents.markMailboxConsumed, {
		mailboxIds: initialParentMailbox.flatMap((row) =>
			row?._id ? [row._id] : [],
		),
	});
	const child = await asOwner.mutation(api.assistantAgents.createAgent, {
		workspaceId,
		rootChatId: chatId,
		parentAgentId: parent.agentId,
		agentPath: "/root/parent/child",
		model: "gpt-5",
		initialTaskMessage: "Child task.",
	});

	const result = await asOwner.mutation(api.assistantAgents.markAgentCompleted, {
		agentId: child.agentId,
		message: "Child result.",
		notifyAgentId: parent.agentId,
	});
	expect(result.mailboxId).toBeTruthy();

	const parentMailbox = await asOwner.query(
		api.assistantAgents.listMailboxForAgent,
		{
			receiverAgentId: parent.agentId,
			status: "queued",
		},
	);
	expect(parentMailbox.map((row) => row.message)).toEqual(["Child result."]);
	expect(parentMailbox[0]?.triggerTurn).toBe(false);
});

test("interrupt preserves the agent row with interrupted status", async () => {
	const { asOwner, chatId, workspaceId } = await createWorkspace();
	const created = await asOwner.mutation(api.assistantAgents.createAgent, {
		workspaceId,
		rootChatId: chatId,
		agentPath: "/root/worker",
		model: "gpt-5",
		initialTaskMessage: "Long task.",
	});
	await asOwner.mutation(api.assistantAgents.markAgentRunning, {
		agentId: created.agentId,
		activeRunId: "runtime-run-1",
	});

	await expect(
		asOwner.mutation(api.assistantAgents.interruptAgent, {
			rootChatId: chatId,
			targetAgentPath: "/root",
		}),
	).rejects.toThrow("Cannot interrupt the root agent.");

	const interrupted = await asOwner.mutation(
		api.assistantAgents.interruptAgent,
		{
			rootChatId: chatId,
			targetAgentPath: "/root/worker",
		},
	);
	expect(interrupted.previousStatus).toBe("running");

	const listed = await asOwner.query(api.assistantAgents.listAgentsForRootChat, {
		workspaceId,
		rootChatId: chatId,
	});
	expect(listed[0]?.status).toBe("interrupted");
	expect(listed[0]?.agentPath).toBe("/root/worker");
});
