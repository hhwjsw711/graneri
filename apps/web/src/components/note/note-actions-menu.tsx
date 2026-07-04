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
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@workspace/ui/components/command";
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
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@workspace/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
	Archive,
	Check,
	CornerUpRight,
	FileText,
	Folder,
	Globe,
	History,
	Link2,
	Lock,
	Pencil,
	Share2,
	Star,
	StarOff,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { logError } from "@/lib/logger";
import { archiveNoteChats } from "@/lib/optimistic-note-chats";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { NoteTitleEditInput } from "./note-title-edit-input";
import { NoteVersionHistoryDialogEntry } from "./note-version-history-dialog-entry";
import { optimisticPatchNote } from "./optimistic-patch-note";
import { optimisticRenameNote } from "./optimistic-rename-note";
import {
	buildNoteShareUrl,
	type NoteVisibility,
	writeTextToClipboard,
} from "./share-note";

const ensureNoteHasRequiredFields = <T extends Doc<"notes">>(
	note: T,
	options?: { isStarred?: boolean },
) =>
	({
		...note,
		isStarred: options?.isStarred ?? note.isStarred ?? false,
		templateSlug: note.templateSlug ?? undefined,
		visibility: note.visibility ?? "private",
	}) as T & {
		isStarred: boolean;
		templateSlug: string | undefined;
		visibility: "private" | "public";
	};

const normalizeNoteList = <T extends Doc<"notes">>(notes: Array<T>) =>
	notes.map((note) => ensureNoteHasRequiredFields(note));

function useNoteStarControl(noteId: Id<"notes">) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [isUpdatingStar, setIsUpdatingStar] = React.useState(false);
	const note = useQuery(
		api.notes.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, id: noteId } : "skip",
	);
	const toggleStar = useMutation(api.notes.toggleStar).withOptimisticUpdate(
		(localStore, args) => {
			const updateNoteList = <T extends Doc<"notes">>(
				notes: Array<T> | undefined,
				query: typeof api.notes.list | typeof api.notes.listShared,
			) => {
				if (notes === undefined) {
					return;
				}

				localStore.setQuery(
					query,
					{ workspaceId: args.workspaceId },
					notes.map((item) =>
						item._id === args.id
							? ensureNoteHasRequiredFields(item, {
									isStarred: !(item.isStarred ?? false),
								})
							: ensureNoteHasRequiredFields(item),
					),
				);
			};

			updateNoteList(
				localStore.getQuery(api.notes.list, {
					workspaceId: args.workspaceId,
				}),
				api.notes.list,
			);
			updateNoteList(
				localStore.getQuery(api.notes.listShared, {
					workspaceId: args.workspaceId,
				}),
				api.notes.listShared,
			);

			const activeNote = localStore.getQuery(api.notes.get, {
				workspaceId: args.workspaceId,
				id: args.id,
			});
			if (activeNote) {
				localStore.setQuery(
					api.notes.get,
					{ workspaceId: args.workspaceId, id: args.id },
					{
						...activeNote,
						isStarred: !(activeNote.isStarred ?? false),
					},
				);
			}

			const latestNote = localStore.getQuery(api.notes.getLatest, {
				workspaceId: args.workspaceId,
			});
			if (latestNote?._id === args.id) {
				localStore.setQuery(
					api.notes.getLatest,
					{ workspaceId: args.workspaceId },
					{
						...latestNote,
						isStarred: !(latestNote.isStarred ?? false),
					},
				);
			}
		},
	);

	const handleToggleStar = React.useCallback(async () => {
		if (!note || !activeWorkspaceId || isUpdatingStar) {
			return;
		}

		setIsUpdatingStar(true);

		try {
			const result = await toggleStar({
				workspaceId: activeWorkspaceId,
				id: noteId,
			});
			toast.success(result.isStarred ? "Note starred" : "Note unstarred");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update note star",
			});
			toast.error("Failed to update note star");
		} finally {
			setIsUpdatingStar(false);
		}
	}, [activeWorkspaceId, isUpdatingStar, note, noteId, toggleStar]);

	return {
		handleToggleStar,
		isUpdatingStar,
		note,
	};
}

