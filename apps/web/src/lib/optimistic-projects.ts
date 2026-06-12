import type { OptimisticLocalStore } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type WorkspaceId = Id<"workspaces">;
type ProjectListItem = Doc<"projects"> & { isStarred: boolean };

const sortProjectsBySortOrder = (projects: ProjectListItem[]) =>
	[...projects].sort((leftProject, rightProject) => {
		if (leftProject.sortOrder !== rightProject.sortOrder) {
			return leftProject.sortOrder - rightProject.sortOrder;
		}

		const normalizedNameComparison = leftProject.normalizedName.localeCompare(
			rightProject.normalizedName,
		);
		if (normalizedNameComparison !== 0) {
			return normalizedNameComparison;
		}

		return leftProject._creationTime - rightProject._creationTime;
	});

export const optimisticUpdateProjectList = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	updateProjects: (projects: ProjectListItem[]) => ProjectListItem[],
) => {
	const projects = localStore.getQuery(api.projects.list, { workspaceId });
	if (projects === undefined) {
		return;
	}

	localStore.setQuery(
		api.projects.list,
		{ workspaceId },
		sortProjectsBySortOrder(updateProjects(projects)),
	);
};
