import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { requireOwnedWorkspace, requireTokenIdentifier } from "./domain";
import {
	assertSidebarReorderInputSize,
	assertSidebarStoredReorderSize,
	MAX_SIDEBAR_REORDER_ITEMS,
} from "./reorderLimits";

const starredItemValidator = v.union(
	v.object({
		kind: v.literal("note"),
		id: v.id("notes"),
	}),
	v.object({
		kind: v.literal("chat"),
		id: v.id("chats"),
	}),
	v.object({
		kind: v.literal("project"),
		id: v.id("projects"),
	}),
);

type StarredItem =
	| { kind: "note"; id: Id<"notes"> }
	| { kind: "chat"; id: Id<"chats"> }
	| { kind: "project"; id: Id<"projects"> };

const getStarredItemKey = (item: StarredItem) => `${item.kind}:${item.id}`;

const getStoredStarredItems = async ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: MutationCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const [notes, chats, projects] = await Promise.all([
		ctx.db
			.query("notes")
			.withIndex(
				"by_owner_workspace_archived_starred_starredOrder",
				(q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", workspaceId)
						.eq("isArchived", false)
						.eq("isStarred", true),
			)
			.take(MAX_SIDEBAR_REORDER_ITEMS + 1),
		ctx.db
			.query("chats")
			.withIndex(
				"by_owner_workspace_archived_starred_starredOrder",
				(q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", workspaceId)
						.eq("isArchived", false)
						.eq("isStarred", true),
			)
			.take(MAX_SIDEBAR_REORDER_ITEMS + 1),
		ctx.db
			.query("projects")
			.withIndex(
				"by_owner_workspace_starred_starredOrder",
				(q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", workspaceId)
						.eq("isStarred", true),
			)
			.take(MAX_SIDEBAR_REORDER_ITEMS + 1),
	]);

	return [
		...notes.map((note) => ({ kind: "note" as const, id: note._id, doc: note })),
		...chats.map((chat) => ({ kind: "chat" as const, id: chat._id, doc: chat })),
		...projects.map((project) => ({
			kind: "project" as const,
			id: project._id,
			doc: project,
		})),
	];
};

export const reorder = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		items: v.array(starredItemValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx, "starred");
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		assertSidebarReorderInputSize({
			count: args.items.length,
			errorCode: "STARRED_ORDER_TOO_LARGE",
		});

		const storedItems = await getStoredStarredItems({
			ctx,
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		});
		const storedItemsByKey = new Map(
			storedItems.map((item) => [getStarredItemKey(item), item.doc]),
		);
		const itemKeys = args.items.map(getStarredItemKey);
		const uniqueItemKeys = new Set(itemKeys);

		if (uniqueItemKeys.size !== args.items.length) {
			throw new ConvexError({
				code: "STARRED_ORDER_DUPLICATE_ID",
				message: "Starred order contains duplicate items.",
			});
		}

		assertSidebarStoredReorderSize({
			count: storedItems.length,
			errorCode: "STARRED_ORDER_TOO_LARGE",
		});

		if (storedItems.length !== args.items.length) {
			throw new ConvexError({
				code: "STARRED_ORDER_MISMATCH",
				message: "Starred order must include every starred item.",
			});
		}

		if (itemKeys.some((key) => !storedItemsByKey.has(key))) {
			throw new ConvexError({
				code: "STARRED_ITEM_NOT_FOUND",
				message: "Starred item not found.",
			});
		}

		const orderUpdates = args.items.flatMap((item, index) => {
			const storedItem = storedItemsByKey.get(getStarredItemKey(item));
			if (storedItem?.starredSortOrder === index) {
				return [];
			}

			return [{ item, starredSortOrder: index }];
		});

		await Promise.all(
			orderUpdates.map(({ item, starredSortOrder }) =>
				ctx.db.patch(item.id, {
					starredSortOrder,
				}),
			),
		);

		return null;
	},
});
