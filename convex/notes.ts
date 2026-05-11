import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOwnedProject } from "./projects";

const noteVisibilityValidator = v.union(
	v.literal("private"),
	v.literal("public"),
);

const noteFields = {
	_id: v.id("notes"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	projectId: v.optional(v.id("projects")),
	calendarEventKey: v.optional(v.string()),
	authorName: v.optional(v.string()),
	isStarred: v.optional(v.boolean()),
	title: v.string(),
	templateSlug: v.optional(v.string()),
	content: v.string(),
	searchableText: v.string(),
	visibility: noteVisibilityValidator,
	shareId: v.optional(v.string()),
	sharedAt: v.optional(v.number()),
	isArchived: v.boolean(),
	archivedAt: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const noteValidator = v.object(noteFields);

const sharedNoteValidator = v.object({
	...noteFields,
	isOwner: v.boolean(),
});

const noteChatContextValidator = v.object({
	id: v.id("notes"),
	title: v.string(),
	searchableText: v.string(),
});

const removeAllNotesResultValidator = v.object({
	deletedCount: v.number(),
	hasMore: v.boolean(),
});

const REMOVE_ALL_NOTES_BATCH_SIZE = 100;
const MAX_CHAT_CONTEXT_NOTES = 20;
export const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access notes.",
		});
	}

	return identity;
};

export const getAuthorName = (
	identity: Awaited<ReturnType<typeof requireIdentity>>,
) =>
	identity.name?.trim() || identity.email?.trim() || "Unknown user";

const normalizeNote = (note: Doc<"notes">) => ({
	...note,
	isStarred: note.isStarred ?? false,
	templateSlug: note.templateSlug,
	visibility: note.visibility ?? "private",
});

const requireTokenIdentifier = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await requireIdentity(ctx);

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

export const ensureOwnedNote = ({
	note,
	ownerTokenIdentifier,
	workspaceId,
}: {
	note: Doc<"notes"> | null;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	if (!note) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	if (
		note.ownerTokenIdentifier !== ownerTokenIdentifier ||
		note.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "UNAUTHORIZED",
			message: "You do not have access to this note.",
		});
	}

	return note;
};

export const requireOwnedNote = async (
	ctx: QueryCtx | MutationCtx,
	id: Doc<"notes">["_id"],
	workspaceId: Id<"workspaces">,
) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);

	return ensureOwnedNote({
		note: await ctx.db.get(id),
		ownerTokenIdentifier,
		workspaceId,
	});
};

const createShareId = () => crypto.randomUUID().replaceAll("-", "");

const collectNoteCommentAnchors = (
	value: unknown,
	anchors: Map<string, string>,
): void => {
	if (!value || typeof value !== "object") {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectNoteCommentAnchors(item, anchors);
		}
		return;
	}

	const text =
		"text" in value && typeof value.text === "string" ? value.text : null;
	const marks =
		"marks" in value && Array.isArray(value.marks) ? value.marks : null;

	if (text && marks) {
		for (const mark of marks) {
			if (
				!mark ||
				typeof mark !== "object" ||
				!("type" in mark) ||
				mark.type !== "noteComment" ||
				!("attrs" in mark) ||
				!mark.attrs ||
				typeof mark.attrs !== "object" ||
				!("threadId" in mark.attrs) ||
				typeof mark.attrs.threadId !== "string"
			) {
				continue;
			}

			const threadId = mark.attrs.threadId.trim();
			if (!threadId) {
				continue;
			}

			const currentText = anchors.get(threadId) ?? "";
			anchors.set(threadId, `${currentText}${text}`);
		}
	}

	for (const nested of Object.values(value)) {
		collectNoteCommentAnchors(nested, anchors);
	}
};

const extractNoteCommentAnchors = (content: string) => {
	try {
		const parsed = JSON.parse(content) as unknown;
		const anchors = new Map<string, string>();
		collectNoteCommentAnchors(parsed, anchors);
		return [...anchors.entries()].flatMap(([threadId, excerpt]) => {
			const trimmedExcerpt = excerpt.trim();
			return trimmedExcerpt ? [{ threadId, excerpt: trimmedExcerpt }] : [];
		});
	} catch {
		return null;
	}
};

const deleteNoteBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const notes = await ctx.db
		.query("notes")
		.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_NOTES_BATCH_SIZE);

	await Promise.all(notes.map((note) => ctx.db.delete(note._id)));

	return {
		deletedCount: notes.length,
		hasMore: notes.length === REMOVE_ALL_NOTES_BATCH_SIZE,
	};
};

export const getLatest = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(noteValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const note = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.first();

		return note ? normalizeNote(note) : null;
	},
});

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(100);

		return notes.map(normalizeNote);
	},
});

export const listShared = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_vis_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("visibility", "public")
					.eq("isArchived", false),
			)
			.order("desc")
			.take(100);

		return notes.map(normalizeNote);
	},
});

export const listArchived = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", true),
			)
			.order("desc")
			.take(100);

		return notes.map(normalizeNote);
	},
});

