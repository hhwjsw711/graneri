import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const calendarPreferencesValidator = v.object({
	showGoogleCalendar: v.boolean(),
	showGoogleDrive: v.boolean(),
	showYandexCalendar: v.boolean(),
});

const REMOVE_ALL_CALENDAR_PREFERENCES_BATCH_SIZE = 100;

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access calendar preferences.",
		});
	}

	return identity;
};

const requireOwnedWorkspace = async (
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

const getCalendarPreferencesRecord = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await ctx.db
		.query("calendarPreferences")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.unique();

export const get = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: calendarPreferencesValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		const preferences = await getCalendarPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		return {
			showGoogleCalendar: preferences?.showGoogleCalendar ?? false,
			showGoogleDrive: preferences?.showGoogleDrive ?? false,
			showYandexCalendar: preferences?.showYandexCalendar ?? false,
		};
	},
});

export const update = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		showGoogleCalendar: v.boolean(),
		showGoogleDrive: v.boolean(),
		showYandexCalendar: v.boolean(),
	},
	returns: calendarPreferencesValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(ctx, identity.tokenIdentifier, args.workspaceId);
		const existing = await getCalendarPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				showGoogleCalendar: args.showGoogleCalendar,
				showGoogleDrive: args.showGoogleDrive,
				showYandexCalendar: args.showYandexCalendar,
				updatedAt: now,
			});

			return {
				showGoogleCalendar: args.showGoogleCalendar,
				showGoogleDrive: args.showGoogleDrive,
				showYandexCalendar: args.showYandexCalendar,
			};
		}

		await ctx.db.insert("calendarPreferences", {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			showGoogleCalendar: args.showGoogleCalendar,
			showGoogleDrive: args.showGoogleDrive,
			showYandexCalendar: args.showYandexCalendar,
			createdAt: now,
			updatedAt: now,
		});

		return {
			showGoogleCalendar: args.showGoogleCalendar,
			showGoogleDrive: args.showGoogleDrive,
			showYandexCalendar: args.showYandexCalendar,
		};
	},
});

const deleteCalendarPreferencesBatchForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const preferences = await ctx.db
		.query("calendarPreferences")
		.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_CALENDAR_PREFERENCES_BATCH_SIZE);

	await Promise.all(preferences.map((preference) => ctx.db.delete(preference._id)));

	return {
		deletedCount: preferences.length,
		hasMore:
			preferences.length === REMOVE_ALL_CALENDAR_PREFERENCES_BATCH_SIZE,
	};
};

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const preferences = await getCalendarPreferencesRecord(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (preferences) {
			await ctx.db.delete(preferences._id);
		}

		return null;
	},
});

export const enableYandexCalendarPreferenceForWorkspace = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">,
	},
): Promise<{
	showGoogleCalendar: boolean;
	showGoogleDrive: boolean;
	showYandexCalendar: boolean;
}> => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	const existing = await getCalendarPreferencesRecord(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
	);
	const now = Date.now();

	if (existing) {
		await ctx.db.patch(existing._id, {
			showYandexCalendar: true,
			updatedAt: now,
		});

		return {
			showGoogleCalendar: existing.showGoogleCalendar,
			showGoogleDrive: existing.showGoogleDrive ?? false,
			showYandexCalendar: true,
		};
	}

	await ctx.db.insert("calendarPreferences", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		showGoogleCalendar: false,
		showGoogleDrive: false,
		showYandexCalendar: true,
		createdAt: now,
		updatedAt: now,
	});

	return {
		showGoogleCalendar: false,
		showGoogleDrive: false,
		showYandexCalendar: true,
	};
};

export const enableYandexCalendarForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: calendarPreferencesValidator,
	handler: async (ctx, args) => {
		return await enableYandexCalendarPreferenceForWorkspace(ctx, args);
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteCalendarPreferencesBatchForOwner(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.calendarPreferences.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});
