import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";
import {
	SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME,
	SidebarCollapsibleGroup,
} from "@/components/nav/sidebar-collapsible-group";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { NoteRenameAnchor } from "./note-rename-anchor";

const MAX_VISIBLE_NOTES = 5;
const SIDEBAR_NOTE_SKELETON_IDS = [
	"sidebar-note-skeleton-1",
	"sidebar-note-skeleton-2",
	"sidebar-note-skeleton-3",
	"sidebar-note-skeleton-4",
] as const;
export function NavNotes({
	notes,
	title = "Notes",
	emptyMessage = "No notes yet",
	showStarred = true,
	filterProjectNotes = true,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId = null,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onCreateNote,
}: {
	notes: Array<Doc<"notes">> | undefined;
	title?: string;
	emptyMessage?: string;
	showStarred?: boolean;
	filterProjectNotes?: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId?: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onCreateNote?: () => void;
}) {
	const starredNotes = React.useMemo(
		() => (notes ?? []).filter((note) => note.isStarred),
		[notes],
	);
	const visibleNoteSource = React.useMemo(
		() =>
			filterProjectNotes
				? (notes ?? []).filter((note) => !note.projectId)
				: (notes ?? []),
		[filterProjectNotes, notes],
	);
	const [showAllNotes, setShowAllNotes] = React.useState(false);
	const isNotesPending = notes === undefined;
	const hasMoreNotes = visibleNoteSource.length > MAX_VISIBLE_NOTES;
	const visibleNotes = showAllNotes
		? visibleNoteSource
		: visibleNoteSource.slice(0, MAX_VISIBLE_NOTES);

	return (
		<>
			{showStarred && starredNotes.length > 0 ? (
				<SidebarCollapsibleGroup
					title="Starred"
					className="group-data-[collapsible=icon]:hidden"
				>
					<SidebarNotesList
						notes={starredNotes}
						currentNoteId={currentNoteId}
						currentNoteTitle={currentNoteTitle}
						recordingNoteId={recordingNoteId}
						onPrefetchNote={onPrefetchNote}
						onNoteSelect={onNoteSelect}
						onNoteTitleChange={onNoteTitleChange}
						onNoteTrashed={onNoteTrashed}
					/>
				</SidebarCollapsibleGroup>
			) : null}
			<SidebarCollapsibleGroup
				title={title}
				className="group-data-[collapsible=icon]:hidden"
				actionClassName={
					title === "Notes"
						? SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME
						: undefined
				}
				actionTooltip={title === "Notes" ? "Add note" : undefined}
				actions={
					title === "Notes" && onCreateNote ? (
						<button
							type="button"
							aria-label="Add note"
							className="cursor-pointer"
							onClick={onCreateNote}
						>
							<Plus />
						</button>
					) : undefined
				}
			>
				{isNotesPending ? <NavNotesSkeleton /> : null}
				{notes && visibleNoteSource.length === 0 ? (
					<div className="px-2 text-xs text-muted-foreground/50">
						{filterProjectNotes && notes.length > 0
							? "All notes are in projects"
							: emptyMessage}
					</div>
				) : null}
				{isNotesPending ? null : (
					<>
						<SidebarNotesList
							notes={visibleNotes}
							currentNoteId={currentNoteId}
							currentNoteTitle={currentNoteTitle}
							recordingNoteId={recordingNoteId}
							onPrefetchNote={onPrefetchNote}
							onNoteSelect={onNoteSelect}
							onNoteTitleChange={onNoteTitleChange}
							onNoteTrashed={onNoteTrashed}
						/>
						{hasMoreNotes ? (
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										className="text-sidebar-foreground/70 hover:bg-transparent hover:text-inherit"
										onClick={() => setShowAllNotes((prev) => !prev)}
									>
										<MoreHorizontal />
										<span className="text-xs">
											{showAllNotes ? "Show less" : "Show more"}
										</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						) : null}
					</>
				)}
			</SidebarCollapsibleGroup>
		</>
	);
}

function SidebarNotesList({
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	notes: Array<Doc<"notes">>;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	return (
		<SidebarMenu>
			{notes.map((note) => {
				const isActive = note._id === currentNoteId;
				const isRecording = note._id === recordingNoteId;
				const title =
					isActive && currentNoteTitle?.trim() ? currentNoteTitle : note.title;
				const displayTitle = getNoteDisplayTitle(title);
				const renameAnchor = (
					<NoteRenameAnchor
						displayTitle={displayTitle}
						isActive={isActive}
						isRecording={isRecording}
						noteId={note._id}
						onNoteSelect={onNoteSelect}
						onPrefetchNote={onPrefetchNote}
					/>
				);

				return (
					<SidebarMenuItem key={note._id}>
						<NoteActionsMenu
							noteId={note._id}
							onMoveToTrash={onNoteTrashed}
							align="start"
							side="right"
							// react-doctor-disable-next-line react-doctor/jsx-no-jsx-as-prop
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
								className="pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
								aria-label={`Open actions for ${displayTitle}`}
							>
								<MoreHorizontal />
							</SidebarMenuAction>
						</NoteActionsMenu>
					</SidebarMenuItem>
				);
			})}
		</SidebarMenu>
	);
}

function NavNotesSkeleton() {
	return (
		<div className="px-2">
			<div className="space-y-2">
				{SIDEBAR_NOTE_SKELETON_IDS.map((id) => (
					<div key={id} className="flex items-center gap-2 rounded-md py-1">
						<Skeleton className="size-4 rounded-sm" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</div>
		</div>
	);
}
