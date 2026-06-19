import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireOwnedWorkspace, requireTokenIdentifier } from "./domain";

const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

const mailboxStatusValidator = v.union(
	v.literal("queued"),
	v.literal("claimed"),
	v.literal("delivered"),
	v.literal("consumed"),
);

const ROOT_AGENT_PATH = "/root";
const CLAIMED_MAILBOX_STALE_MS = 5 * 60 * 1000;
const MAILBOX_CLAIM_LIMIT = 20;

const normalizeAgentPath = (value: string) => {
	const compact = value.replace(/\/+/g, "/").replace(/\/$/u, "");
	if (!compact || compact === "/") {
		return ROOT_AGENT_PATH;
	}
	return compact.startsWith("/") ? compact : `${ROOT_AGENT_PATH}/${compact}`;
};

const validateAgentPath = (agentPath: string) => {
	const normalized = normalizeAgentPath(agentPath);
	if (!normalized.startsWith(`${ROOT_AGENT_PATH}/`)) {
		throw new ConvexError({
			code: "ASSISTANT_AGENT_INVALID_PATH",
			message: "Agent path must be under /root.",
		});
	}
	if (
		normalized
			.slice(ROOT_AGENT_PATH.length + 1)
			.split("/")
			.some((segment) => !/^[a-z0-9_]+$/.test(segment))
	) {
		throw new ConvexError({
			code: "ASSISTANT_AGENT_INVALID_PATH",
			message:
				"Agent path segments must use lowercase letters, digits, and underscores.",
		});
	}
	return normalized;
};

const getTaskNameFromPath = (agentPath: string) =>
	agentPath.split("/").filter(Boolean).at(-1) ?? "root";

const requireOwnedRootChat = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	rootChatId: Id<"chats">,
) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);
	const chat = await ctx.db.get(rootChatId);
	if (
		!chat ||
		chat.ownerTokenIdentifier !== ownerTokenIdentifier ||
		chat.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "CHAT_NOT_FOUND",
			message: "Chat not found.",
		});
	}
	return chat;
};

const getAgentByPath = async (
	ctx: QueryCtx | MutationCtx,
	rootChatId: Id<"chats">,
	agentPath: string,
) =>
	await ctx.db
		.query("assistantAgents")
		.withIndex("by_rootChatId_and_agentPath", (q) =>
			q.eq("rootChatId", rootChatId).eq("agentPath", agentPath),
		)
		.unique();

const requireOwnedAgent = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	agentId: Id<"assistantAgents">,
) => {
	const agent = await ctx.db.get(agentId);
	if (!agent || agent.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_AGENT_NOT_FOUND",
			message: "Assistant agent not found.",
		});
	}
	return agent;
};

const requireOwnedAgentPath = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	rootChatId: Id<"chats">,
	agentPath: string,
) => {
	const agent = await getAgentByPath(ctx, rootChatId, agentPath);
	if (!agent || agent.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_AGENT_NOT_FOUND",
			message: "Assistant agent not found.",
		});
	}
	return agent;
};

const requireOwnedMailbox = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	mailboxId: Id<"assistantAgentMailbox">,
) => {
	const mailbox = await ctx.db.get(mailboxId);
	if (!mailbox || mailbox.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_AGENT_MAILBOX_NOT_FOUND",
			message: "Assistant agent mailbox row not found.",
		});
	}
	return mailbox;
};

const isStaleClaimedMailbox = (
	mailbox: { claimedAt?: number; updatedAt: number },
	now: number,
) =>
	now - (mailbox.claimedAt !== undefined ? mailbox.claimedAt : mailbox.updatedAt) >=
	CLAIMED_MAILBOX_STALE_MS;

const requeueStaleClaimedMailboxForAgent = async (
	ctx: MutationCtx,
	receiverAgentId: Id<"assistantAgents">,
	now: number,
) => {
	const staleRows = await ctx.db
		.query("assistantAgentMailbox")
		.withIndex("by_receiverAgentId_and_status_and_createdAt", (q) =>
			q.eq("receiverAgentId", receiverAgentId).eq("status", "claimed"),
		)
		.take(MAILBOX_CLAIM_LIMIT);
	for (const row of staleRows) {
		if (isStaleClaimedMailbox(row, now)) {
			await ctx.db.patch(row._id, {
				status: "queued",
				updatedAt: now,
				claimedAt: undefined,
			});
		}
	}
};