export const get = query({
	args: {
		id: v.id("notes"),
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(noteValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const note = await ctx.db.get(args.id);

		if (
			!note ||
			note.ownerTokenIdentifier !== ownerTokenIdentifier ||
			note.workspaceId !== args.workspaceId ||
			note.isArchived
		) {
			return null;
		}

		return normalizeNote(note);
	},
});

export const normalizeId = query({
	args: {
		id: v.string(),
	},
	returns: v.union(v.id("notes"), v.null()),
	handler: async (ctx, args) => {
		return ctx.db.normalizeId("notes", args.id);
	},
});

export const getChatContext = query({
	args: {
		workspaceId: v.id("workspaces"),
		ids: v.array(v.id("notes")),
	},
	returns: v.array(noteChatContextValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const uniqueIds = [...new Set(args.ids)].slice(0, 20);
		const notes = await Promise.all(uniqueIds.map((id) => ctx.db.get(id)));

		return notes.flatMap((note) => {
			if (
				!note ||
				note.isArchived ||
				note.ownerTokenIdentifier !== ownerTokenIdentifier ||
				note.workspaceId !== args.workspaceId
			) {
				return [];
			}

			return [
				{
					id: note._id,
					title: note.title.trim() || "New note",
					searchableText: note.searchableText.trim(),
				},
			];
		});
	},
});

export const getWorkspaceChatContext = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteChatContextValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(MAX_CHAT_CONTEXT_NOTES);

		return notes.map((note) => ({
			id: note._id,
			title: note.title,
			searchableText: note.searchableText,
		}));
	},
});

export const getShared = query({
	args: {
		shareId: v.string(),
	},
	returns: v.union(sharedNoteValidator, v.null()),
	handler: async (ctx, args) => {
		const note = await ctx.db
			.query("notes")
			.withIndex("by_shareId", (q) => q.eq("shareId", args.shareId))
			.unique();

		if (!note || note.isArchived) {
			return null;
		}

		const normalizedNote = normalizeNote(note);

		const identity = await ctx.auth.getUserIdentity();
		const isOwner =
			identity?.tokenIdentifier === normalizedNote.ownerTokenIdentifier;

		if (normalizedNote.visibility !== "public" && !isOwner) {
			return null;
		}

		return {
			...normalizedNote,
			isOwner,
		};
	},
});

export const create = mutation({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const now = Date.now();

		return await ctx.db.insert("notes", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			projectId: undefined,
			authorName: getAuthorName(identity),
			isStarred: false,
			title: "",
			content: JSON.stringify({
				type: "doc",
				content: [{ type: "paragraph" }],
			}),
			searchableText: "",
			visibility: "private",
			shareId: undefined,
			sharedAt: undefined,
			isArchived: false,
			archivedAt: undefined,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const createFromCalendarEvent = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		calendarEventKey: v.string(),
		title: v.string(),
		content: v.string(),
		searchableText: v.string(),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const authorName = getAuthorName(identity);
		const now = Date.now();
		const calendarEventKey = args.calendarEventKey.trim();

		if (!calendarEventKey) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT",
				message: "Calendar event key is required.",
			});
		}

		const existingNote = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_event_arch", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("calendarEventKey", calendarEventKey)
					.eq("isArchived", false),
			)
			.unique();

		if (existingNote) {
			return existingNote._id;
		}

		return await ctx.db.insert("notes", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			projectId: undefined,
			calendarEventKey,
			authorName,
			isStarred: false,
			title: args.title,
			content: args.content,
			searchableText: args.searchableText,
			visibility: "private",
			shareId: undefined,
			sharedAt: undefined,
			isArchived: false,
			archivedAt: undefined,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const save = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.optional(v.id("notes")),
		title: v.string(),
		content: v.string(),
		searchableText: v.string(),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const authorName = getAuthorName(identity);
		const now = Date.now();

		if (args.id) {
			const existing = ensureOwnedNote({
				note: await ctx.db.get(args.id),
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});

			if (
				existing.title === args.title &&
				existing.content === args.content &&
				existing.searchableText === args.searchableText &&
				!existing.isArchived
			) {
				return args.id;
			}

			await ctx.db.patch(args.id, {
				authorName: existing.authorName ?? authorName,
				isStarred: existing.isStarred ?? false,
				projectId: existing.projectId,
				title: args.title,
				content: args.content,
				searchableText: args.searchableText,
				visibility: existing.visibility ?? "private",
				templateSlug: existing.templateSlug,
				shareId: existing.shareId,
				sharedAt: existing.sharedAt,
				isArchived: false,
				archivedAt: undefined,
				updatedAt: now,
			});

			const anchors = extractNoteCommentAnchors(args.content);
			if (anchors) {
				const normalizedAnchors = (
					await Promise.all(
						anchors.map(async ({ threadId, excerpt }) => ({
							threadId: await ctx.db.normalizeId("noteCommentThreads", threadId),
							excerpt,
						})),
					)
				).flatMap(({ threadId, excerpt }) =>
					threadId ? [{ threadId, excerpt }] : [],
				);

				await ctx.runMutation(internal.noteComments.syncAnchorsForNote, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					noteId: args.id,
					activeAnchors: normalizedAnchors,
				});
			}

			return args.id;
		}

		return await ctx.db.insert("notes", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			projectId: undefined,
			authorName,
			isStarred: false,
			title: args.title,
			content: args.content,
			searchableText: args.searchableText,
			visibility: "private",
			shareId: undefined,
			sharedAt: undefined,
			isArchived: false,
			archivedAt: undefined,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const setProject = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		projectId: v.union(v.id("projects"), v.null()),
	},
	returns: v.object({
		projectId: v.union(v.id("projects"), v.null()),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		if (args.projectId) {
			await requireOwnedProject(ctx, args.projectId, args.workspaceId);
		}

		const nextProjectId = args.projectId ?? undefined;
		if (note.projectId === nextProjectId) {
			return {
				projectId: args.projectId,
			};
		}

		await ctx.db.patch(args.id, {
			projectId: nextProjectId,
			updatedAt: Date.now(),
		});

		return {
			projectId: args.projectId,
		};
	},
});

