import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	assertSidebarReorderInputSize,
	assertSidebarStoredReorderSize,
	MAX_SIDEBAR_REORDER_ITEMS,
} from "./reorderLimits";

const projectFields = {
	_id: v.id("projects"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	name: v.string(),
	normalizedName: v.string(),
	isStarred: v.boolean(),
	sortOrder: v.number(),
	starredSortOrder: v.number(),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const projectValidator = v.object(projectFields);

const REMOVE_ALL_PROJECTS_BATCH_SIZE = 100;
const REMOVE_PROJECT_NOTES_BATCH_SIZE = 100;
const MAX_PROJECT_NAME_LENGTH = 48;

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access projects.",
		});
	}

	return identity;
};

const normalizeProjectName = (value: string) =>
	value.replace(/\s+/g, " ").trim();

const toNormalizedProjectKey = (value: string) =>
	normalizeProjectName(value).toLowerCase();

const withProjectDefaults = (project: Doc<"projects">) => ({
	...project,
	isStarred: project.isStarred ?? false,
});

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

export const ensureOwnedProject = ({
	project,
	ownerTokenIdentifier,
	workspaceId,
}: {
	project: Doc<"projects"> | null;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	if (!project) {
		throw new ConvexError({
			code: "PROJECT_NOT_FOUND",
			message: "Project not found.",
		});
	}

	if (
		project.ownerTokenIdentifier !== ownerTokenIdentifier ||
		project.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "UNAUTHORIZED",
			message: "You do not have access to this project.",
		});
	}

	return project;
};

export const requireOwnedProject = async (
	ctx: QueryCtx | MutationCtx,
	id: Id<"projects">,
	workspaceId: Id<"workspaces">,
) => {
	const identity = await requireIdentity(ctx);
	await requireOwnedWorkspace(ctx, identity.tokenIdentifier, workspaceId);

	return ensureOwnedProject({
		project: await ctx.db.get(id),
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId,
	});
};

const deleteProjectBatchForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const projects = await ctx.db
		.query("projects")
		.withIndex("by_owner_ws_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_PROJECTS_BATCH_SIZE);

	await Promise.all(projects.map((project) => ctx.db.delete(project._id)));

	return {
		deletedCount: projects.length,
		hasMore: projects.length === REMOVE_ALL_PROJECTS_BATCH_SIZE,
	};
};

const validateProjectName = (name: string) => {
	if (name.length < 1) {
		throw new ConvexError({
			code: "INVALID_PROJECT_NAME",
			message: "Project name is required.",
		});
	}

	if (name.length > MAX_PROJECT_NAME_LENGTH) {
		throw new ConvexError({
			code: "INVALID_PROJECT_NAME",
			message: `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`,
		});
	}
};

const clearProjectNotes = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects">,
) => {
	const now = Date.now();

	for (const isArchived of [false, true] as const) {
		while (true) {
			const notes = await ctx.db
				.query("notes")
				.withIndex("by_owner_ws_project_arch_upd", (q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", workspaceId)
						.eq("projectId", projectId)
						.eq("isArchived", isArchived),
				)
				.take(REMOVE_PROJECT_NOTES_BATCH_SIZE);

			if (notes.length === 0) {
				break;
			}

			await Promise.all(
				notes.map((note) =>
					ctx.db.patch(note._id, {
						projectId: undefined,
						updatedAt: now,
					}),
				),
			);

			if (notes.length < REMOVE_PROJECT_NOTES_BATCH_SIZE) {
				break;
			}
		}
	}
};

const moveProjectNotesToTrash = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects">,
) => {
	let movedCount = 0;

	while (true) {
		const now = Date.now();
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_project_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("projectId", projectId)
					.eq("isArchived", false),
			)
			.take(REMOVE_PROJECT_NOTES_BATCH_SIZE);

		if (notes.length === 0) {
			break;
		}

		await Promise.all(
			notes.map(async (note) => {
				await ctx.db.patch(note._id, {
					isArchived: true,
					archivedAt: now,
					updatedAt: now,
				});
				await ctx.runMutation(internal.chats.archiveForNote, {
					ownerTokenIdentifier,
					workspaceId,
					noteId: note._id,
				});
			}),
		);

		movedCount += notes.length;

		if (notes.length < REMOVE_PROJECT_NOTES_BATCH_SIZE) {
			break;
		}
	}

	return movedCount;
};
export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(projectValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		const projects = await ctx.db
			.query("projects")
			.withIndex("by_owner_ws_sortOrder", (q) =>
				q
					.eq("ownerTokenIdentifier", identity.tokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(100);

		return projects.map(withProjectDefaults);
	},
});

