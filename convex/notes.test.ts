import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

afterEach(() => {
	vi.useRealTimers();
});

const createWorkspaceAndNote = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { noteId, workspaceId } = await t.run(async (ctx) => {
		const createdAt = 1_000;
		const sharedAt = 2_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt,
			updatedAt: createdAt,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			authorName: "Existing Author",
			isStarred: true,
			starredSortOrder: 0,
			title: "Old title",
			templateSlug: "enhanced",
			content: "old-content",
			searchableText: "old text",
			visibility: "public",
			shareId: "share-1",
			sharedAt,
			isArchived: false,
			archivedAt: undefined,
			createdAt,
			updatedAt: createdAt,
		});

		return { noteId, workspaceId };
	});

	return {
		asOwner,
		noteId,
		t,
		workspaceId,
	};
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

	return {
		asOwner,
		t,
		workspaceId,
	};
};

test("notes.save updates content without dropping existing metadata", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	const savedId = await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Updated title",
		content: "new-content",
		searchableText: "new text",
	});

	expect(savedId).toBe(noteId);

	const note = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(note).not.toBeNull();
	expect(note).toMatchObject({
		_id: noteId,
		workspaceId,
		authorName: "Existing Author",
		isStarred: true,
		title: "Updated title",
		templateSlug: "enhanced",
		content: "new-content",
		searchableText: "new text",
		visibility: "public",
		shareId: "share-1",
		sharedAt: 2_000,
		isArchived: false,
	});
	expect(note?.updatedAt).toBe(Date.now());
});

test("notes.save records version history for changed payloads", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Updated title",
		content: "new-content",
		searchableText: "new text",
	});

	const versions = await asOwner.query(api.notes.listVersions, {
		id: noteId,
		workspaceId,
	});

	expect(versions).toHaveLength(2);
	expect(versions[0]).toMatchObject({
		id: "current",
		isCurrent: true,
		authorName: "Existing Author",
		title: "Updated title",
		content: "new-content",
		searchableText: "new text",
		createdAt: Date.now(),
	});
	expect(versions[1]).toMatchObject({
		isCurrent: false,
		authorName: "Existing Author",
		title: "Old title",
		content: "old-content",
		searchableText: "old text",
		createdAt: Date.now(),
	});
});

test("notes.save groups version history by revision interval", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "First autosave",
		content: "first-content",
		searchableText: "first text",
	});

	vi.setSystemTime(new Date("2026-04-10T18:00:10.000Z"));

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Second autosave",
		content: "second-content",
		searchableText: "second text",
	});

	let versions = await asOwner.query(api.notes.listVersions, {
		id: noteId,
		workspaceId,
	});

	expect(versions).toHaveLength(2);
	expect(versions[1]).toMatchObject({
		title: "Old title",
		content: "old-content",
	});

	vi.setSystemTime(new Date("2026-04-10T18:00:31.000Z"));

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Third autosave",
		content: "third-content",
		searchableText: "third text",
	});

	versions = await asOwner.query(api.notes.listVersions, {
		id: noteId,
		workspaceId,
	});

	expect(versions).toHaveLength(3);
	expect(versions[1]).toMatchObject({
		title: "Second autosave",
		content: "second-content",
	});
});

test("notes.restoreVersion preserves current note and restores selected revision", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Updated title",
		content: "new-content",
		searchableText: "new text",
	});

	const versionsBeforeRestore = await asOwner.query(api.notes.listVersions, {
		id: noteId,
		workspaceId,
	});
	const revisionId = versionsBeforeRestore.find(
		(version) => version.id !== "current",
	)?.id as Id<"noteRevisions"> | undefined;
	expect(revisionId).toBeDefined();

	vi.setSystemTime(new Date("2026-04-10T18:01:00.000Z"));

	await asOwner.mutation(api.notes.restoreVersion, {
		workspaceId,
		id: noteId,
		revisionId: revisionId as Id<"noteRevisions">,
	});

	const note = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});
	expect(note).toMatchObject({
		title: "Old title",
		content: "old-content",
		searchableText: "old text",
	});

	const versionsAfterRestore = await asOwner.query(api.notes.listVersions, {
		id: noteId,
		workspaceId,
	});
	expect(versionsAfterRestore).toHaveLength(3);
	expect(versionsAfterRestore[1]).toMatchObject({
		title: "Updated title",
		content: "new-content",
		searchableText: "new text",
	});
});

