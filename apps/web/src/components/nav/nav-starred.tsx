import { Icons } from "@workspace/ui/components/icons";
import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import {
	Clock,
	FileText,
	LoaderCircle,
	MessageCircle,
	MoreHorizontal,
} from "lucide-react";
import * as React from "react";
import { ChatActionsMenu } from "@/components/chat/chat-actions-menu";
import { ProjectSidebarItem } from "@/components/nav/nav-projects";
import { SidebarCollapsibleGroup } from "@/components/nav/sidebar-collapsible-group";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { getChatId } from "@/lib/chat";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type StarredItem =
	| {
			kind: "note";
			id: string;
			updatedAt: number;
			note: Doc<"notes">;
	  }
	| {
			kind: "chat";
			id: string;
			updatedAt: number;
			chat: Doc<"chats">;
	  }
	| {
			kind: "project";
			id: string;
			updatedAt: number;
			project: Doc<"projects">;
			notes: Array<Doc<"notes">>;
	  };

const getChatDisplayTitle = (title?: string) => {
	const trimmed = title?.trim();
	return trimmed?.length ? trimmed : "New chat";
};

const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

export function NavStarred({
	chats,
	activeStreamingChatIds,
	automationChatIds,
	notes,
	projects,
	workspaceId,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onChatSelect,
	onAddAutomation,
	onNotePrefetch,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	chats: Array<Doc<"chats">> | undefined;
	activeStreamingChatIds?: ReadonlySet<string>;
	automationChatIds?: ReadonlySet<string>;
	notes: Array<Doc<"notes">> | undefined;
	projects: Array<Doc<"projects">> | undefined;
	workspaceId: Id<"workspaces"> | null;
	currentChatId: string | null;
	currentChatTitle?: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onChatSelect: (chatId: string) => void;
	onAddAutomation?: (chatId: string) => void;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const starredItems = React.useMemo<StarredItem[]>(() => {
		const nextItems: StarredItem[] = [];
		const starredProjects = (projects ?? []).filter(
			(project) => project.isStarred,
		);

		for (const note of notes ?? []) {
			if (note.isStarred) {
				nextItems.push({
					kind: "note" as const,
					id: note._id,
					updatedAt: note.updatedAt,
					note,
				});
			}
		}

		for (const chat of chats ?? []) {
			if (chat.isStarred) {
				nextItems.push({
					kind: "chat" as const,
					id: getChatId(chat),
					updatedAt: chat.updatedAt,
					chat,
				});
			}
		}

		for (const project of starredProjects) {
			nextItems.push({
				kind: "project" as const,
				id: project._id,
				updatedAt: project.updatedAt,
				project,
				notes: (notes ?? []).filter((note) => note.projectId === project._id),
			});
		}

		return nextItems.sort((left, right) => right.updatedAt - left.updatedAt);
	}, [chats, notes, projects]);

	if (starredItems.length === 0) {
		return null;
	}

	return (
		<SidebarCollapsibleGroup
			title="Starred"
			className="group-data-[collapsible=icon]:hidden"
		>
			<SidebarMenu>
				{starredItems.map((item) => {
					if (item.kind === "note") {
						return (
							<StarredNoteItem
								key={`note:${item.note._id}`}
								note={item.note}
								currentNoteId={currentNoteId}
								currentNoteTitle={currentNoteTitle}
								recordingNoteId={recordingNoteId}
								onNotePrefetch={onNotePrefetch}
								onNoteSelect={onNoteSelect}
								onNoteTitleChange={onNoteTitleChange}
								onNoteTrashed={onNoteTrashed}
							/>
						);
					}

					if (item.kind === "chat") {
						const chat = item.chat;
						const chatId = getChatId(chat);
						const isActive = chatId === currentChatId;
						const title =
							isActive && currentChatTitle?.trim()
								? currentChatTitle
								: chat.title;
						const displayTitle = getChatDisplayTitle(title);
						const hasAutomation = automationChatIds?.has(chatId) ?? false;
						const isStreaming = activeStreamingChatIds?.has(chatId) ?? false;

						return (
							<SidebarMenuItem key={`chat:${chat._id}`}>
								<ChatActionsMenu
									chat={chat}
									hasAutomation={hasAutomation}
									onAddAutomation={onAddAutomation}
									align="start"
									side="right"
								>
									<SidebarMenuAction
										className="cursor-pointer opacity-0 pointer-events-none transition-opacity group-hover/menu-item:opacity-100 group-hover/menu-item:pointer-events-auto"
										aria-label={`Open actions for ${displayTitle}`}
									>
										<MoreHorizontal />
									</SidebarMenuAction>
								</ChatActionsMenu>
								<SidebarMenuButton
									className="min-w-0"
									isActive={isActive}
									onClick={() => onChatSelect(chatId)}
								>
									{isStreaming ? (
										<LoaderCircle
											className="animate-spin"
											aria-label="Chat is generating"
										/>
									) : (
										<MessageCircle />
									)}
									<span className="min-w-0 flex-1 truncate">
										{displayTitle}
									</span>
									{hasAutomation ? (
										<Clock
											className="ml-auto size-4 shrink-0 text-muted-foreground"
											aria-label="Automation set"
										/>
									) : null}
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					}

					const project = item.project;

					return (
						<StarredProjectItem
							key={`project:${project._id}`}
							project={project}
							notes={item.notes}
							workspaceId={workspaceId}
							currentNoteId={currentNoteId}
							currentNoteTitle={currentNoteTitle}
							recordingNoteId={recordingNoteId}
							onNotePrefetch={onNotePrefetch}
							onNoteSelect={onNoteSelect}
							onNoteTitleChange={onNoteTitleChange}
							onNoteTrashed={onNoteTrashed}
						/>
					);
				})}
			</SidebarMenu>
		</SidebarCollapsibleGroup>
	);
}

function StarredProjectItem({
	project,
	notes,
	workspaceId,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onNotePrefetch,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">>;
	workspaceId: Id<"workspaces"> | null;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const [open, setOpen] = React.useState(false);

	return (
		<ProjectSidebarItem
			project={project}
			notes={notes}
			open={open}
			workspaceId={workspaceId}
			currentNoteId={currentNoteId}
			currentNoteTitle={currentNoteTitle}
			recordingNoteId={recordingNoteId}
			onPrefetchNote={onNotePrefetch}
			onNoteSelect={onNoteSelect}
			onNoteTitleChange={onNoteTitleChange}
			onNoteTrashed={onNoteTrashed}
			onOpenChange={setOpen}
		/>
	);
}

function StarredNoteItem({
	note,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onNotePrefetch,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	note: Doc<"notes">;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const isActive = note._id === currentNoteId;
	const title =
		isActive && currentNoteTitle?.trim() ? currentNoteTitle : note.title;
	const displayTitle = getNoteDisplayTitle(title);
	const renameAnchor = React.useMemo(
		() => (
			<StarredNoteButton
				note={note}
				currentNoteId={currentNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				onNotePrefetch={onNotePrefetch}
				onNoteSelect={onNoteSelect}
			/>
		),
		[
			note,
			currentNoteId,
			currentNoteTitle,
			recordingNoteId,
			onNotePrefetch,
			onNoteSelect,
		],
	);

	return (
		<SidebarMenuItem>
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
					className="cursor-pointer opacity-0 pointer-events-none transition-opacity group-hover/menu-item:opacity-100 group-hover/menu-item:pointer-events-auto"
					aria-label={`Open actions for ${displayTitle}`}
				>
					<MoreHorizontal />
				</SidebarMenuAction>
			</NoteActionsMenu>
		</SidebarMenuItem>
	);
}

function StarredNoteButton({
	note,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onNotePrefetch,
	onNoteSelect,
}: {
	note: Doc<"notes">;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
}) {
	const isActive = note._id === currentNoteId;
	const isRecording = note._id === recordingNoteId;
	const title =
		isActive && currentNoteTitle?.trim() ? currentNoteTitle : note.title;
	const displayTitle = getNoteDisplayTitle(title);

	return (
		<SidebarMenuButton
			isActive={isActive}
			onFocus={() => onNotePrefetch(note._id)}
			onMouseEnter={() => onNotePrefetch(note._id)}
			onPointerDown={() => onNotePrefetch(note._id)}
			onClick={() => onNoteSelect(note._id)}
		>
			{isRecording ? <SidebarRecordingSpinner /> : <FileText />}
			<span>{displayTitle}</span>
		</SidebarMenuButton>
	);
}