export function NoteStarButton({
	noteId,
	className,
}: {
	noteId: Id<"notes">;
	className?: string;
}) {
	const { handleToggleStar, isUpdatingStar, note } = useNoteStarControl(noteId);
	const isStarred = note?.isStarred ?? false;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={cn(
						"text-muted-foreground hover:text-foreground",
						className,
					)}
					aria-label={
						isStarred ? "Remove note from favorites" : "Add note to favorites"
					}
					aria-pressed={isStarred}
					disabled={!note || isUpdatingStar}
					onClick={() => {
						void handleToggleStar();
					}}
				>
					{isStarred ? (
						<StarOff className="size-4" />
					) : (
						<Star className="size-4" />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{isStarred ? "Unstar note" : "Star note"}</TooltipContent>
		</Tooltip>
	);
}

type NoteActionsMenuProps = {
	noteId: Id<"notes">;
	onMoveToTrash?: (noteId: Id<"notes">) => void;
	children: React.ReactNode;
	triggerTooltip?: React.ReactNode;
	renameAnchor?: React.ReactNode;
	renamePopoverAlign?: "start" | "center" | "end";
	renamePopoverSide?: "top" | "right" | "bottom" | "left";
	renamePopoverSideOffset?: number;
	renamePopoverClassName?: string;
	onRenamePreviewChange?: (title: string) => void;
	onRenamePreviewReset?: () => void;
	align?: "start" | "center" | "end";
	side?: "top" | "right" | "bottom" | "left";
	showRename?: boolean;
	showVersionHistory?: boolean;
	itemsBeforeDefaults?: React.ReactNode;
	itemsAfterDefaults?: React.ReactNode;
};

function useNoteActionsMenu({
	noteId,
	onMoveToTrash,
	onRenamePreviewChange,
}: Pick<
	NoteActionsMenuProps,
	"noteId" | "onMoveToTrash" | "onRenamePreviewChange"
>) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const preventMenuCloseAutoFocusRef = React.useRef(false);
	const ignoreInitialRenameInteractOutsideRef = React.useRef(false);
	const [confirmOpen, setConfirmOpen] = React.useState(false);
	const [menuOpen, setMenuOpen] = React.useState(false);
	const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false);
	const [renameOpen, setRenameOpen] = React.useState(false);
	const [renameValue, setRenameValue] = React.useState("");
	const renameInputRef = React.useRef<HTMLInputElement>(null);
	const [isMovingToTrash, setIsMovingToTrash] = React.useState(false);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const [isUpdatingShare, setIsUpdatingShare] = React.useState(false);
	const [isUpdatingProject, setIsUpdatingProject] = React.useState(false);
	const { handleToggleStar, isUpdatingStar, note } = useNoteStarControl(noteId);
	const projects = useQuery(
		api.projects.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const ensureShareId = useMutation(api.notes.ensureShareId);
	const renameNote = useMutation(api.notes.rename).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameNote(localStore, args.workspaceId, args.id, args.title);
		},
	);
	const setProject = useMutation(api.notes.setProject).withOptimisticUpdate(
		(localStore, args) => {
			optimisticPatchNote(
				localStore,
				args.workspaceId,
				args.id,
				(currentNote) => ({
					...currentNote,
					projectId: args.projectId ?? undefined,
				}),
			);
		},
	);
	const moveToTrash = useMutation(api.notes.moveToTrash).withOptimisticUpdate(
		(localStore, args) => {
			const notes = localStore.getQuery(api.notes.list, {
				workspaceId: args.workspaceId,
			});
			const sharedNotes = localStore.getQuery(api.notes.listShared, {
				workspaceId: args.workspaceId,
			});

			if (notes !== undefined) {
				localStore.setQuery(
					api.notes.list,
					{ workspaceId: args.workspaceId },
					normalizeNoteList(notes.filter((item) => item._id !== args.id)),
				);
			}

			if (sharedNotes !== undefined) {
				localStore.setQuery(
					api.notes.listShared,
					{ workspaceId: args.workspaceId },
					normalizeNoteList(sharedNotes.filter((item) => item._id !== args.id)),
				);
			}

			const activeNote = localStore.getQuery(api.notes.get, {
				workspaceId: args.workspaceId,
				id: args.id,
			});
			if (activeNote !== undefined) {
				localStore.setQuery(
					api.notes.get,
					{ workspaceId: args.workspaceId, id: args.id },
					null,
				);
			}

			const latestNote = localStore.getQuery(api.notes.getLatest, {
				workspaceId: args.workspaceId,
			});
			if (latestNote?._id === args.id) {
				const nextLatest =
					notes?.find((item) => item._id !== args.id) ??
					(null as Doc<"notes"> | null);
				localStore.setQuery(
					api.notes.getLatest,
					{ workspaceId: args.workspaceId },
					nextLatest ? ensureNoteHasRequiredFields(nextLatest) : null,
				);
			}

			archiveNoteChats(localStore, args.workspaceId, args.id);
		},
	);
	const updateVisibility = useMutation(api.notes.updateVisibility);

	const handleCopyLink = React.useCallback(async () => {
		if (!activeWorkspaceId) {
			return;
		}

		try {
			const result = await ensureShareId({
				workspaceId: activeWorkspaceId,
				id: noteId,
			});
			const shareUrl = await buildNoteShareUrl(result.shareId);
			await writeTextToClipboard(shareUrl);
			toast.success("Link copied");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to copy note link",
			});
			toast.error("Failed to copy link");
		}
	}, [activeWorkspaceId, ensureShareId, noteId]);

	const handleRename = React.useCallback(async () => {
		if (!note || !activeWorkspaceId || isRenaming) {
			return;
		}

		const nextTitle = renameValue.trim();
		const currentTitle = note.title.trim();

		if (nextTitle === currentTitle) {
			setRenameOpen(false);
			setRenameValue(nextTitle);
			return;
		}

		setIsRenaming(true);

		try {
			await renameNote({
				workspaceId: activeWorkspaceId,
				id: noteId,
				title: nextTitle,
			});
			setRenameOpen(false);
			setRenameValue(nextTitle);
			toast.success("Note renamed");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to rename note",
			});
			toast.error("Failed to rename note");
		} finally {
			setIsRenaming(false);
		}
	}, [activeWorkspaceId, isRenaming, note, noteId, renameNote, renameValue]);

	const handleRenameValueChange = React.useCallback(
		(value: string) => {
			setRenameValue(value);
			if (renameOpen) {
				onRenamePreviewChange?.(value);
			}
		},
		[onRenamePreviewChange, renameOpen],
	);

	const handleRenameOpenChange = React.useCallback(
		(open: boolean) => {
			if (open) {
				setRenameOpen(true);
				return;
			}

			void handleRename();
		},
		[handleRename],
	);

	const handleSetVisibility = React.useCallback(
		async (visibility: NoteVisibility) => {
			if (!note || !activeWorkspaceId || isUpdatingShare) {
				return;
			}

			setIsUpdatingShare(true);

			try {
				if (visibility === "private") {
					if (note.visibility === "private") {
						return;
					}

					await updateVisibility({
						workspaceId: activeWorkspaceId,
						id: noteId,
						visibility: "private",
					});
					toast.success("Note is now private");
					return;
				}

				let shareId = note.shareId;
				if (note.visibility !== "public" || !shareId) {
					const result = await updateVisibility({
						workspaceId: activeWorkspaceId,
						id: noteId,
						visibility: "public",
					});
					shareId = result.shareId;
				}

				if (!shareId) {
					throw new Error("Missing share identifier.");
				}

				const shareUrl = await buildNoteShareUrl(shareId);
				await writeTextToClipboard(shareUrl);
				toast.success(
					note.visibility === "public"
						? "Share link copied"
						: "Note shared and link copied",
				);
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to update note visibility",
				});
				toast.error("Failed to update sharing");
			} finally {
				setIsUpdatingShare(false);
			}
		},
		[activeWorkspaceId, isUpdatingShare, note, noteId, updateVisibility],
	);

	const handleSetProject = React.useCallback(
		async (projectId: Id<"projects"> | null) => {
			if (!note || !activeWorkspaceId || isUpdatingProject) {
				return;
			}

			const currentProjectId = note.projectId ?? null;
			if (currentProjectId === projectId) {
				return;
			}

			setMenuOpen(false);
			setIsUpdatingProject(true);

			try {
				await setProject({
					workspaceId: activeWorkspaceId,
					id: noteId,
					projectId,
				});
				toast.success(
					projectId ? "Note moved to project" : "Removed from project",
				);
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to update project",
				});
				toast.error("Failed to update project");
			} finally {
				setIsUpdatingProject(false);
			}
		},
		[activeWorkspaceId, isUpdatingProject, note, noteId, setProject],
	);

	const handleMoveToTrash = React.useCallback(() => {
		if (!activeWorkspaceId || isMovingToTrash) {
			return;
		}

		setIsMovingToTrash(true);

		void moveToTrash({ workspaceId: activeWorkspaceId, id: noteId })
			.then(() => {
				onMoveToTrash?.(noteId);
				setConfirmOpen(false);
				toast.success("Note moved to trash");
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to move note to trash",
				});
				toast.error("Failed to move note to trash");
			})
			.finally(() => {
				setIsMovingToTrash(false);
			});
	}, [activeWorkspaceId, isMovingToTrash, moveToTrash, noteId, onMoveToTrash]);

	const handleConfirmTrashOpen = React.useCallback(() => {
		setMenuOpen(false);
		setConfirmOpen(true);
	}, []);

	const handleVersionHistoryOpen = React.useCallback(() => {
		setMenuOpen(false);
		setVersionHistoryOpen(true);
	}, []);

	const handleStartRename = React.useCallback(() => {
		setMenuOpen(false);
		preventMenuCloseAutoFocusRef.current = true;
		ignoreInitialRenameInteractOutsideRef.current = true;
		setRenameValue(note?.title ?? "");
		setRenameOpen(true);
	}, [note?.title]);

	const handleRenameCancel = React.useCallback(() => {
		setRenameOpen(false);
		setRenameValue(note?.title ?? "");
	}, [note?.title]);

	return {
		confirmOpen,
		setConfirmOpen,
		menuOpen,
		setMenuOpen,
		versionHistoryOpen,
		setVersionHistoryOpen,
		renameOpen,
		renameValue,
		handleRenameValueChange,
		renameInputRef,
		isMovingToTrash,
		isRenaming,
		isUpdatingShare,
		isUpdatingProject,
		isUpdatingStar,
		note,
		projects,
		preventMenuCloseAutoFocusRef,
		ignoreInitialRenameInteractOutsideRef,
		handleToggleStar,
		handleRenameOpenChange,
		handleSetVisibility,
		handleSetProject,
		handleCopyLink,
		handleMoveToTrash,
		handleConfirmTrashOpen,
		handleVersionHistoryOpen,
		handleStartRename,
		handleRenameCancel,
		handleRename,
	};
}