test("notes.save is a no-op when the payload is unchanged", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const noteBeforeSave = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(noteBeforeSave).not.toBeNull();

	vi.setSystemTime(new Date("2026-04-10T18:05:00.000Z"));

	const savedId = await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Old title",
		content: "old-content",
		searchableText: "old text",
	});

	expect(savedId).toBe(noteId);

	const noteAfterSave = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(noteAfterSave).not.toBeNull();
	expect(noteAfterSave?.updatedAt).toBe(noteBeforeSave?.updatedAt);
	expect(noteAfterSave).toMatchObject({
		_id: noteId,
		title: "Old title",
		content: "old-content",
		searchableText: "old text",
		templateSlug: "enhanced",
		visibility: "public",
	});

	const versions = await asOwner.query(api.notes.listVersions, {
		id: noteId,
		workspaceId,
	});
	expect(versions).toHaveLength(1);
	expect(versions[0]?.id).toBe("current");
});

test("notes.create and notes.rename preserve empty titles", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: null,
	});
	const createdNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(createdNote).not.toBeNull();
	expect(createdNote?.title).toBe("");

	const renamed = await asOwner.mutation(api.notes.rename, {
		workspaceId,
		id: noteId,
		title: "   ",
	});
	const renamedNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(renamed.title).toBe("");
	expect(renamedNote).not.toBeNull();
	expect(renamedNote?.title).toBe("");
});

test("notes.create can place a note inside a project", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: project._id,
	});
	const createdNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(createdNote).not.toBeNull();
	expect(createdNote?.projectId).toBe(project._id);
	expect(createdNote?.title).toBe("");
});

test("notes.setProject assigns and clears a project without dropping note metadata", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();

	const projectId = await t.run(async (ctx) =>
		ctx.db.insert("projects", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			name: "Product",
			description: "",
			normalizedName: "product",
			isStarred: false,
			sortOrder: 3_000,
			starredSortOrder: 0,
			createdAt: 3_000,
			updatedAt: 3_000,
		}),
	);

	const assigned = await asOwner.mutation(api.notes.setProject, {
		workspaceId,
		id: noteId,
		projectId,
	});
	const assignedNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(assigned.projectId).toBe(projectId);
	expect(assignedNote).not.toBeNull();
	expect(assignedNote).toMatchObject({
		_id: noteId,
		projectId,
		title: "Old title",
		templateSlug: "enhanced",
		visibility: "public",
	});

	const cleared = await asOwner.mutation(api.notes.setProject, {
		workspaceId,
		id: noteId,
		projectId: null,
	});
	const clearedNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(cleared.projectId).toBeNull();
	expect(clearedNote).not.toBeNull();
	expect(clearedNote?.projectId).toBeUndefined();
	expect(clearedNote?.title).toBe("Old title");
});

test("notes.remove deletes note comments and threads", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "old-content",
		body: "This needs follow-up.",
	});

	await asOwner.mutation(api.notes.remove, {
		workspaceId,
		id: noteId,
	});

	const relatedRows = await t.run(async (ctx) => ({
		comments: await ctx.db.query("noteComments").take(10),
		note: await ctx.db.get(noteId),
		threads: await ctx.db.query("noteCommentThreads").take(10),
	}));

	expect(relatedRows.note).toBeNull();
	expect(relatedRows.comments).toHaveLength(0);
	expect(relatedRows.threads).toHaveLength(0);
});
