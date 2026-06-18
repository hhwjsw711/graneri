import { describe, expect, it } from "vitest";
import {
	buildProjectEntries,
	initialNavProjectsState,
	navProjectsReducer,
	sortProjectEntries,
	toNormalizedProjectKey,
} from "@/components/nav/nav-projects-state";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const projectId = (id: string) => id as Id<"projects">;
const noteId = (id: string) => id as Id<"notes">;

const createProject = ({
	id,
	creationTime,
	createdAt,
	name,
	sortOrder,
	updatedAt,
}: {
	id: string;
	creationTime: number;
	createdAt: number;
	name: string;
	sortOrder: number;
	updatedAt: number;
}): Doc<"projects"> =>
	({
		_id: projectId(id),
		_creationTime: creationTime,
		createdAt,
		name,
		normalizedName: toNormalizedProjectKey(name),
		sortOrder,
		updatedAt,
		workspaceId: "workspace-1" as Id<"workspaces">,
	}) as Doc<"projects">;

const createNote = ({
	id,
	createdAt,
	projectId: noteProjectId,
	updatedAt,
}: {
	id: string;
	createdAt: number;
	projectId?: Id<"projects">;
	updatedAt: number;
}): Doc<"notes"> =>
	({
		_id: noteId(id),
		_creationTime: createdAt,
		createdAt,
		projectId: noteProjectId,
		updatedAt,
	}) as Doc<"notes">;

describe("nav projects state", () => {
	it("collapses and reopens the current expanded project set", () => {
		const projectOne = projectId("project-1");
		const projectTwo = projectId("project-2");
		const expandedState = {
			...initialNavProjectsState,
			expandedProjectIds: [projectOne, projectTwo],
		};

		const collapsedState = navProjectsReducer(expandedState, {
			type: "collapseExpandedProjects",
		});
		expect(collapsedState.collapsedProjectIds).toEqual([
			projectOne,
			projectTwo,
		]);
		expect(collapsedState.expandedProjectIds).toEqual([]);

		const reopenedState = navProjectsReducer(collapsedState, {
			type: "expandCollapsedProjects",
		});
		expect(reopenedState.collapsedProjectIds).toEqual([]);
		expect(reopenedState.expandedProjectIds).toEqual([projectOne, projectTwo]);
	});

	it("reconciles open project ids against visible projects", () => {
		const projectOne = projectId("project-1");
		const projectTwo = projectId("project-2");
		const state = {
			...initialNavProjectsState,
			collapsedProjectIds: [projectOne, projectTwo],
			expandedProjectIds: [projectTwo],
		};

		expect(
			navProjectsReducer(state, {
				type: "reconcileProjectIds",
				value: [projectOne],
			}),
		).toEqual({
			...state,
			collapsedProjectIds: [projectOne],
			expandedProjectIds: [],
		});
	});

	it("preserves collapsed project history when auto-opening an active project", () => {
		const projectOne = projectId("project-1");
		const state = navProjectsReducer(initialNavProjectsState, {
			type: "setProjectOpen",
			id: projectOne,
			value: true,
			preserveCollapsedProjects: true,
		});

		expect(state.collapsedProjectIds).toEqual([projectOne]);
		expect(state.expandedProjectIds).toEqual([projectOne]);
		expect(
			navProjectsReducer(state, {
				type: "setProjectOpen",
				id: projectOne,
				value: true,
				preserveCollapsedProjects: true,
			}),
		).toBe(state);
	});

	it("resets create form state when closing the create dialog", () => {
		const openState = {
			...initialNavProjectsState,
			createError: "Name is already used.",
			createOpen: true,
			name: "Roadmap",
		};

		expect(
			navProjectsReducer(openState, {
				type: "setCreateOpen",
				value: false,
			}),
		).toEqual({
			...openState,
			createError: null,
			createOpen: false,
			name: "",
		});
	});

	it("builds project entries with grouped notes and latest activity", () => {
		const projectOne = createProject({
			id: "project-1",
			creationTime: 1,
			createdAt: 10,
			name: "Launch",
			sortOrder: 1,
			updatedAt: 20,
		});
		const projectTwo = createProject({
			id: "project-2",
			creationTime: 2,
			createdAt: 30,
			name: "Support",
			sortOrder: 2,
			updatedAt: 40,
		});
		const projectNote = createNote({
			id: "note-1",
			createdAt: 50,
			projectId: projectOne._id,
			updatedAt: 70,
		});

		const entries = buildProjectEntries(
			[projectOne, projectTwo],
			[
				projectNote,
				createNote({
					id: "note-without-project",
					createdAt: 90,
					updatedAt: 100,
				}),
			],
		);

		expect(entries).toEqual([
			{
				project: projectOne,
				notes: [projectNote],
				lastActivityAt: 70,
			},
			{
				project: projectTwo,
				notes: [],
				lastActivityAt: 40,
			},
		]);
	});

	it("sorts project entries by custom order, timestamps, and normalized name", () => {
		const alpha = createProject({
			id: "alpha",
			creationTime: 3,
			createdAt: 10,
			name: "Alpha",
			sortOrder: 2,
			updatedAt: 100,
		});
		const beta = createProject({
			id: "beta",
			creationTime: 2,
			createdAt: 30,
			name: "Beta",
			sortOrder: 1,
			updatedAt: 80,
		});
		const gamma = createProject({
			id: "gamma",
			creationTime: 1,
			createdAt: 30,
			name: "Gamma",
			sortOrder: 1,
			updatedAt: 90,
		});
		const entries = [
			{ project: alpha, notes: [], lastActivityAt: 100 },
			{ project: beta, notes: [], lastActivityAt: 80 },
			{ project: gamma, notes: [], lastActivityAt: 120 },
		];

		expect(
			sortProjectEntries(entries, "custom").map(({ project }) => project._id),
		).toEqual([gamma._id, beta._id, alpha._id]);
		expect(
			sortProjectEntries(entries, "created").map(({ project }) => project._id),
		).toEqual([beta._id, gamma._id, alpha._id]);
		expect(
			sortProjectEntries(entries, "updated").map(({ project }) => project._id),
		).toEqual([gamma._id, alpha._id, beta._id]);
		expect(
			sortProjectEntries(entries, "name").map(({ project }) => project._id),
		).toEqual([alpha._id, beta._id, gamma._id]);
	});

	it("normalizes project names for duplicate checks", () => {
		expect(toNormalizedProjectKey("  Launch   Plan  ")).toBe("launch plan");
	});
});