const insertMailbox = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		rootChatId: Id<"chats">;
		senderAgentId?: Id<"assistantAgents">;
		receiverAgentId: Id<"assistantAgents">;
		sourceCallId?: string;
		message: string;
		triggerTurn: boolean;
		now: number;
	},
) =>
	await ctx.db.insert("assistantAgentMailbox", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		rootChatId: args.rootChatId,
		senderAgentId: args.senderAgentId,
		receiverAgentId: args.receiverAgentId,
		sourceCallId: args.sourceCallId,
		message: args.message,
		triggerTurn: args.triggerTurn,
		status: "queued",
		createdAt: args.now,
		updatedAt: args.now,
	});

export const createAgent = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		rootChatId: v.id("chats"),
		parentAgentId: v.optional(v.id("assistantAgents")),
		agentPath: v.string(),
		model: v.string(),
		reasoningEffort: v.optional(reasoningEffortValidator),
		initialTaskMessage: v.string(),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent",
		);
		await requireOwnedRootChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.rootChatId,
		);
		const agentPath = validateAgentPath(args.agentPath);
		if (!args.initialTaskMessage.trim()) {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_TASK_EMPTY",
				message: "Assistant agent task message cannot be empty.",
			});
		}
		const existing = await getAgentByPath(ctx, args.rootChatId, agentPath);
		if (existing) {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_DUPLICATE_PATH",
				message: "Assistant agent path already exists.",
			});
		}
		if (args.parentAgentId) {
			const parent = await requireOwnedAgent(
				ctx,
				ownerTokenIdentifier,
				args.parentAgentId,
			);
			if (
				parent.rootChatId !== args.rootChatId ||
				parent.workspaceId !== args.workspaceId
			) {
				throw new ConvexError({
					code: "ASSISTANT_AGENT_PARENT_MISMATCH",
					message: "Assistant agent parent belongs to another root chat.",
				});
			}
		}
		const now = Date.now();
		const agentId = await ctx.db.insert("assistantAgents", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			rootChatId: args.rootChatId,
			parentAgentId: args.parentAgentId,
			agentPath,
			taskName: getTaskNameFromPath(agentPath),
			status: "pending_init",
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			lastTaskMessage: args.initialTaskMessage,
			createdAt: now,
			updatedAt: now,
		});
		const mailboxId = await insertMailbox(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			rootChatId: args.rootChatId,
			receiverAgentId: agentId,
			message: args.initialTaskMessage,
			triggerTurn: true,
			now,
		});
		return {
			agentId,
			mailboxId,
			agentPath,
		};
	},
});

export const markAgentRunning = mutation({
	args: {
		agentId: v.id("assistantAgents"),
		activeRunId: v.string(),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent",
		);
		const agent = await requireOwnedAgent(ctx, ownerTokenIdentifier, args.agentId);
		if (agent.status === "shutdown") {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_SHUTDOWN",
				message: "Assistant agent is shut down.",
			});
		}
		const now = Date.now();
		await ctx.db.patch(agent._id, {
			status: "running",
			activeRunId: args.activeRunId,
			updatedAt: now,
			finishedAt: undefined,
		});
		return await ctx.db.get(agent._id);
	},
});

export const markAgentCompleted = mutation({
	args: {
		agentId: v.id("assistantAgents"),
		message: v.string(),
		notifyAgentId: v.optional(v.id("assistantAgents")),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent",
		);
		const agent = await requireOwnedAgent(ctx, ownerTokenIdentifier, args.agentId);
		if (!args.message.trim()) {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_COMPLETION_EMPTY",
				message: "Assistant agent completion cannot be empty.",
			});
		}
		const now = Date.now();
		await ctx.db.patch(agent._id, {
			status: "completed",
			lastAssistantMessage: args.message,
			activeRunId: undefined,
			updatedAt: now,
			finishedAt: now,
		});
		let mailboxId: Id<"assistantAgentMailbox"> | null = null;
		if (args.notifyAgentId) {
			const receiver = await requireOwnedAgent(
				ctx,
				ownerTokenIdentifier,
				args.notifyAgentId,
			);
			if (
				receiver.workspaceId !== agent.workspaceId ||
				receiver.rootChatId !== agent.rootChatId
			) {
				throw new ConvexError({
					code: "ASSISTANT_AGENT_NOTIFY_MISMATCH",
					message: "Notification target belongs to another root chat.",
				});
			}
			mailboxId = await insertMailbox(ctx, {
				ownerTokenIdentifier,
				workspaceId: agent.workspaceId,
				rootChatId: agent.rootChatId,
				senderAgentId: agent._id,
				receiverAgentId: receiver._id,
				message: args.message,
				triggerTurn: false,
				now,
			});
		}
		return {
			agentId: agent._id,
			mailboxId,
		};
	},
});