export function NoteActionsMenu({
	noteId,
	onMoveToTrash,
	children,
	triggerTooltip,
	renameAnchor,
	renamePopoverAlign = "start",
	renamePopoverSide = "bottom",
	renamePopoverSideOffset = 8,
	renamePopoverClassName,
	onRenamePreviewReset,
	align = "start",
	side = "bottom",
	showRename = true,
	showVersionHistory = true,
	itemsBeforeDefaults,
	itemsAfterDefaults,
	onRenamePreviewChange,
}: NoteActionsMenuProps) {
	const {
		confirmOpen,
		setConfirmOpen,
		menuOpen,
		setMenuOpen,
		versionHistoryOpen,
		setVersionHistoryOpen,
		renameOpen,
		renameValue,
		handleRenameValueChange,
		renameInputRef,
		isMovingToTrash,
		isRenaming,
		isUpdatingShare,
		isUpdatingProject,
		isUpdatingStar,
		note,
		projects,
		preventMenuCloseAutoFocusRef,
		ignoreInitialRenameInteractOutsideRef,
		handleToggleStar,
		handleRenameOpenChange,
		handleSetVisibility,
		handleSetProject,
		handleCopyLink,
		handleMoveToTrash,
		handleConfirmTrashOpen,
		handleVersionHistoryOpen,
		handleStartRename,
		handleRenameCancel,
		handleRename,
	} = useNoteActionsMenu({
		noteId,
		onMoveToTrash,
		onRenamePreviewChange,
	});
	const trigger = triggerTooltip ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			</TooltipTrigger>
			<TooltipContent>{triggerTooltip}</TooltipContent>
		</Tooltip>
	) : (
		<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
	);
	const actionsDropdown = (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			{trigger}
			<NoteActionsDropdownContent
				align={align}
				side={side}
				itemsBeforeDefaults={itemsBeforeDefaults}
				itemsAfterDefaults={itemsAfterDefaults}
				preventMenuCloseAutoFocusRef={preventMenuCloseAutoFocusRef}
				note={note}
				projects={projects}
				status={{
					isUpdatingShare,
					isUpdatingProject,
					isUpdatingStar,
					showRename,
					showVersionHistory,
				}}
				onSetVisibility={handleSetVisibility}
				onSetProject={handleSetProject}
				onStartRename={handleStartRename}
				onToggleStar={handleToggleStar}
				onCopyLink={handleCopyLink}
				onOpenVersionHistory={handleVersionHistoryOpen}
				onConfirmTrash={handleConfirmTrashOpen}
			/>
		</DropdownMenu>
	);
	const renameEditor = showRename ? (
		<NoteRenameEditor
			usePopover={Boolean(renameAnchor)}
			renameOpen={renameOpen}
			onRenameOpenChange={handleRenameOpenChange}
			renamePopoverAlign={renamePopoverAlign}
			renamePopoverSide={renamePopoverSide}
			renamePopoverSideOffset={renamePopoverSideOffset}
			renamePopoverClassName={renamePopoverClassName}
			renameInputRef={renameInputRef}
			renameValue={renameValue}
			onRenameValueChange={handleRenameValueChange}
			onRename={() => {
				void handleRename();
			}}
			onRenameCancel={() => {
				handleRenameCancel();
				onRenamePreviewReset?.();
			}}
			ignoreInitialRenameInteractOutsideRef={
				ignoreInitialRenameInteractOutsideRef
			}
			isRenaming={isRenaming}
		/>
	) : null;

	return (
		<>
			{renameAnchor ? (
				<Popover open={renameOpen} onOpenChange={handleRenameOpenChange}>
					<PopoverAnchor asChild>
						<div className="relative">
							{renameAnchor}
							{actionsDropdown}
						</div>
					</PopoverAnchor>
					{renameEditor}
				</Popover>
			) : (
				<>
					{actionsDropdown}
					{renameEditor}
				</>
			)}
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Move note to trash?</AlertDialogTitle>
						<AlertDialogDescription>
							This will move your note to Trash. You can restore it later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isMovingToTrash}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleMoveToTrash}
							disabled={isMovingToTrash}
						>
							{isMovingToTrash ? "Moving..." : "Move to trash"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<NoteVersionHistoryDialogEntry
				initialVersion={
					note
						? {
								id: "current",
								isCurrent: true,
								authorName: note.authorName ?? "",
								title: note.title,
								content: note.content,
								searchableText: note.searchableText,
								createdAt: note.updatedAt,
							}
						: null
				}
				noteId={noteId}
				open={versionHistoryOpen}
				onOpenChange={setVersionHistoryOpen}
			/>
		</>
	);
}

