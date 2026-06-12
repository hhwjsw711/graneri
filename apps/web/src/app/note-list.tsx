import { Icons } from "@workspace/ui/components/icons";
import { cn } from "@workspace/ui/lib/utils";
import { FileText, MoreHorizontal } from "lucide-react";
import type { AppUser } from "@/app/app-types";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { formatRelativeTimestamp } from "@/lib/chat-timestamp";
import {
	groupItemsByRelativeDate,
	RELATIVE_DATE_GROUP_SECTIONS,
} from "@/lib/group-by-relative-date";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

const getNoteAuthorDisplayName = (note: Doc<"notes">, currentUser: AppUser) =>
	note.authorName?.trim() || currentUser.name;

const formatNoteCreatedTime = (note: Doc<"notes">) =>
	formatRelativeTimestamp(note.createdAt || note._creationTime);

const getNoteCreatedDateTime = (note: Doc<"notes">) =>
	new Date(note.createdAt || note._creationTime).toISOString();

export function NotesList({
	notes,
	activeNoteId,
	activeNoteTitle,
	recordingNoteId,
	currentUser,
	onOpenNote,
	onNoteTrashed,
}: {
	notes: Array<Doc<"notes">>;
	activeNoteId: Id<"notes"> | null;
	activeNoteTitle: string;
	recordingNoteId: Id<"notes"> | null;
	currentUser: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	const groupedNotes = groupItemsByRelativeDate(
		notes,
		(note) => note.updatedAt || note.createdAt || note._creationTime,
	);
	const sections = RELATIVE_DATE_GROUP_SECTIONS.map((section) => ({
		...section,
		notes: groupedNotes[section.key],
	}));

	return (
		<div className="w-full space-y-1 md:max-w-xl">
			{sections.map((section) => {
				if (section.notes.length === 0) {
					return null;
				}

				return (
					<div key={section.key} className="space-y-2">
						<div className="flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-foreground/70">
							{section.label}
						</div>
						<div className="space-y-2">
							{section.notes.map((note) => {
								const isActive = note._id === activeNoteId;
								const isRecording = note._id === recordingNoteId;
								const title = getNoteDisplayTitle(
									isActive && activeNoteTitle.trim()
										? activeNoteTitle
										: note.title,
								);
								const authorDisplayName = getNoteAuthorDisplayName(
									note,
									currentUser,
								);
								const createdTime = formatNoteCreatedTime(note);

								return (
									<div
										key={note._id}
										className={cn(
											"group flex items-center rounded-lg p-1 transition-colors hover:bg-accent has-[[data-note-actions]:focus-visible]:bg-transparent has-[[data-note-actions]:hover]:bg-transparent",
											isActive ? "bg-transparent" : "bg-transparent",
										)}
									>
										<button
											type="button"
											onClick={() => onOpenNote(note._id)}
											className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-1 text-left"
										>
											<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
												{isRecording ? (
													<SidebarRecordingSpinner />
												) : (
													<FileText className="size-4" />
												)}
											</div>
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm font-medium">
													{title}
												</div>
												<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
													<span className="truncate">{authorDisplayName}</span>
													<span aria-hidden="true">·</span>
													<time
														dateTime={getNoteCreatedDateTime(note)}
														className="shrink-0 tabular-nums"
													>
														{createdTime}
													</time>
												</div>
											</div>
										</button>
										<NoteActionsMenu
											noteId={note._id}
											onMoveToTrash={onNoteTrashed}
											align="end"
											showVersionHistory={false}
										>
											<button
												type="button"
												data-note-actions
												className="flex aspect-square size-5 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 outline-hidden transition-[color,opacity] group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 data-[state=open]:text-foreground"
												aria-label={`Open actions for ${title}`}
												onClick={(event) => event.stopPropagation()}
											>
												<MoreHorizontal className="size-4" />
											</button>
										</NoteActionsMenu>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