export const markAgentErrored = mutation({
	args: {
		agentId: v.id("assistantAgents"),
		errorText: v.string(),
		notifyAgentId: v.optional(v.id("assistantAgents")),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent",
		);
		const agent = await requireOwnedAgent(ctx, ownerTokenIdentifier, args.agentId);
		const message = args.errorText.trim() || "Unknown assistant agent error.";
		const now = Date.now();
		await ctx.db.patch(agent._id, {
			status: "errored",
			lastAssistantMessage: message,
			activeRunId: undefined,
			updatedAt: now,
			finishedAt: now,
		});
		let mailboxId: Id<"assistantAgentMailbox"> | null = null;
		if (args.notifyAgentId) {
			const receiver = await requireOwnedAgent(
				ctx,
				ownerTokenIdentifier,
				args.notifyAgentId,
			);
			if (
				receiver.workspaceId !== agent.workspaceId ||
				receiver.rootChatId !== agent.rootChatId
			) {
				throw new ConvexError({
					code: "ASSISTANT_AGENT_NOTIFY_MISMATCH",
					message: "Notification target belongs to another root chat.",
				});
			}
			mailboxId = await insertMailbox(ctx, {
				ownerTokenIdentifier,
				workspaceId: agent.workspaceId,
				rootChatId: agent.rootChatId,
				senderAgentId: agent._id,
				receiverAgentId: receiver._id,
				message,
				triggerTurn: false,
				now,
			});
		}
		return {
			agentId: agent._id,
			mailboxId,
		};
	},
});

export const interruptAgent = mutation({
	args: {
		rootChatId: v.id("chats"),
		targetAgentPath: v.string(),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent",
		);
		const targetAgentPath = normalizeAgentPath(args.targetAgentPath);
		if (targetAgentPath === ROOT_AGENT_PATH) {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_TARGET_ROOT",
				message: "Cannot interrupt the root agent.",
			});
		}
		const agent = await requireOwnedAgentPath(
			ctx,
			ownerTokenIdentifier,
			args.rootChatId,
			targetAgentPath,
		);
		const previousStatus = agent.status;
		const now = Date.now();
		await ctx.db.patch(agent._id, {
			status: "interrupted",
			activeRunId: undefined,
			interruptRequestedAt: now,
			updatedAt: now,
		});
		return {
			agentId: agent._id,
			previousStatus,
		};
	},
});

export const enqueueMailbox = mutation({
	args: {
		receiverAgentId: v.id("assistantAgents"),
		senderAgentId: v.optional(v.id("assistantAgents")),
		sourceCallId: v.optional(v.string()),
		message: v.string(),
		triggerTurn: v.boolean(),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent mailbox",
		);
		if (!args.message.trim()) {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_MAILBOX_EMPTY",
				message: "Assistant agent mailbox message cannot be empty.",
			});
		}
		const receiver = await requireOwnedAgent(
			ctx,
			ownerTokenIdentifier,
			args.receiverAgentId,
		);
		if (receiver.status === "shutdown") {
			throw new ConvexError({
				code: "ASSISTANT_AGENT_SHUTDOWN",
				message: "Assistant agent is shut down.",
			});
		}
		let sender: Doc<"assistantAgents"> | null = null;
		if (args.senderAgentId) {
			sender = await requireOwnedAgent(ctx, ownerTokenIdentifier, args.senderAgentId);
			if (
				sender.workspaceId !== receiver.workspaceId ||
				sender.rootChatId !== receiver.rootChatId
			) {
				throw new ConvexError({
					code: "ASSISTANT_AGENT_SENDER_MISMATCH",
					message: "Mailbox sender belongs to another root chat.",
				});
			}
		}
		const now = Date.now();
		const mailboxId = await insertMailbox(ctx, {
			ownerTokenIdentifier,
			workspaceId: receiver.workspaceId,
			rootChatId: receiver.rootChatId,
			senderAgentId: sender?._id,
			receiverAgentId: receiver._id,
			sourceCallId: args.sourceCallId,
			message: args.message,
			triggerTurn: args.triggerTurn,
			now,
		});
		await ctx.db.patch(receiver._id, {
			lastTaskMessage: args.message,
			updatedAt: now,
		});
		return await ctx.db.get(mailboxId);
	},
});

