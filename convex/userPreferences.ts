import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const userPreferencesValidator = v.object({
	transcriptionLanguage: v.union(v.string(), v.null()),
	jobTitle: v.union(v.string(), v.null()),
	companyName: v.union(v.string(), v.null()),
	fontSmoothing: v.boolean(),
	reduceMotion: v.union(v.literal("system"), v.literal("on"), v.literal("off")),
	translucentSidebar: v.boolean(),
	avatarStorageId: v.union(v.id("_storage"), v.null()),
	avatarUrl: v.union(v.string(), v.null()),
});

const reduceMotionValidator = v.union(
	v.literal("system"),
	v.literal("on"),
	v.literal("off"),
);

const DEFAULT_FONT_SMOOTHING = true;
const DEFAULT_REDUCE_MOTION = "system";
const DEFAULT_TRANSLUCENT_SIDEBAR = false;

const userAiProfileContextValidator = v.object({
	name: v.union(v.string(), v.null()),
	jobTitle: v.union(v.string(), v.null()),
	companyName: v.union(v.string(), v.null()),
});

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access user preferences.",
		});
	}

	return identity;
};

const getFirstName = (value: string | null | undefined) => {
	const trimmedValue = value?.trim() ?? "";

	if (!trimmedValue) {
		return null;
	}

	return trimmedValue.split(/\s+/u)[0] ?? null;
};

const getUserPreferencesRecord = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
) =>
	await ctx.db
		.query("userPreferences")
		.withIndex("by_ownerTokenIdentifier", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.unique();

const toUserPreferencesResponse = async (
	ctx: QueryCtx | MutationCtx,
	preferences: Awaited<ReturnType<typeof getUserPreferencesRecord>>,
) => ({
	transcriptionLanguage: preferences?.transcriptionLanguage ?? null,
	jobTitle: preferences?.jobTitle ?? null,
	companyName: preferences?.companyName ?? null,
	fontSmoothing: preferences
		? preferences.fontSmoothing
		: DEFAULT_FONT_SMOOTHING,
	reduceMotion: preferences ? preferences.reduceMotion : DEFAULT_REDUCE_MOTION,
	translucentSidebar: preferences
		? preferences.translucentSidebar
		: DEFAULT_TRANSLUCENT_SIDEBAR,
	avatarStorageId: preferences?.avatarStorageId ?? null,
	avatarUrl: preferences?.avatarStorageId
		? await ctx.storage.getUrl(preferences.avatarStorageId)
		: null,
});

export const get = query({
	args: {},
	returns: userPreferencesValidator,
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const preferences = await getUserPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
		);

		return await toUserPreferencesResponse(ctx, preferences);
	},
});

export const getAiProfileContext = query({
	args: {},
	returns: userAiProfileContextValidator,
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const preferences = await getUserPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
		);

		return {
			name: getFirstName(identity.name),
			jobTitle: preferences?.jobTitle ?? null,
			companyName: preferences?.companyName ?? null,
		};
	},
});

