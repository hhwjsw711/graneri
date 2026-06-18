import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

export type ProjectListSort = "custom" | "name" | "created" | "updated";

export type ProjectWithNotes = {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">>;
	lastActivityAt: number;
};

export type NavProjectsState = {
	collapsedProjectIds: Array<Id<"projects">>;
	createError: string | null;
	createOpen: boolean;
	expandedProjectIds: Array<Id<"projects">>;
	filtersOpen: boolean;
	name: string;
	sortBy: ProjectListSort;
};

export type NavProjectsAction =
	| { type: "collapseExpandedProjects" }
	| { type: "expandCollapsedProjects" }
	| { type: "reconcileProjectIds"; value: Array<Id<"projects">> }
	| { type: "setCreateError"; value: string | null }
	| { type: "setCreateOpen"; value: boolean }
	| {
			type: "setProjectOpen";
			id: Id<"projects">;
			value: boolean;
			preserveCollapsedProjects?: boolean;
	  }
	| { type: "setFiltersOpen"; value: boolean }
	| { type: "setName"; value: string }
	| { type: "setSortBy"; value: ProjectListSort };

export const initialNavProjectsState: NavProjectsState = {
	collapsedProjectIds: [],
	createError: null,
	createOpen: false,
	expandedProjectIds: [],
	filtersOpen: false,
	name: "",
	sortBy: "custom",
};

export function navProjectsReducer(
	state: NavProjectsState,
	action: NavProjectsAction,
): NavProjectsState {
	switch (action.type) {
		case "collapseExpandedProjects":
			return {
				...state,
				collapsedProjectIds: state.expandedProjectIds,
				expandedProjectIds: [],
			};
		case "expandCollapsedProjects":
			return {
				...state,
				collapsedProjectIds: [],
				expandedProjectIds: [
					...new Set([
						...state.collapsedProjectIds,
						...state.expandedProjectIds,
					]),
				],
			};
		case "reconcileProjectIds": {
			const visibleIds = new Set(action.value);
			return {
				...state,
				collapsedProjectIds: state.collapsedProjectIds.filter((id) =>
					visibleIds.has(id),
				),
				expandedProjectIds: state.expandedProjectIds.filter((id) =>
					visibleIds.has(id),
				),
			};
		}
		case "setCreateError":
			return {
				...state,
				createError: action.value,
			};
		case "setCreateOpen":
			return action.value
				? {
						...state,
						createOpen: true,
					}
				: {
						...state,
						createError: null,
						createOpen: false,
						name: "",
					};
		case "setProjectOpen": {
			const isAlreadyExpanded = state.expandedProjectIds.includes(action.id);
			if (isAlreadyExpanded === action.value) {
				return state;
			}
			const hasCollapsedProjectIds = state.collapsedProjectIds.length > 0;

			return {
				...state,
				collapsedProjectIds:
					action.preserveCollapsedProjects || hasCollapsedProjectIds
						? action.value
							? [...new Set([...state.collapsedProjectIds, action.id])]
							: state.collapsedProjectIds.filter((id) => id !== action.id)
						: state.collapsedProjectIds,
				expandedProjectIds: action.value
					? [...state.expandedProjectIds, action.id]
					: state.expandedProjectIds.filter((id) => id !== action.id),
			};
		}
		case "setFiltersOpen":
			return {
				...state,
				filtersOpen: action.value,
			};
		case "setName":
			return {
				...state,
				name: action.value,
			};
		case "setSortBy":
			return {
				...state,
				sortBy: action.value,
			};
		default:
			return state;
	}
}

export function buildProjectEntries(
	projects: Array<Doc<"projects">>,
	notes: Array<Doc<"notes">>,
): Array<ProjectWithNotes> {
	const notesByProjectId = new Map<Id<"projects">, Array<Doc<"notes">>>();

	for (const note of notes) {
		if (!note.projectId) {
			continue;
		}

		const projectNotes = notesByProjectId.get(note.projectId) ?? [];
		projectNotes.push(note);
		notesByProjectId.set(note.projectId, projectNotes);
	}

	return projects.map((project) => {
		const projectNotes = notesByProjectId.get(project._id) ?? [];

		return {
			project,
			notes: projectNotes,
			lastActivityAt: projectNotes.reduce(
				(latestTimestamp, note) =>
					Math.max(latestTimestamp, note.createdAt, note.updatedAt),
				Math.max(project.createdAt, project.updatedAt),
			),
		};
	});
}

export const normalizeProjectName = (value: string) =>
	value.replace(/\s+/g, " ").trim();

export const toNormalizedProjectKey = (value: string) =>
	normalizeProjectName(value).toLowerCase();

export function sortProjectEntries(
	entries: Array<ProjectWithNotes>,
	sortBy: ProjectListSort,
) {
	return entries.slice().sort((left, right) => {
		if (sortBy === "custom") {
			if (left.project.sortOrder !== right.project.sortOrder) {
				return left.project.sortOrder - right.project.sortOrder;
			}

			return left.project._creationTime - right.project._creationTime;
		}

		if (sortBy === "created") {
			return compareProjectsByTimestamp(
				left.project.createdAt,
				right.project.createdAt,
				left.project,
				right.project,
			);
		}

		if (sortBy === "updated") {
			return compareProjectsByTimestamp(
				left.lastActivityAt,
				right.lastActivityAt,
				left.project,
				right.project,
			);
		}

		return compareProjectsByName(left.project, right.project);
	});
}

function compareProjectsByTimestamp(
	leftTimestamp: number,
	rightTimestamp: number,
	leftProject: Doc<"projects">,
	rightProject: Doc<"projects">,
) {
	if (rightTimestamp !== leftTimestamp) {
		return rightTimestamp - leftTimestamp;
	}

	return compareProjectsByName(leftProject, rightProject);
}

function compareProjectsByName(
	leftProject: Doc<"projects">,
	rightProject: Doc<"projects">,
) {
	const normalizedComparison = leftProject.normalizedName.localeCompare(
		rightProject.normalizedName,
	);
	if (normalizedComparison !== 0) {
		return normalizedComparison;
	}

	return leftProject._creationTime - rightProject._creationTime;
}
