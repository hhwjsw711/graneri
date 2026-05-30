import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { requireOwnedWorkspace, requireTokenIdentifier } from "./domain";

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
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("isArchived", false),
			)
			.take(100),
		ctx.db
			.query("chats")
			.withIndex("by_owner_ws_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("isArchived", false),
			)
			.take(100),
		ctx.db
			.query("projects")
			.withIndex("by_owner_ws_sortOrder", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", workspaceId),
			)
			.take(100),
	]);

	return [
		...notes.flatMap((note) =>
			note.isStarred ? [{ kind: "note" as const, id: note._id, doc: note }] : [],
		),
		...chats.flatMap((chat) =>
			chat.isStarred ? [{ kind: "chat" as const, id: chat._id, doc: chat }] : [],
		),
		...projects.flatMap((project) =>
			project.isStarred
				? [{ kind: "project" as const, id: project._id, doc: project }]
				: [],
		),
	];
};

const patchStarredSortOrder = async ({
	ctx,
	item,
	starredSortOrder,
}: {
	ctx: MutationCtx;
	item: StarredItem;
	starredSortOrder: number;
}) => {
	await ctx.db.patch(item.id, { starredSortOrder });
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

		await Promise.all(
			args.items.map((item, index) =>
				patchStarredSortOrder({ ctx, item, starredSortOrder: index }),
			),
		);

		return null;
	},
});