export const update = mutation({
	args: {
		transcriptionLanguage: v.optional(v.union(v.string(), v.null())),
		jobTitle: v.optional(v.union(v.string(), v.null())),
		companyName: v.optional(v.union(v.string(), v.null())),
		fontSmoothing: v.optional(v.boolean()),
		reduceMotion: v.optional(reduceMotionValidator),
		translucentSidebar: v.optional(v.boolean()),
		avatarStorageId: v.optional(v.union(v.id("_storage"), v.null())),
	},
	returns: userPreferencesValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const existing = await getUserPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
		);
		const now = Date.now();
		const nextPreferences = {
			transcriptionLanguage:
				args.transcriptionLanguage !== undefined
					? args.transcriptionLanguage
					: (existing?.transcriptionLanguage ?? null),
			jobTitle:
				args.jobTitle !== undefined
					? args.jobTitle
					: (existing?.jobTitle ?? null),
			companyName:
				args.companyName !== undefined
					? args.companyName
					: (existing?.companyName ?? null),
			fontSmoothing:
				args.fontSmoothing !== undefined
					? args.fontSmoothing
					: existing
						? existing.fontSmoothing
						: DEFAULT_FONT_SMOOTHING,
			reduceMotion:
				args.reduceMotion !== undefined
					? args.reduceMotion
					: existing
						? existing.reduceMotion
						: DEFAULT_REDUCE_MOTION,
			translucentSidebar:
				args.translucentSidebar !== undefined
					? args.translucentSidebar
					: existing
						? existing.translucentSidebar
						: DEFAULT_TRANSLUCENT_SIDEBAR,
			avatarStorageId:
				args.avatarStorageId !== undefined
					? args.avatarStorageId
					: (existing?.avatarStorageId ?? null),
		};

		if (existing) {
			if (
				nextPreferences.transcriptionLanguage ===
					existing.transcriptionLanguage &&
				nextPreferences.jobTitle === existing.jobTitle &&
				nextPreferences.companyName === existing.companyName &&
				nextPreferences.fontSmoothing === existing.fontSmoothing &&
				nextPreferences.reduceMotion === existing.reduceMotion &&
				nextPreferences.translucentSidebar === existing.translucentSidebar &&
				(nextPreferences.avatarStorageId ?? undefined) ===
					existing.avatarStorageId
			) {
				return await toUserPreferencesResponse(ctx, existing);
			}

			if (
				existing.avatarStorageId &&
				existing.avatarStorageId !== nextPreferences.avatarStorageId
			) {
				await ctx.storage.delete(existing.avatarStorageId);
			}

			await ctx.db.patch(existing._id, {
				transcriptionLanguage: nextPreferences.transcriptionLanguage,
				jobTitle: nextPreferences.jobTitle,
				companyName: nextPreferences.companyName,
				fontSmoothing: nextPreferences.fontSmoothing,
				reduceMotion: nextPreferences.reduceMotion,
				translucentSidebar: nextPreferences.translucentSidebar,
				avatarStorageId: nextPreferences.avatarStorageId ?? undefined,
				updatedAt: now,
			});

			return await toUserPreferencesResponse(ctx, {
				...existing,
				transcriptionLanguage: nextPreferences.transcriptionLanguage,
				jobTitle: nextPreferences.jobTitle,
				companyName: nextPreferences.companyName,
				fontSmoothing: nextPreferences.fontSmoothing,
				reduceMotion: nextPreferences.reduceMotion,
				translucentSidebar: nextPreferences.translucentSidebar,
				avatarStorageId: nextPreferences.avatarStorageId ?? undefined,
				updatedAt: now,
			});
		}

		const preferenceId = await ctx.db.insert("userPreferences", {
			ownerTokenIdentifier: identity.tokenIdentifier,
			transcriptionLanguage: nextPreferences.transcriptionLanguage,
			jobTitle: nextPreferences.jobTitle,
			companyName: nextPreferences.companyName,
			fontSmoothing: nextPreferences.fontSmoothing,
			reduceMotion: nextPreferences.reduceMotion,
			translucentSidebar: nextPreferences.translucentSidebar,
			avatarStorageId: nextPreferences.avatarStorageId ?? undefined,
			createdAt: now,
			updatedAt: now,
		});

		const inserted = await ctx.db.get(preferenceId);
		return await toUserPreferencesResponse(ctx, inserted);
	},
});

export const generateAvatarUploadUrl = mutation({
	args: {},
	returns: v.string(),
	handler: async (ctx) => {
		await requireIdentity(ctx);
		return await ctx.storage.generateUploadUrl();
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const preferences = await getUserPreferencesRecord(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (!preferences) {
			return null;
		}

		if (preferences.avatarStorageId) {
			await ctx.storage.delete(preferences.avatarStorageId);
		}

		await ctx.db.delete(preferences._id);
		return null;
	},
});
