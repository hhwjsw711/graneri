import { describe, expect, it } from "vitest";
import {
	initialNavProjectsState,
	navProjectsReducer,
} from "@/components/nav/nav-projects-state";
import type { Id } from "../../../convex/_generated/dataModel";

const projectId = (id: string) => id as Id<"projects">;

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
});
