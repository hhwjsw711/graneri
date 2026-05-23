import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
} from "@workspace/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Icons } from "@workspace/ui/components/icons";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@workspace/ui/components/popover";
import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import {
	Archive,
	ArrowUpAZ,
	Check,
	ChevronRight,
	ChevronsDown,
	ChevronsUp,
	Clock3,
	FileText,
	Folder,
	FolderOpen,
	LoaderCircle,
	MoreHorizontal,
	Pencil,
	Plus,
	PlusCircle,
	Star,
	StarOff,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { NoteTitleEditInput } from "@/components/note/note-title-edit-input";
import { ProjectComposer } from "@/components/projects/project-composer";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { archiveNoteChats } from "@/lib/optimistic-note-chats";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import {
	SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME,
	SidebarCollapsibleGroup,
} from "./sidebar-collapsible-group";

const SIDEBAR_PROJECT_SKELETON_IDS = [
	"sidebar-project-skeleton-1",
	"sidebar-project-skeleton-2",
] as const;
const MAX_VISIBLE_PROJECT_NOTES = 5;
const MAX_PROJECT_NAME_LENGTH = 48;
const SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME =
	"aspect-auto w-auto gap-0.5 rounded-xl p-0 hover:bg-transparent [&_button]:flex [&_button]:size-5 [&_button]:cursor-pointer [&_button]:items-center [&_button]:justify-center [&_button]:rounded-md [&_button]:p-0 [&_button]:text-inherit [&_button]:outline-hidden [&_button]:transition-colors [&_button:hover]:bg-sidebar-accent [&_button:hover]:text-sidebar-accent-foreground [&_button[data-state=open]]:bg-sidebar-accent [&_button[data-state=open]]:text-sidebar-accent-foreground [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-sidebar-ring [&_button>svg]:size-4 [&_button>svg]:shrink-0";
const SIDEBAR_FILTER_MENU_CONTENT_CLASS_NAME =
	"w-56 overflow-hidden rounded-lg p-1";
const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

type ProjectWithNotes = {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">>;
	lastActivityAt: number;
};

type ProjectListSort = "name" | "created" | "updated";

type NavProjectsState = {
	collapsedProjectIds: Array<Id<"projects">>;
	createError: string | null;
	createOpen: boolean;
	expandedProjectIds: Array<Id<"projects">>;
	filtersOpen: boolean;
	name: string;
	sortBy: ProjectListSort;
};

type NavProjectsAction =
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

const initialNavProjectsState: NavProjectsState = {
	collapsedProjectIds: [],
	createError: null,
	createOpen: false,
	expandedProjectIds: [],
	filtersOpen: false,
	name: "",
	sortBy: "name",
};

function navProjectsReducer(
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

type ProjectItemState = {
	confirmOpen: boolean;
	menuOpen: boolean;
	moveNotesConfirmOpen: boolean;
	renameOpen: boolean;
	renameValue: string;
};

type ProjectItemAction =
	| { type: "setConfirmOpen"; value: boolean }
	| { type: "setMenuOpen"; value: boolean }
	| { type: "setMoveNotesConfirmOpen"; value: boolean }
	| { type: "setRenameOpen"; value: boolean }
	| { type: "setRenameValue"; value: string }
	| { type: "openRename"; value: string }
	| { type: "closeRename"; value: string };

const createProjectItemState = (projectName: string): ProjectItemState => ({
	confirmOpen: false,
	menuOpen: false,
	moveNotesConfirmOpen: false,
	renameOpen: false,
	renameValue: projectName,
});

function projectItemReducer(
	state: ProjectItemState,
	action: ProjectItemAction,
): ProjectItemState {
	switch (action.type) {
		case "setConfirmOpen":
			return {
				...state,
				confirmOpen: action.value,
			};
		case "setMenuOpen":
			return {
				...state,
				menuOpen: action.value,
			};
		case "setMoveNotesConfirmOpen":
			return {
				...state,
				moveNotesConfirmOpen: action.value,
			};
		case "setRenameOpen":
			return {
				...state,
				renameOpen: action.value,
			};
		case "setRenameValue":
			return {
				...state,
				renameValue: action.value,
			};
		case "openRename":
			return {
				...state,
				menuOpen: false,
				renameOpen: true,
				renameValue: action.value,
			};
		case "closeRename":
			return {
				...state,
				renameOpen: false,
				renameValue: action.value,
			};
		default:
			return state;
	}
}

export function NavProjects({
	projects,
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId = null,
	autoRevealActiveNoteProject = true,
	workspaceId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	projects: Array<Doc<"projects">> | undefined;
	notes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId?: Id<"notes"> | null;
	autoRevealActiveNoteProject?: boolean;
	workspaceId: Id<"workspaces"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const [state, dispatch] = React.useReducer(
		navProjectsReducer,
		initialNavProjectsState,
	);
	const {
		collapsedProjectIds,
		createError,
		createOpen,
		expandedProjectIds,
		filtersOpen,
		name,
		sortBy,
	} = state;
	const [isCreatingProject, startProjectCreation] = React.useTransition();
	const createProject = useMutation(api.projects.create);
	const projectEntries = React.useMemo(
		() => buildProjectEntries(projects ?? [], notes ?? []),
		[notes, projects],
	);
	const visibleProjectEntries = React.useMemo(
		() => sortProjectEntries(projectEntries, sortBy),
		[projectEntries, sortBy],
	);
	const visibleProjectIds = React.useMemo(
		() => visibleProjectEntries.map(({ project }) => project._id),
		[visibleProjectEntries],
	);
	const expandedProjectIdSet = React.useMemo(
		() => new Set(expandedProjectIds),
		[expandedProjectIds],
	);
	const projectTreeToggleTargetCount = React.useMemo(
		() => new Set([...collapsedProjectIds, ...expandedProjectIds]).size,
		[collapsedProjectIds, expandedProjectIds],
	);
	const expandedProjectCount = expandedProjectIds.length;
	const showProjectTreeToggle = projectTreeToggleTargetCount > 1;
	const isProjectTreeCollapsed =
		projectTreeToggleTargetCount > 1 &&
		expandedProjectCount < projectTreeToggleTargetCount;
	const isPending = projects === undefined || notes === undefined;

	React.useEffect(() => {
		dispatch({ type: "reconcileProjectIds", value: visibleProjectIds });
	}, [visibleProjectIds]);

	React.useEffect(() => {
		if (!currentNoteId || !autoRevealActiveNoteProject) {
			return;
		}

		const activeProject = visibleProjectEntries.find(({ notes }) =>
			notes.some((note) => note._id === currentNoteId),
		);
		if (!activeProject) {
			return;
		}

		dispatch({
			type: "setProjectOpen",
			id: activeProject.project._id,
			value: true,
			preserveCollapsedProjects: true,
		});
	}, [autoRevealActiveNoteProject, currentNoteId, visibleProjectEntries]);

	const handleCreateProject = React.useCallback(() => {
		if (!workspaceId) {
			return;
		}

		startProjectCreation(async () => {
			try {
				dispatch({ type: "setCreateError", value: null });
				await createProject({
					workspaceId,
					name,
				});
				dispatch({ type: "setCreateOpen", value: false });
			} catch (error) {
				dispatch({
					type: "setCreateError",
					value:
						error instanceof Error
							? error.message
							: "Failed to create project.",
				});
			}
		});
	}, [createProject, name, workspaceId]);

	return (
		<>
			<SidebarCollapsibleGroup
				title="Projects"
				className="group-data-[collapsible=icon]:hidden"
				actionClassName={`${SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME} ${SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME}`}
				actions={
					<div className="flex items-center gap-0.5">
						{showProjectTreeToggle ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={
											isProjectTreeCollapsed
												? "Reopen previous"
												: "Collapse all"
										}
										onClick={() =>
											dispatch({
												type: isProjectTreeCollapsed
													? "expandCollapsedProjects"
													: "collapseExpandedProjects",
											})
										}
									>
										{isProjectTreeCollapsed ? <ChevronsDown /> : <ChevronsUp />}
									</button>
								</TooltipTrigger>
								<TooltipContent
									side="bottom"
									align="center"
									sideOffset={8}
									className="pointer-events-none select-none"
								>
									{isProjectTreeCollapsed ? "Reopen previous" : "Collapse all"}
								</TooltipContent>
							</Tooltip>
						) : null}
						<ProjectsFilterMenu
							open={filtersOpen}
							sortBy={sortBy}
							onOpenChange={(open) =>
								dispatch({ type: "setFiltersOpen", value: open })
							}
							onSortChange={(value) => dispatch({ type: "setSortBy", value })}
						/>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label="Add project"
									onClick={() =>
										dispatch({ type: "setCreateOpen", value: true })
									}
								>
									<Plus />
								</button>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								align="center"
								sideOffset={8}
								className="pointer-events-none select-none"
							>
								Add project
							</TooltipContent>
						</Tooltip>
					</div>
				}
			>
				{isPending ? <NavProjectsSkeleton /> : null}
				{!isPending && visibleProjectEntries.length === 0 ? (
					<div className="px-2 text-xs text-muted-foreground/50">
						No projects yet
					</div>
				) : null}
				{isPending ? null : (
					<SidebarMenu>
						{visibleProjectEntries.map(({ project, notes: projectNotes }) => (
							<ProjectSidebarItem
								key={project._id}
								project={project}
								notes={projectNotes}
								open={expandedProjectIdSet.has(project._id)}
								workspaceId={workspaceId}
								currentNoteId={currentNoteId}
								currentNoteTitle={currentNoteTitle}
								recordingNoteId={recordingNoteId}
								onPrefetchNote={onPrefetchNote}
								onNoteSelect={onNoteSelect}
								onNoteTitleChange={onNoteTitleChange}
								onNoteTrashed={onNoteTrashed}
								onOpenChange={(open) =>
									dispatch({
										type: "setProjectOpen",
										id: project._id,
										value: open,
									})
								}
							/>
						))}
					</SidebarMenu>
				)}
			</SidebarCollapsibleGroup>
			<Dialog
				open={createOpen}
				onOpenChange={(open) =>
					dispatch({ type: "setCreateOpen", value: open })
				}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create a project</DialogTitle>
						<DialogDescription>
							Projects group notes in the sidebar without changing what a note
							is.
						</DialogDescription>
					</DialogHeader>
					<ProjectComposer
						name={name}
						onNameChange={(value) => dispatch({ type: "setName", value })}
						error={createError}
						nameInputId="project-dialog-name"
					/>
					<div className="flex items-center justify-end gap-2">
						<Button
							variant="ghost"
							onClick={() => dispatch({ type: "setCreateOpen", value: false })}
						>
							Cancel
						</Button>
						<Button
							onClick={handleCreateProject}
							disabled={isCreatingProject || name.trim().length < 1}
						>
							{isCreatingProject ? (
								<LoaderCircle
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : null}
							Create project
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

function ProjectsFilterMenu({
	open,
	sortBy,
	onOpenChange,
	onSortChange,
}: {
	open: boolean;
	sortBy: ProjectListSort;
	onOpenChange: (open: boolean) => void;
	onSortChange: (value: ProjectListSort) => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label="Sort projects"
							className="text-sidebar-foreground/55 hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground data-[state=open]:text-sidebar-accent-foreground"
						>
							<MoreHorizontal />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					align="center"
					sideOffset={8}
					className="pointer-events-none select-none"
				>
					Sort projects
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align="start"
				side="right"
				sideOffset={6}
				className={SIDEBAR_FILTER_MENU_CONTENT_CLASS_NAME}
			>
				<ProjectFilterItem
					icon={ArrowUpAZ}
					label="Name"
					selected={sortBy === "name"}
					onSelect={() => onSortChange("name")}
				/>
				<ProjectFilterItem
					icon={PlusCircle}
					label="Created"
					selected={sortBy === "created"}
					onSelect={() => onSortChange("created")}
				/>
				<ProjectFilterItem
					icon={Clock3}
					label="Updated"
					selected={sortBy === "updated"}
					onSelect={() => onSortChange("updated")}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProjectFilterItem({
	icon: Icon,
	label,
	selected,
	onSelect,
}: {
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
	label: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<DropdownMenuItem
			className="cursor-pointer justify-between"
			onSelect={onSelect}
		>
			<div className="flex items-center gap-2">
				<Icon />
				<span>{label}</span>
			</div>
			{selected ? <Check /> : null}
		</DropdownMenuItem>
	);
}

export function ProjectSidebarItem({
	project,
	notes,
	open,
	workspaceId,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onOpenChange,
}: {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">>;
	open: boolean;
	workspaceId: Id<"workspaces"> | null;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const hasNotes = notes.length > 0;
	const [state, dispatch] = React.useReducer(
		projectItemReducer,
		project.name,
		createProjectItemState,
	);
	const renameInputRef = React.useRef<HTMLInputElement>(null);
	const preventMenuCloseAutoFocusRef = React.useRef(false);
	const ignoreInitialRenameInteractOutsideRef = React.useRef(false);
	const [isRenaming, setIsRenaming] = React.useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const [isRemoving, setIsRemoving] = React.useState(false);
	const [isMovingNotesToTrash, setIsMovingNotesToTrash] = React.useState(false);
	const isUpdatingStarRef = React.useRef(false);
	const renameValue = state.renameOpen ? state.renameValue : project.name;
	const renameProject = useMutation(api.projects.rename).withOptimisticUpdate(
		(localStore, args) => {
			optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
				projects.map((entry) =>
					entry._id === args.id
						? {
								...entry,
								name: normalizeProjectName(args.name),
								normalizedName: toNormalizedProjectKey(args.name),
							}
						: entry,
				),
			);
		},
	);
	const removeProject = useMutation(api.projects.remove).withOptimisticUpdate(
		(localStore, args) => {
			optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
				projects.filter((entry) => entry._id !== args.id),
			);
			optimisticClearProjectFromNotes(localStore, args.workspaceId, args.id);
		},
	);
	const toggleProjectStar = useMutation(
		api.projects.toggleStar,
	).withOptimisticUpdate((localStore, args) => {
		optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
			projects.map((entry) =>
				entry._id === args.id
					? {
							...entry,
							isStarred: !entry.isStarred,
							updatedAt: Date.now(),
						}
					: entry,
			),
		);
	});
	const moveProjectNotesToTrash = useMutation(
		api.projects.moveNotesToTrash,
	).withOptimisticUpdate((localStore, args) => {
		optimisticMoveProjectNotesToTrash(localStore, args.workspaceId, args.id);
	});

	const handleRename = React.useCallback(async () => {
		if (!workspaceId || isRenaming) {
			return;
		}

		const nextName = normalizeProjectName(renameValue);
		if (nextName.length < 1) {
			toast.error("Project name is required");
			return;
		}

		if (nextName.length > MAX_PROJECT_NAME_LENGTH) {
			toast.error(
				`Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`,
			);
			return;
		}

		if (nextName === project.name) {
			dispatch({ type: "closeRename", value: nextName });
			return;
		}

		setIsRenaming(true);

		try {
			await renameProject({
				workspaceId,
				id: project._id,
				name: nextName,
			});
			dispatch({ type: "closeRename", value: nextName });
			toast.success("Project renamed");
		} catch (error) {
			console.error("Failed to rename project", error);
			toast.error("Failed to rename project");
		} finally {
			setIsRenaming(false);
		}
	}, [
		isRenaming,
		project._id,
		project.name,
		renameProject,
		renameValue,
		workspaceId,
	]);

	const handleRenameOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				dispatch({ type: "setRenameOpen", value: true });
				return;
			}

			void handleRename();
		},
		[handleRename],
	);

	const handleRenameCancel = React.useCallback(() => {
		dispatch({ type: "closeRename", value: project.name });
	}, [project.name]);

	const handleStartRename = React.useCallback(() => {
		preventMenuCloseAutoFocusRef.current = true;
		ignoreInitialRenameInteractOutsideRef.current = true;
		dispatch({ type: "openRename", value: project.name });
	}, [project.name]);

	const handleToggleStar = React.useCallback(async () => {
		if (!workspaceId || isUpdatingStarRef.current) {
			return;
		}

		isUpdatingStarRef.current = true;

		try {
			const result = await toggleProjectStar({
				workspaceId,
				id: project._id,
			});
			toast.success(result.isStarred ? "Project starred" : "Project unstarred");
		} catch (error) {
			console.error("Failed to update project star", error);
			toast.error("Failed to update project");
		} finally {
			isUpdatingStarRef.current = false;
		}
	}, [project._id, toggleProjectStar, workspaceId]);

	const handleDeleteProject = React.useCallback(async () => {
		if (!workspaceId || isRemoving) {
			return;
		}

		setIsRemoving(true);

		try {
			await removeProject({
				workspaceId,
				id: project._id,
			});
			dispatch({ type: "setConfirmOpen", value: false });
			toast.success("Project deleted");
		} catch (error) {
			console.error("Failed to delete project", error);
			toast.error("Failed to delete project");
		} finally {
			setIsRemoving(false);
		}
	}, [isRemoving, project._id, removeProject, workspaceId]);

	const handleMoveNotesToTrash = React.useCallback(async () => {
		if (!workspaceId || isMovingNotesToTrash) {
			return;
		}

		setIsMovingNotesToTrash(true);

		try {
			const result = await moveProjectNotesToTrash({
				workspaceId,
				id: project._id,
			});
			dispatch({ type: "setMoveNotesConfirmOpen", value: false });
			toast.success(
				result.movedCount === 1
					? "1 note moved to trash"
					: `${result.movedCount} notes moved to trash`,
			);
		} catch (error) {
			console.error("Failed to move project notes to trash", error);
			toast.error("Failed to move notes to trash");
		} finally {
			setIsMovingNotesToTrash(false);
		}
	}, [isMovingNotesToTrash, moveProjectNotesToTrash, project._id, workspaceId]);

	return (
		<>
			<Collapsible asChild open={open} onOpenChange={onOpenChange}>
				<SidebarMenuItem className="group/project-item group/collapsible">
					<ProjectSidebarRow
						projectName={project.name}
						hasNotes={hasNotes}
						isStarred={project.isStarred ?? false}
						workspaceId={workspaceId}
						isOpen={open}
						menuOpen={state.menuOpen}
						renameOpen={state.renameOpen}
						renameValue={renameValue}
						renameInputRef={renameInputRef}
						preventMenuCloseAutoFocusRef={preventMenuCloseAutoFocusRef}
						ignoreInitialRenameInteractOutsideRef={
							ignoreInitialRenameInteractOutsideRef
						}
						onMenuOpenChange={(nextOpen) =>
							dispatch({ type: "setMenuOpen", value: nextOpen })
						}
						onToggleOpen={() => onOpenChange(!open)}
						onRenameOpenChange={handleRenameOpenChange}
						onStartRename={handleStartRename}
						onToggleStar={handleToggleStar}
						onMoveNotesToTrash={() => {
							dispatch({ type: "setMenuOpen", value: false });
							dispatch({ type: "setMoveNotesConfirmOpen", value: true });
						}}
						onRenameValueChange={(value) =>
							dispatch({ type: "setRenameValue", value })
						}
						onRenameCommit={() => {
							void handleRename();
						}}
						onRenameCancel={handleRenameCancel}
						onDeleteSelect={() => {
							dispatch({ type: "setMenuOpen", value: false });
							dispatch({ type: "setConfirmOpen", value: true });
						}}
					/>
					<ProjectSidebarContent
						hasNotes={hasNotes}
						notes={notes}
						currentNoteId={currentNoteId}
						currentNoteTitle={currentNoteTitle}
						recordingNoteId={recordingNoteId}
						onPrefetchNote={onPrefetchNote}
						onNoteSelect={onNoteSelect}
						onNoteTitleChange={onNoteTitleChange}
						onNoteTrashed={onNoteTrashed}
					/>
				</SidebarMenuItem>
			</Collapsible>
			<ProjectSidebarItemDialogs
				open={state.confirmOpen}
				isRemoving={isRemoving}
				moveNotesOpen={state.moveNotesConfirmOpen}
				isMoving={isMovingNotesToTrash}
				noteCount={notes.length}
				onDeleteOpenChange={(nextOpen) =>
					dispatch({ type: "setConfirmOpen", value: nextOpen })
				}
				onMoveNotesOpenChange={(nextOpen) =>
					dispatch({ type: "setMoveNotesConfirmOpen", value: nextOpen })
				}
				onDeleteConfirm={handleDeleteProject}
				onMoveNotesConfirm={handleMoveNotesToTrash}
			/>
		</>
	);
}

function ProjectSidebarItemDialogs({
	open,
	isRemoving,
	moveNotesOpen,
	isMoving,
	noteCount,
	onDeleteOpenChange,
	onMoveNotesOpenChange,
	onDeleteConfirm,
	onMoveNotesConfirm,
}: {
	open: boolean;
	isRemoving: boolean;
	moveNotesOpen: boolean;
	isMoving: boolean;
	noteCount: number;
	onDeleteOpenChange: (open: boolean) => void;
	onMoveNotesOpenChange: (open: boolean) => void;
	onDeleteConfirm: () => void;
	onMoveNotesConfirm: () => void;
}) {
	return (
		<>
			<ProjectDeleteDialog
				open={open}
				isRemoving={isRemoving}
				onOpenChange={onDeleteOpenChange}
				onConfirm={onDeleteConfirm}
			/>
			<ProjectMoveNotesToTrashDialog
				open={moveNotesOpen}
				isMoving={isMoving}
				noteCount={noteCount}
				onOpenChange={onMoveNotesOpenChange}
				onConfirm={onMoveNotesConfirm}
			/>
		</>
	);
}

function ProjectSidebarRow({
	projectName,
	hasNotes,
	isStarred,
	workspaceId,
	isOpen,
	menuOpen,
	renameOpen,
	renameValue,
	renameInputRef,
	preventMenuCloseAutoFocusRef,
	ignoreInitialRenameInteractOutsideRef,
	onMenuOpenChange,
	onToggleOpen,
	onRenameOpenChange,
	onStartRename,
	onToggleStar,
	onMoveNotesToTrash,
	onRenameValueChange,
	onRenameCommit,
	onRenameCancel,
	onDeleteSelect,
}: {
	projectName: string;
	hasNotes: boolean;
	isStarred: boolean;
	workspaceId: Id<"workspaces"> | null;
	isOpen: boolean;
	menuOpen: boolean;
	renameOpen: boolean;
	renameValue: string;
	renameInputRef: React.RefObject<HTMLInputElement | null>;
	preventMenuCloseAutoFocusRef: React.MutableRefObject<boolean>;
	ignoreInitialRenameInteractOutsideRef: React.MutableRefObject<boolean>;
	onMenuOpenChange: (open: boolean) => void;
	onToggleOpen: () => void;
	onRenameOpenChange: (open: boolean) => void;
	onStartRename: () => void;
	onToggleStar: () => void;
	onMoveNotesToTrash: () => void;
	onRenameValueChange: (value: string) => void;
	onRenameCommit: () => void;
	onRenameCancel: () => void;
	onDeleteSelect: () => void;
}) {
	return (
		<Popover open={renameOpen} onOpenChange={onRenameOpenChange}>
			<PopoverAnchor asChild>
				<div className="group/project-row relative">
					<SidebarMenuButton
						className="pr-8"
						aria-expanded={isOpen}
						onClick={onToggleOpen}
					>
						<span className="relative size-4 shrink-0">
							<span className="absolute inset-0 flex items-center justify-center transition-opacity opacity-100 group-hover/menu-button:opacity-0">
								{isOpen ? <FolderOpen /> : <Folder />}
							</span>
							<ChevronRight
								className={
									isOpen
										? "absolute inset-0 m-auto size-4 rotate-90 text-sidebar-foreground/50 opacity-0 transition-[opacity,transform] group-hover/menu-button:opacity-100"
										: "absolute inset-0 m-auto size-4 text-sidebar-foreground/50 opacity-0 transition-[opacity,transform] group-hover/menu-button:opacity-100"
								}
							/>
						</span>
						<span className="truncate">{projectName}</span>
					</SidebarMenuButton>
					<ProjectActionsMenu
						projectName={projectName}
						hasNotes={hasNotes}
						isStarred={isStarred}
						workspaceId={workspaceId}
						menuOpen={menuOpen}
						preventMenuCloseAutoFocusRef={preventMenuCloseAutoFocusRef}
						onMenuOpenChange={onMenuOpenChange}
						onStartRename={onStartRename}
						onToggleStar={onToggleStar}
						onMoveNotesToTrash={onMoveNotesToTrash}
						onDeleteSelect={onDeleteSelect}
					/>
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={8}
				className="w-[340px] rounded-lg border-sidebar-border/70 bg-sidebar p-1.5 shadow-2xl ring-1 ring-border/60"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					requestAnimationFrame(() => {
						const input = renameInputRef.current;
						if (!input) {
							return;
						}

						input.focus();
						input.setSelectionRange(0, input.value.length);
					});
				}}
				onInteractOutside={(event) => {
					if (ignoreInitialRenameInteractOutsideRef.current) {
						event.preventDefault();
						ignoreInitialRenameInteractOutsideRef.current = false;
					}
				}}
			>
				<div className="flex items-center gap-2">
					<NoteTitleEditInput
						focusOnMount
						commitOnBlur={false}
						inputRef={renameInputRef}
						value={renameValue}
						placeholder="Project name"
						maxLength={MAX_PROJECT_NAME_LENGTH}
						onValueChange={onRenameValueChange}
						onCommit={onRenameCommit}
						onCancel={onRenameCancel}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function ProjectActionsMenu({
	projectName,
	hasNotes,
	isStarred,
	workspaceId,
	menuOpen,
	preventMenuCloseAutoFocusRef,
	onMenuOpenChange,
	onStartRename,
	onToggleStar,
	onMoveNotesToTrash,
	onDeleteSelect,
}: {
	projectName: string;
	hasNotes: boolean;
	isStarred: boolean;
	workspaceId: Id<"workspaces"> | null;
	menuOpen: boolean;
	preventMenuCloseAutoFocusRef: React.MutableRefObject<boolean>;
	onMenuOpenChange: (open: boolean) => void;
	onStartRename: () => void;
	onToggleStar: () => void;
	onMoveNotesToTrash: () => void;
	onDeleteSelect: () => void;
}) {
	return (
		<DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
			<DropdownMenuTrigger asChild>
				<SidebarMenuAction
					className="pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
					aria-label={`Open actions for ${projectName}`}
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					<MoreHorizontal />
				</SidebarMenuAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="w-48 rounded-lg"
				side="right"
				align="start"
				onCloseAutoFocus={(event) => {
					if (preventMenuCloseAutoFocusRef.current) {
						event.preventDefault();
						preventMenuCloseAutoFocusRef.current = false;
					}
				}}
			>
				<DropdownMenuItem disabled={!workspaceId} onClick={onStartRename}>
					<Pencil />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem disabled={!workspaceId} onClick={onToggleStar}>
					{isStarred ? <StarOff /> : <Star />}
					{isStarred ? "Unstar" : "Star"}
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!workspaceId || !hasNotes}
					onClick={onMoveNotesToTrash}
				>
					<Archive />
					Move notes to trash
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					disabled={!workspaceId}
					onSelect={(event) => {
						event.preventDefault();
						onDeleteSelect();
					}}
				>
					<Trash2 />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProjectSidebarContent({
	hasNotes,
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	hasNotes: boolean;
	notes: Array<Doc<"notes">>;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const [showAllNotes, setShowAllNotes] = React.useState(false);
	const hasMoreNotes = notes.length > MAX_VISIBLE_PROJECT_NOTES;
	const visibleNotes = showAllNotes
		? notes
		: notes.slice(0, MAX_VISIBLE_PROJECT_NOTES);

	return (
		<CollapsibleContent className="group/project-folder-content overflow-hidden">
			<div className="min-h-0 overflow-hidden">
				{hasNotes ? (
					<SidebarMenuSub className="mr-0 translate-x-0 pr-0">
						{visibleNotes.map((note) => (
							<ProjectNoteItem
								key={note._id}
								note={note}
								currentNoteId={currentNoteId}
								currentNoteTitle={currentNoteTitle}
								recordingNoteId={recordingNoteId}
								onPrefetchNote={onPrefetchNote}
								onNoteSelect={onNoteSelect}
								onNoteTitleChange={onNoteTitleChange}
								onNoteTrashed={onNoteTrashed}
							/>
						))}
						{hasMoreNotes ? (
							<SidebarMenuSubItem>
								<SidebarMenuSubButton
									asChild
									className="cursor-pointer text-sidebar-foreground/70 hover:bg-transparent hover:text-inherit"
								>
									<button
										type="button"
										onClick={() => setShowAllNotes((prev) => !prev)}
									>
										<MoreHorizontal />
										<span className="text-xs">
											{showAllNotes ? "Show less" : "Show more"}
										</span>
									</button>
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						) : null}
					</SidebarMenuSub>
				) : (
					<div className="px-8 py-2 text-xs text-sidebar-foreground/50">
						No notes in project yet
					</div>
				)}
			</div>
		</CollapsibleContent>
	);
}

function ProjectDeleteDialog({
	open,
	isRemoving,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	isRemoving: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
					<AlertDialogDescription>
						This action cannot be undone. This will delete your project and move
						its notes back.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
						onClick={onConfirm}
						disabled={isRemoving}
					>
						{isRemoving ? "Deleting..." : "Delete"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ProjectMoveNotesToTrashDialog({
	open,
	isMoving,
	noteCount,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	isMoving: boolean;
	noteCount: number;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Move notes to trash?</AlertDialogTitle>
					<AlertDialogDescription>
						This will move your notes to Trash. You can restore them later.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isMoving}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={isMoving || noteCount === 0}
					>
						{isMoving ? "Moving..." : "Move to trash"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ProjectNoteItem({
	note,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	note: Doc<"notes">;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const isActive = note._id === currentNoteId;
	const isRecording = note._id === recordingNoteId;
	const title =
		isActive && currentNoteTitle?.trim() ? currentNoteTitle : note.title;
	const displayTitle = getNoteDisplayTitle(title);
	const renameAnchor = React.useMemo(
		() => (
			<SidebarMenuButton
				isActive={isActive}
				onFocus={() => onPrefetchNote(note._id)}
				onMouseEnter={() => onPrefetchNote(note._id)}
				onPointerDown={() => onPrefetchNote(note._id)}
				onClick={() => onNoteSelect(note._id)}
			>
				{isRecording ? <SidebarRecordingSpinner /> : <FileText />}
				<span>{displayTitle}</span>
			</SidebarMenuButton>
		),
		[
			displayTitle,
			isActive,
			isRecording,
			note._id,
			onNoteSelect,
			onPrefetchNote,
		],
	);

	return (
		<SidebarMenuItem className="group/project-note-item list-none">
			<NoteActionsMenu
				noteId={note._id}
				onMoveToTrash={onNoteTrashed}
				align="start"
				side="right"
				renameAnchor={renameAnchor}
				renamePopoverAlign="start"
				renamePopoverSide="bottom"
				renamePopoverSideOffset={6}
				renamePopoverClassName="w-[340px] rounded-lg border-sidebar-border/70 bg-sidebar p-1.5 shadow-2xl ring-1 ring-border/60"
				onRenamePreviewChange={isActive ? onNoteTitleChange : undefined}
				onRenamePreviewReset={
					isActive ? () => onNoteTitleChange?.(note.title) : undefined
				}
			>
				<SidebarMenuAction
					className="pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/project-note-item:pointer-events-auto group-hover/project-note-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
					aria-label={`Open actions for ${displayTitle}`}
				>
					<MoreHorizontal />
				</SidebarMenuAction>
			</NoteActionsMenu>
		</SidebarMenuItem>
	);
}

function NavProjectsSkeleton() {
	return (
		<div className="px-2">
			<div className="flex flex-col gap-2">
				{SIDEBAR_PROJECT_SKELETON_IDS.map((id) => (
					<div key={id} className="flex items-center gap-2 rounded-md py-1">
						<Skeleton className="size-4 rounded-sm" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</div>
		</div>
	);
}

function buildProjectEntries(
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

const normalizeProjectName = (value: string) =>
	value.replace(/\s+/g, " ").trim();

const toNormalizedProjectKey = (value: string) =>
	normalizeProjectName(value).toLowerCase();

function sortProjectsByNormalizedName(
	projects: Array<Doc<"projects"> & { isStarred?: boolean }>,
) {
	return projects
		.map((project) => ({
			...project,
			isStarred: project.isStarred ?? false,
		}))
		.sort((left, right) => {
			const normalizedComparison = left.normalizedName.localeCompare(
				right.normalizedName,
			);
			if (normalizedComparison !== 0) {
				return normalizedComparison;
			}

			return left._creationTime - right._creationTime;
		});
}

function sortProjectEntries(
	entries: Array<ProjectWithNotes>,
	sortBy: ProjectListSort,
) {
	return entries.slice().sort((left, right) => {
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

function optimisticUpdateProjectList(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	updateProjects: (projects: Array<Doc<"projects">>) => Array<Doc<"projects">>,
) {
	const projects = localStore.getQuery(api.projects.list, { workspaceId });
	if (projects === undefined) {
		return;
	}

	localStore.setQuery(
		api.projects.list,
		{ workspaceId },
		sortProjectsByNormalizedName(updateProjects(projects)),
	);
}

function optimisticClearProjectFromNotes(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects">,
) {
	const noteQueries = [
		api.notes.list,
		api.notes.listShared,
		api.notes.listArchived,
	] as const;
	const matchedNoteIds = new Set<Id<"notes">>();

	for (const noteQuery of noteQueries) {
		const notes = localStore.getQuery(noteQuery, { workspaceId });
		if (notes === undefined) {
			continue;
		}

		localStore.setQuery(
			noteQuery,
			{ workspaceId },
			notes.map((note) => {
				if (note.projectId !== projectId) {
					return note;
				}

				matchedNoteIds.add(note._id);
				return {
					...note,
					projectId: undefined,
				};
			}),
		);
	}

	for (const noteId of matchedNoteIds) {
		const activeNote = localStore.getQuery(api.notes.get, {
			workspaceId,
			id: noteId,
		});
		if (!activeNote || activeNote.projectId !== projectId) {
			continue;
		}

		localStore.setQuery(
			api.notes.get,
			{ workspaceId, id: noteId },
			{
				...activeNote,
				projectId: undefined,
			},
		);
	}

	const latestNote = localStore.getQuery(api.notes.getLatest, { workspaceId });
	if (latestNote?.projectId === projectId) {
		localStore.setQuery(
			api.notes.getLatest,
			{ workspaceId },
			{
				...latestNote,
				projectId: undefined,
			},
		);
	}
}

function optimisticMoveProjectNotesToTrash(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects">,
) {
	const notes = localStore.getQuery(api.notes.list, { workspaceId });
	if (notes === undefined) {
		return;
	}

	const timestamp = Date.now();
	const projectNotes = notes.filter((note) => note.projectId === projectId);
	const projectNoteIds = new Set(projectNotes.map((note) => note._id));

	localStore.setQuery(
		api.notes.list,
		{ workspaceId },
		notes.filter((note) => !projectNoteIds.has(note._id)),
	);

	const archivedNotes = localStore.getQuery(api.notes.listArchived, {
		workspaceId,
	});
	if (archivedNotes !== undefined) {
		localStore.setQuery(api.notes.listArchived, { workspaceId }, [
			...projectNotes.map((note) => ({
				...note,
				isArchived: true,
				archivedAt: timestamp,
				updatedAt: timestamp,
			})),
			...archivedNotes,
		]);
	}

	for (const note of projectNotes) {
		const activeNote = localStore.getQuery(api.notes.get, {
			workspaceId,
			id: note._id,
		});
		if (activeNote !== undefined) {
			localStore.setQuery(api.notes.get, { workspaceId, id: note._id }, null);
		}

		archiveNoteChats(localStore, workspaceId, note._id);
	}

	const latestNote = localStore.getQuery(api.notes.getLatest, { workspaceId });
	if (latestNote && projectNoteIds.has(latestNote._id)) {
		localStore.setQuery(
			api.notes.getLatest,
			{ workspaceId },
			notes.find((note) => !projectNoteIds.has(note._id)) ?? null,
		);
	}
}