function NoteRenameEditor({
	usePopover,
	renameOpen,
	onRenameOpenChange,
	renamePopoverAlign,
	renamePopoverSide,
	renamePopoverSideOffset,
	renamePopoverClassName,
	renameInputRef,
	renameValue,
	onRenameValueChange,
	onRename,
	onRenameCancel,
	ignoreInitialRenameInteractOutsideRef,
	isRenaming,
}: {
	usePopover: boolean;
	renameOpen: boolean;
	onRenameOpenChange: (open: boolean) => void;
	renamePopoverAlign: "start" | "center" | "end";
	renamePopoverSide: "top" | "right" | "bottom" | "left";
	renamePopoverSideOffset: number;
	renamePopoverClassName?: string;
	renameInputRef: React.RefObject<HTMLInputElement | null>;
	renameValue: string;
	onRenameValueChange: (value: string) => void;
	onRename: () => void;
	onRenameCancel: () => void;
	ignoreInitialRenameInteractOutsideRef: React.MutableRefObject<boolean>;
	isRenaming: boolean;
}) {
	if (usePopover) {
		return (
			<PopoverContent
				align={renamePopoverAlign}
				side={renamePopoverSide}
				sideOffset={renamePopoverSideOffset}
				className={cn("w-96 rounded-lg p-2", renamePopoverClassName)}
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
						onValueChange={onRenameValueChange}
						onCommit={onRename}
						onCancel={onRenameCancel}
					/>
				</div>
			</PopoverContent>
		);
	}

	return (
		<Dialog open={renameOpen} onOpenChange={onRenameOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename note</DialogTitle>
					<DialogDescription>
						Enter a new title for this note.
					</DialogDescription>
				</DialogHeader>
				<div>
					<NoteTitleEditInput
						focusOnMount
						commitOnBlur={false}
						className="h-9 rounded-lg px-3 text-sm"
						inputRef={renameInputRef}
						value={renameValue}
						onValueChange={onRenameValueChange}
						onCommit={onRename}
						onCancel={onRenameCancel}
					/>
				</div>
				<div className="flex justify-end gap-2">
					<Button
						variant="ghost"
						onClick={onRenameCancel}
						disabled={isRenaming}
					>
						Cancel
					</Button>
					<Button onClick={onRename} disabled={isRenaming}>
						{isRenaming ? "Renaming..." : "Rename"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function NoteProjectMoveSubmenu({
	note,
	projects,
	isUpdatingProject,
	onSetProject,
}: {
	note: Doc<"notes"> | null | undefined;
	projects: Array<Doc<"projects">> | undefined;
	isUpdatingProject: boolean;
	onSetProject: (projectId: Id<"projects"> | null) => Promise<void>;
}) {
	const [open, setOpen] = React.useState(false);
	const [searchValue, setSearchValue] = React.useState("");
	const searchInputRef = React.useRef<HTMLInputElement>(null);

	const handleOpenChange = React.useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setSearchValue("");
		}
	}, []);

	React.useEffect(() => {
		if (!open) {
			return;
		}

		requestAnimationFrame(() => {
			searchInputRef.current?.focus();
		});
	}, [open]);

	return (
		<DropdownMenuSub open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuSubTrigger disabled={!note}>
				<CornerUpRight />
				Move to
			</DropdownMenuSubTrigger>
			<DropdownMenuPortal>
				<DropdownMenuSubContent className="w-60 border-input/30 p-0">
					<Command>
						<CommandInput
							ref={searchInputRef}
							placeholder="Move note to..."
							className="h-9"
							value={searchValue}
							onValueChange={setSearchValue}
							disabled={!note || isUpdatingProject}
						/>
						<CommandList className="max-h-60">
							<CommandEmpty>No projects found.</CommandEmpty>
							<CommandGroup
								heading="Main"
								className="p-1 **:[[cmdk-group-heading]]:py-1"
							>
								<CommandItem
									value="notes top level"
									className="relative w-full cursor-pointer gap-2 py-1.5 pr-8"
									disabled={!note || isUpdatingProject}
									onSelect={() => {
										handleOpenChange(false);
										void onSetProject(null);
									}}
								>
									<FileText />
									<span className="truncate">Notes</span>
									{!note?.projectId ? (
										<span className="absolute right-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
											<Check className="size-4" />
										</span>
									) : null}
								</CommandItem>
							</CommandGroup>
							{(projects?.length ?? 0) > 0 ? (
								<CommandGroup
									heading="Projects"
									className="p-1 **:[[cmdk-group-heading]]:py-1"
								>
									{projects?.map((project) => (
										<CommandItem
											key={project._id}
											value={`${project._id} ${project.name}`}
											className="relative w-full cursor-pointer gap-2 py-1.5 pr-8"
											disabled={!note || isUpdatingProject}
											onSelect={() => {
												handleOpenChange(false);
												void onSetProject(project._id);
											}}
										>
											<Folder />
											<span className="truncate">{project.name}</span>
											{note?.projectId === project._id ? (
												<span className="absolute right-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
													<Check className="size-4" />
												</span>
											) : null}
										</CommandItem>
									))}
								</CommandGroup>
							) : null}
						</CommandList>
					</Command>
				</DropdownMenuSubContent>
			</DropdownMenuPortal>
		</DropdownMenuSub>
	);
}

function NoteActionsDropdownContent({
	align,
	side,
	itemsBeforeDefaults,
	itemsAfterDefaults,
	preventMenuCloseAutoFocusRef,
	note,
	projects,
	status,
	onSetVisibility,
	onSetProject,
	onStartRename,
	onToggleStar,
	onCopyLink,
	onOpenVersionHistory,
	onConfirmTrash,
}: {
	align: "start" | "center" | "end";
	side: "top" | "right" | "bottom" | "left";
	itemsBeforeDefaults?: React.ReactNode;
	itemsAfterDefaults?: React.ReactNode;
	preventMenuCloseAutoFocusRef: React.MutableRefObject<boolean>;
	note: Doc<"notes"> | null | undefined;
	projects: Array<Doc<"projects">> | undefined;
	status: {
		isUpdatingShare: boolean;
		isUpdatingProject: boolean;
		isUpdatingStar: boolean;
		showRename: boolean;
		showVersionHistory: boolean;
	};
	onSetVisibility: (visibility: NoteVisibility) => Promise<void>;
	onSetProject: (projectId: Id<"projects"> | null) => Promise<void>;
	onStartRename: () => void;
	onToggleStar: () => Promise<void>;
	onCopyLink: () => Promise<void>;
	onOpenVersionHistory: () => void;
	onConfirmTrash: () => void;
}) {
	const {
		isUpdatingShare,
		isUpdatingProject,
		isUpdatingStar,
		showRename,
		showVersionHistory,
	} = status;

	return (
		<DropdownMenuContent
			align={align}
			side={side}
			className="w-56 overflow-hidden rounded-lg p-1"
			onCloseAutoFocus={(event) => {
				if (preventMenuCloseAutoFocusRef.current) {
					event.preventDefault();
					preventMenuCloseAutoFocusRef.current = false;
				}
			}}
		>
			{itemsBeforeDefaults}
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>
					<Share2 />
					Share
				</DropdownMenuSubTrigger>
				<DropdownMenuPortal>
					<DropdownMenuSubContent className="min-w-40">
						<DropdownMenuItem
							className="cursor-pointer justify-between"
							disabled={note === undefined || isUpdatingShare}
							onClick={() => {
								void onSetVisibility("private");
							}}
						>
							<div className="flex items-center gap-2">
								<Lock />
								<span>Private</span>
							</div>
							{note?.visibility === "private" ? <Check /> : null}
						</DropdownMenuItem>
						<DropdownMenuItem
							className="cursor-pointer justify-between"
							disabled={note === undefined || isUpdatingShare}
							onClick={() => {
								void onSetVisibility("public");
							}}
						>
							<div className="flex items-center gap-2">
								<Globe />
								<span>Public</span>
							</div>
							{note?.visibility === "public" ? <Check /> : null}
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuPortal>
			</DropdownMenuSub>
			{showRename ? (
				<DropdownMenuItem
					className="cursor-pointer"
					disabled={!note}
					onClick={onStartRename}
				>
					<Pencil />
					Rename
				</DropdownMenuItem>
			) : null}
			<DropdownMenuItem
				className="cursor-pointer"
				disabled={!note || isUpdatingStar}
				onClick={() => {
					void onToggleStar();
				}}
			>
				{note?.isStarred ? <StarOff /> : <Star />}
				{note?.isStarred ? "Unstar" : "Star"}
			</DropdownMenuItem>
			<NoteProjectMoveSubmenu
				note={note}
				projects={projects}
				isUpdatingProject={isUpdatingProject}
				onSetProject={onSetProject}
			/>
			<DropdownMenuItem
				className="cursor-pointer"
				onClick={() => {
					void onCopyLink();
				}}
			>
				<Link2 />
				Copy link
			</DropdownMenuItem>
			{showVersionHistory ? (
				<DropdownMenuItem
					className="cursor-pointer"
					disabled={!note}
					onSelect={onOpenVersionHistory}
				>
					<History />
					Version history
				</DropdownMenuItem>
			) : null}
			{itemsAfterDefaults}
			<DropdownMenuItem className="cursor-pointer" onSelect={onConfirmTrash}>
				<Archive />
				Move to trash
			</DropdownMenuItem>
		</DropdownMenuContent>
	);
}
