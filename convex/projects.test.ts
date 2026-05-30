import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
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
		workspaceId,
	};
};

test("projects.create trims names and projects.list keeps custom order", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const zebraId = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "  Zebra  ",
	});
	const alphaId = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Alpha",
	});

	expect(zebraId.name).toBe("Zebra");
	expect(alphaId.name).toBe("Alpha");

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});

	expect(projects.map((project) => project.name)).toEqual(["Zebra", "Alpha"]);
});

test("projects.reorder persists the custom project order", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const product = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});
	const research = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});
	const sales = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Sales",
	});

	await asOwner.mutation(api.projects.reorder, {
		workspaceId,
		projectIds: [sales._id, product._id, research._id],
	});

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});

	expect(projects.map((project) => project.name)).toEqual([
		"Sales",
		"Product",
		"Research",
	]);
	expect(projects.map((project) => project.sortOrder)).toEqual([0, 1, 2]);
});

test("projects.reorder rejects oversized project lists instead of partially reordering", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const projectIds = await asOwner.run(async (ctx) => {
		const ids = [];
		for (let index = 0; index < 101; index += 1) {
			ids.push(
				await ctx.db.insert("projects", {
					ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
					workspaceId,
					name: `Project ${index}`,
					normalizedName: `project ${index}`,
					isStarred: false,
					sortOrder: index,
					starredSortOrder: index,
					createdAt: index,
					updatedAt: index,
				}),
			);
		}
		return ids;
	});

	await expect(
		asOwner
			.mutation(api.projects.reorder, {
				workspaceId,
				projectIds: projectIds.slice(0, 100),
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"PROJECT_ORDER_TOO_LARGE",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.create rejects duplicate names in the same workspace", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	await expect(
		asOwner
			.mutation(api.projects.create, {
				workspaceId,
				name: "  product  ",
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"PROJECT_ALREADY_EXISTS",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.rename updates the project and preserves workspace uniqueness", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});
	await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});

	const renamed = await asOwner.mutation(api.projects.rename, {
		workspaceId,
		id: project._id,
		name: "  Founding Team  ",
	});

	expect(renamed.name).toBe("Founding Team");

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});
	expect(projects.map((entry) => entry.name)).toEqual([
		"Founding Team",
		"Research",
	]);

	await expect(
		asOwner
			.mutation(api.projects.rename, {
				workspaceId,
				id: project._id,
				name: "research",
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"PROJECT_ALREADY_EXISTS",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.toggleStar marks and unmarks a project", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	const firstToggle = await asOwner.mutation(api.projects.toggleStar, {
		workspaceId,
		id: project._id,
	});
	expect(firstToggle.isStarred).toBe(true);

	const starredProject = await asOwner.run(async (ctx) =>
		ctx.db.get(project._id),
	);
	expect(starredProject?.isStarred).toBe(true);

	const secondToggle = await asOwner.mutation(api.projects.toggleStar, {
		workspaceId,
		id: project._id,
	});
	expect(secondToggle.isStarred).toBe(false);

	const unstarredProject = await asOwner.run(async (ctx) =>
		ctx.db.get(project._id),
	);
	expect(unstarredProject?.isStarred).toBe(false);
});

test("projects.moveNotesToTrash archives active project notes and keeps the project", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	const { activeNoteId, archivedNoteId } = await asOwner.run(async (ctx) => {
		const activeNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Active note",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const archivedNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Archived note",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: true,
			archivedAt: 2_000,
			createdAt: 1_000,
			updatedAt: 1_000,
		});

		return { activeNoteId, archivedNoteId };
	});

	const result = await asOwner.mutation(api.projects.moveNotesToTrash, {
		workspaceId,
		id: project._id,
	});
	expect(result.movedCount).toBe(1);

	const projects = await asOwner.query(api.projects.list, { workspaceId });
	expect(projects).toHaveLength(1);

	const activeNote = await asOwner.run(async (ctx) => ctx.db.get(activeNoteId));
	const archivedNote = await asOwner.run(async (ctx) =>
		ctx.db.get(archivedNoteId),
	);

	expect(activeNote?.isArchived).toBe(true);
	expect(activeNote?.projectId).toBe(project._id);
	expect(archivedNote?.isArchived).toBe(true);
	expect(archivedNote?.projectId).toBe(project._id);
});

test("projects.remove deletes the project and clears it from assigned notes", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Flomni",
	});

	const { noteId, archivedNoteId } = await asOwner.run(async (ctx) => {
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Current note",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const archivedNoteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Archived note",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: true,
			archivedAt: 2_000,
			createdAt: 1_000,
			updatedAt: 1_000,
		});

		return { noteId, archivedNoteId };
	});

	await asOwner.mutation(api.projects.remove, {
		workspaceId,
		id: project._id,
	});

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});
	expect(projects).toHaveLength(0);

	const currentNote = await asOwner.run(async (ctx) => ctx.db.get(noteId));
	const archivedNote = await asOwner.run(async (ctx) =>
		ctx.db.get(archivedNoteId),
	);

	expect(currentNote?.projectId).toBeUndefined();
	expect(archivedNote?.projectId).toBeUndefined();
});