export const setTemplate = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		templateSlug: v.union(v.string(), v.null()),
	},
	returns: v.object({
		templateSlug: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		await ctx.db.patch(args.id, {
			templateSlug: args.templateSlug ?? undefined,
		});

		return {
			templateSlug: args.templateSlug,
		};
	},
});

export const rename = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		title: v.string(),
	},
	returns: v.object({
		title: v.string(),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const title = args.title.trim();

		await ctx.db.patch(args.id, {
			title,
			updatedAt: Date.now(),
		});

		return { title };
	},
});

export const toggleStar = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.object({
		isStarred: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const isStarred = !(note.isStarred ?? false);

		await ctx.db.patch(args.id, {
			isStarred,
			updatedAt: Date.now(),
		});

		return {
			isStarred,
		};
	},
});

export const updateVisibility = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		visibility: noteVisibilityValidator,
	},
	returns: v.object({
		visibility: noteVisibilityValidator,
		shareId: v.optional(v.string()),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const shareId =
			args.visibility === "public"
				? (note.shareId ?? createShareId())
				: note.shareId;

		await ctx.db.patch(args.id, {
			visibility: args.visibility,
			shareId,
			sharedAt: args.visibility === "public" ? Date.now() : note.sharedAt,
			updatedAt: Date.now(),
		});

		return {
			visibility: args.visibility,
			shareId,
		};
	},
});

export const ensureShareId = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.object({
		shareId: v.string(),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const shareId = note.shareId ?? createShareId();

		if (!note.shareId) {
			await ctx.db.patch(args.id, {
				shareId,
				updatedAt: Date.now(),
			});
		}

		return { shareId };
	},
});

export const moveToTrash = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		await ctx.db.patch(args.id, {
			isArchived: true,
			archivedAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.runMutation(internal.chats.archiveForNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.id,
		});

		return null;
	},
});

export const restore = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		await ctx.db.patch(args.id, {
			isArchived: false,
			archivedAt: undefined,
			updatedAt: Date.now(),
		});
		await ctx.runMutation(internal.chats.restoreForNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.id,
		});

		return null;
	},
});

export const remove = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);
		await ctx.runMutation(internal.chats.removeForNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.id,
		});
		await ctx.scheduler.runAfter(0, internal.transcriptSessions.removeForNote, {
			noteId: args.id,
			ownerTokenIdentifier: note.ownerTokenIdentifier,
		});
		await ctx.db.delete(args.id);

		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteNoteBatch(ctx, args.ownerTokenIdentifier);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.notes.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		} else {
			await ctx.scheduler.runAfter(
				0,
				internal.transcriptSessions.removeAllForOwner,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
				},
			);
		}

		return null;
	},
});

export const removeAll = mutation({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: removeAllNotesResultValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(REMOVE_ALL_NOTES_BATCH_SIZE);

		await Promise.all(
			notes.map(async (note) => {
				await ctx.runMutation(internal.chats.removeForNote, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					noteId: note._id,
				});
				await ctx.scheduler.runAfter(
					0,
					internal.transcriptSessions.removeForNote,
					{
						noteId: note._id,
						ownerTokenIdentifier: note.ownerTokenIdentifier,
					},
				);
				await ctx.db.delete(note._id);
			}),
		);

		if (notes.length === REMOVE_ALL_NOTES_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.notes.removeAllForWorkspace, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return {
			deletedCount: notes.length,
			hasMore: notes.length === REMOVE_ALL_NOTES_BATCH_SIZE,
		};
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(REMOVE_ALL_NOTES_BATCH_SIZE);

		await Promise.all(
			notes.map(async (note) => {
				await ctx.runMutation(internal.chats.removeForNote, {
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					noteId: note._id,
				});
				await ctx.scheduler.runAfter(
					0,
					internal.transcriptSessions.removeForNote,
					{
						noteId: note._id,
						ownerTokenIdentifier: note.ownerTokenIdentifier,
					},
				);
				await ctx.db.delete(note._id);
			}),
		);

		if (notes.length === REMOVE_ALL_NOTES_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.notes.removeAllForWorkspace, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return null;
	},
});