export const claimMailboxForAgent = mutation({
	args: {
		receiverAgentId: v.id("assistantAgents"),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent mailbox",
		);
		const receiver = await requireOwnedAgent(
			ctx,
			ownerTokenIdentifier,
			args.receiverAgentId,
		);
		const now = Date.now();
		await requeueStaleClaimedMailboxForAgent(ctx, receiver._id, now);
		const limit = Math.min(
			Math.max(Math.floor(args.limit ?? MAILBOX_CLAIM_LIMIT), 1),
			MAILBOX_CLAIM_LIMIT,
		);
		const queuedRows = await ctx.db
			.query("assistantAgentMailbox")
			.withIndex("by_receiverAgentId_and_status_and_createdAt", (q) =>
				q.eq("receiverAgentId", receiver._id).eq("status", "queued"),
			)
			.order("asc")
			.take(limit);
		for (const row of queuedRows) {
			await ctx.db.patch(row._id, {
				status: "claimed",
				claimedAt: now,
				updatedAt: now,
			});
		}
		return await Promise.all(queuedRows.map((row) => ctx.db.get(row._id)));
	},
});

export const markMailboxDelivered = mutation({
	args: {
		mailboxIds: v.array(v.id("assistantAgentMailbox")),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent mailbox",
		);
		const now = Date.now();
		for (const mailboxId of args.mailboxIds) {
			const mailbox = await requireOwnedMailbox(
				ctx,
				ownerTokenIdentifier,
				mailboxId,
			);
			if (mailbox.status !== "claimed") {
				throw new ConvexError({
					code: "ASSISTANT_AGENT_MAILBOX_NOT_CLAIMED",
					message: "Assistant agent mailbox row is not claimed.",
				});
			}
			await ctx.db.patch(mailbox._id, {
				status: "delivered",
				deliveredAt: now,
				updatedAt: now,
			});
		}
		return { delivered: args.mailboxIds.length };
	},
});

export const markMailboxConsumed = mutation({
	args: {
		mailboxIds: v.array(v.id("assistantAgentMailbox")),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent mailbox",
		);
		const now = Date.now();
		for (const mailboxId of args.mailboxIds) {
			const mailbox = await requireOwnedMailbox(
				ctx,
				ownerTokenIdentifier,
				mailboxId,
			);
			if (mailbox.status !== "delivered" && mailbox.status !== "claimed") {
				throw new ConvexError({
					code: "ASSISTANT_AGENT_MAILBOX_NOT_DELIVERABLE",
					message: "Assistant agent mailbox row cannot be consumed.",
				});
			}
			await ctx.db.patch(mailbox._id, {
				status: "consumed",
				consumedAt: now,
				updatedAt: now,
			});
		}
		return { consumed: args.mailboxIds.length };
	},
});

export const listAgentsForRootChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		rootChatId: v.id("chats"),
		pathPrefix: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agents",
		);
		await requireOwnedRootChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.rootChatId,
		);
		const normalizedPrefix =
			args.pathPrefix !== undefined ? normalizeAgentPath(args.pathPrefix) : null;
		const rows = await ctx.db
			.query("assistantAgents")
			.withIndex("by_rootChatId_and_agentPath", (q) =>
				q.eq("rootChatId", args.rootChatId),
			)
			.take(100);
		return rows
			.filter((agent) => agent.status !== "shutdown")
			.filter(
				(agent) =>
					!normalizedPrefix || agent.agentPath.startsWith(normalizedPrefix),
			)
			.map((agent) => ({
				agentId: agent._id,
				agentPath: agent.agentPath,
				status: agent.status,
				lastTaskMessage: agent.lastTaskMessage ?? null,
				lastAssistantMessage: agent.lastAssistantMessage ?? null,
			}));
	},
});

export const getAgentByPathForRootChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		rootChatId: v.id("chats"),
		agentPath: v.string(),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent",
		);
		await requireOwnedRootChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.rootChatId,
		);
		const agent = await getAgentByPath(
			ctx,
			args.rootChatId,
			normalizeAgentPath(args.agentPath),
		);
		if (!agent || agent.ownerTokenIdentifier !== ownerTokenIdentifier) {
			return null;
		}
		return agent;
	},
});

export const listMailboxForAgent = query({
	args: {
		receiverAgentId: v.id("assistantAgents"),
		status: v.optional(mailboxStatusValidator),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(
			ctx,
			"assistant agent mailbox",
		);
		const receiver = await requireOwnedAgent(
			ctx,
			ownerTokenIdentifier,
			args.receiverAgentId,
		);
		const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 100);
		if (args.status !== undefined) {
			const status = args.status;
			return await ctx.db
				.query("assistantAgentMailbox")
				.withIndex("by_receiverAgentId_and_status_and_createdAt", (q) =>
					q.eq("receiverAgentId", receiver._id).eq("status", status),
				)
				.order("asc")
				.take(limit);
		}
		return await ctx.db
			.query("assistantAgentMailbox")
			.withIndex("by_rootChatId_and_status_and_createdAt", (q) =>
				q.eq("rootChatId", receiver.rootChatId).eq("status", "queued"),
			)
			.order("asc")
			.take(limit);
	},
});