export const create = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		name: v.string(),
	},
	returns: projectValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		const name = normalizeProjectName(args.name);
		validateProjectName(name);

		const normalizedName = toNormalizedProjectKey(name);
		const existing = await ctx.db
			.query("projects")
			.withIndex("by_owner_ws_normalizedName", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("normalizedName", normalizedName),
			)
			.unique();

		if (existing) {
			throw new ConvexError({
				code: "PROJECT_ALREADY_EXISTS",
				message: "A project with that name already exists.",
			});
		}

		const now = Date.now();
		const projectId = await ctx.db.insert("projects", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			name,
			normalizedName,
			isStarred: false,
			sortOrder: now,
			starredSortOrder: now,
			createdAt: now,
			updatedAt: now,
		});
		const project = await ctx.db.get(projectId);

		if (!project) {
			throw new ConvexError({
				code: "PROJECT_CREATE_FAILED",
				message: "Failed to create project.",
			});
		}

		return withProjectDefaults(project);
	},
});

export const reorder = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		projectIds: v.array(v.id("projects")),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		const uniqueProjectIds = [...new Set(args.projectIds)];
		if (uniqueProjectIds.length !== args.projectIds.length) {
			throw new ConvexError({
				code: "PROJECT_ORDER_DUPLICATE_ID",
				message: "Project order contains duplicate projects.",
			});
		}

		assertSidebarReorderInputSize({
			count: args.projectIds.length,
			errorCode: "PROJECT_ORDER_TOO_LARGE",
		});

		const projects = await ctx.db
			.query("projects")
			.withIndex("by_owner_ws_sortOrder", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(MAX_SIDEBAR_REORDER_ITEMS + 1);
		assertSidebarStoredReorderSize({
			count: projects.length,
			errorCode: "PROJECT_ORDER_TOO_LARGE",
		});

		if (projects.length !== args.projectIds.length) {
			throw new ConvexError({
				code: "PROJECT_ORDER_MISMATCH",
				message: "Project order must include every project.",
			});
		}

		const projectIds = new Set(projects.map((project) => project._id));
		if (args.projectIds.some((projectId) => !projectIds.has(projectId))) {
			throw new ConvexError({
				code: "PROJECT_NOT_FOUND",
				message: "Project not found.",
			});
		}

		const projectsById = new Map(
			projects.map((project) => [project._id, project]),
		);
		const orderUpdates = args.projectIds.flatMap((projectId, index) => {
			const project = projectsById.get(projectId);
			if (project?.sortOrder === index) {
				return [];
			}

			return [{ projectId, sortOrder: index }];
		});

		await Promise.all(
			orderUpdates.map(({ projectId, sortOrder }) =>
				ctx.db.patch(projectId, {
					sortOrder,
				}),
			),
		);

		return null;
	},
});

export const rename = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("projects"),
		name: v.string(),
	},
	returns: projectValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const project = await requireOwnedProject(ctx, args.id, args.workspaceId);
		const name = normalizeProjectName(args.name);
		validateProjectName(name);

		const normalizedName = toNormalizedProjectKey(name);
		if (
			project.name === name &&
			project.normalizedName === normalizedName
		) {
			return withProjectDefaults(project);
		}

		const existing = await ctx.db
			.query("projects")
			.withIndex("by_owner_ws_normalizedName", (q) =>
				q
					.eq("ownerTokenIdentifier", identity.tokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("normalizedName", normalizedName),
			)
			.unique();

		if (existing && existing._id !== project._id) {
			throw new ConvexError({
				code: "PROJECT_ALREADY_EXISTS",
				message: "A project with that name already exists.",
			});
		}

		await ctx.db.patch(project._id, {
			name,
			normalizedName,
			updatedAt: Date.now(),
		});

		const updatedProject = await ctx.db.get(project._id);
		if (!updatedProject) {
			throw new ConvexError({
				code: "PROJECT_NOT_FOUND",
				message: "Project not found.",
			});
		}

		return withProjectDefaults(updatedProject);
	},
});

export const toggleStar = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("projects"),
	},
	returns: v.object({
		isStarred: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const project = await requireOwnedProject(ctx, args.id, args.workspaceId);
		const isStarred = !(project.isStarred ?? false);
		const now = Date.now();

		await ctx.db.patch(project._id, {
			isStarred,
			starredSortOrder: isStarred ? now : project.starredSortOrder,
			updatedAt: now,
		});

		return {
			isStarred,
		};
	},
});

export const moveNotesToTrash = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("projects"),
	},
	returns: v.object({
		movedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const project = await requireOwnedProject(ctx, args.id, args.workspaceId);
		const movedCount = await moveProjectNotesToTrash(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
			project._id,
		);

		return {
			movedCount,
		};
	},
});

export const remove = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("projects"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const project = await requireOwnedProject(ctx, args.id, args.workspaceId);

		await clearProjectNotes(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
			project._id,
		);
		await ctx.db.delete(project._id);

		return null;
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const projects = await ctx.db
			.query("projects")
			.withIndex("by_owner_ws_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(REMOVE_ALL_PROJECTS_BATCH_SIZE);

		await Promise.all(projects.map((project) => ctx.db.delete(project._id)));

		if (projects.length === REMOVE_ALL_PROJECTS_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.projects.removeAllForWorkspace, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteProjectBatchForOwner(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.projects.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});
