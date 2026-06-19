import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireOwnedWorkspace } from "./domain";

export const nonTerminalRunStatuses = [
	"running",
	"waiting_for_user",
	"stopping",
] as const;

export const isNonTerminalRun = (run: Doc<"assistantRuns">) =>
	nonTerminalRunStatuses.some((status) => status === run.status);

export const getOwnedActiveChatById = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);
	const chat = await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId.trim()),
		)
		.unique();

	if (!chat || chat.isArchived) {
		return null;
	}

	return chat;
};

export const getNonTerminalRunsForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const runs: Doc<"assistantRuns">[] = [];

	for (const status of nonTerminalRunStatuses) {
		for await (const run of ctx.db
			.query("assistantRuns")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chatId).eq("status", status),
			)) {
			runs.push(run);
		}
	}

	return runs.sort(
		(left, right) =>
			right.startedAt - left.startedAt ||
			right._creationTime - left._creationTime,
	);
};
