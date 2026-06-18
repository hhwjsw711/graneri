import type { Id } from "../../../../../convex/_generated/dataModel";

export type ProjectListSort = "custom" | "name" | "created" | "updated";

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
