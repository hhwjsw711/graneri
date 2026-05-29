import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type AuthenticatedIdentity = NonNullable<
	Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
>;

export const requireIdentity = async (
	ctx: QueryCtx | MutationCtx,
	resourceName: string,
) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: `You must be signed in to access ${resourceName}.`,
		});
	}

	return identity;
};

export const requireTokenIdentifier = async (
	ctx: QueryCtx | MutationCtx,
	resourceName: string,
) => {
	const identity = await requireIdentity(ctx, resourceName);

	return identity.tokenIdentifier;
};

export const requireOwnedWorkspace = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const workspace = await ctx.db.get(workspaceId);

	if (!workspace || workspace.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "WORKSPACE_NOT_FOUND",
			message: "Workspace not found.",
		});
	}

	return workspace;
};

export const getAuthorName = (identity: AuthenticatedIdentity) =>
	identity.name?.trim() || identity.email?.trim() || "Unknown user";

export const clampWhitespace = (value: string) =>
	value.replace(/\s+/g, " ").trim();

export const truncate = (value: string, maxLength: number) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

export const uppercaseFirstCharacter = (value: string) => {
	if (!value) {
		return value;
	}

	return value.charAt(0).toUpperCase() + value.slice(1);
};
