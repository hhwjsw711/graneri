import { Icons } from "@workspace/ui/components/icons";
import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import {
	Clock,
	FileText,
	LoaderCircle,
	MessageCircle,
	MoreHorizontal,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ChatActionsMenu } from "@/components/chat/chat-actions-menu";
import { ProjectSidebarItem } from "@/components/nav/nav-projects";
import { SidebarCollapsibleGroup } from "@/components/nav/sidebar-collapsible-group";
import {
	type SidebarSortableBindings,
	SidebarSortableList,
	useSidebarSortableBindings,
} from "@/components/nav/sidebar-sortable-list";
import { resolveSidebarSortableItems } from "@/components/nav/sidebar-sortable-utils";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { getChatId } from "@/lib/chat";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type StarredItem =
	| {
			kind: "note";
			id: string;
			starredSortOrder: number;
			note: Doc<"notes">;
	  }
	| {
			kind: "chat";
			id: string;
			starredSortOrder: number;
			chat: Doc<"chats">;
	  }
	| {
			kind: "project";
			id: string;
			starredSortOrder: number;
			project: Doc<"projects">;
			notes: Array<Doc<"notes">>;
	  };

type StarredReorderItem =
	| { kind: "note"; id: Id<"notes"> }
	| { kind: "chat"; id: Id<"chats"> }
	| { kind: "project"; id: Id<"projects"> };

const getChatDisplayTitle = (title?: string) => {
	const trimmed = title?.trim();
	return trimmed?.length ? trimmed : "New chat";
};

const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

const getStarredSortableId = (item: StarredReorderItem) =>
	`${item.kind}:${item.id}`;

const toStarredReorderItem = (item: StarredItem): StarredReorderItem => {
	if (item.kind === "note") {
		return { kind: "note", id: item.note._id };
	}

	if (item.kind === "chat") {
		return { kind: "chat", id: item.chat._id };
	}

	return { kind: "project", id: item.project._id };
};

const updateStarredSortOrder = <TDoc extends { _id: string }>(
	docs: Array<TDoc>,
	items: Array<StarredReorderItem>,
	kind: StarredReorderItem["kind"],
) => {
	const orderById = new Map(
		items.flatMap((item, index) =>
			item.kind === kind ? [[String(item.id), index] as const] : [],
		),
	);

	return docs.map((doc) => {
		const starredSortOrder = orderById.get(String(doc._id));
		return starredSortOrder === undefined ? doc : { ...doc, starredSortOrder };
	});
};

const optimisticUpdateStarredOrder = (
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	items: Array<StarredReorderItem>,
) => {
	const notes = localStore.getQuery(api.notes.list, { workspaceId });
	if (notes) {
		localStore.setQuery(
			api.notes.list,
			{ workspaceId },
			updateStarredSortOrder(notes, items, "note"),
		);
	}

	const chats = localStore.getQuery(api.chats.list, { workspaceId });
	if (chats) {
		localStore.setQuery(
			api.chats.list,
			{ workspaceId },
			updateStarredSortOrder(chats, items, "chat"),
		);
	}

	const projects = localStore.getQuery(api.projects.list, { workspaceId });
	if (projects) {
		localStore.setQuery(
			api.projects.list,
			{ workspaceId },
			updateStarredSortOrder(projects, items, "project"),
		);
	}
};

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
	onProjectSelect,
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
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const reorderStarred = useMutation(api.starred.reorder).withOptimisticUpdate(
		(localStore, args) => {
			optimisticUpdateStarredOrder(localStore, args.workspaceId, args.items);
		},
	);
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
					starredSortOrder: note.starredSortOrder,
					note,
				});
			}
		}

		for (const chat of chats ?? []) {
			if (chat.isStarred) {
				nextItems.push({
					kind: "chat" as const,
					id: chat._id,
					starredSortOrder: chat.starredSortOrder,
					chat,
				});
			}
		}

		for (const project of starredProjects) {
			nextItems.push({
				kind: "project" as const,
				id: project._id,
				starredSortOrder: project.starredSortOrder,
				project,
				notes: (notes ?? []).filter((note) => note.projectId === project._id),
			});
		}

		return nextItems.sort((left, right) => {
			if (left.starredSortOrder !== right.starredSortOrder) {
				return left.starredSortOrder - right.starredSortOrder;
			}

			return left.id.localeCompare(right.id);
		});
	}, [chats, notes, projects]);
	const starredReorderItems = React.useMemo(
		() => starredItems.map(toStarredReorderItem),
		[starredItems],
	);
	const starredSortableIds = React.useMemo(
		() => starredReorderItems.map(getStarredSortableId),
		[starredReorderItems],
	);
	const starredReorderItemsBySortableId = React.useMemo(
		() =>
			new Map(
				starredReorderItems.map((item) => [getStarredSortableId(item), item]),
			),
		[starredReorderItems],
	);
	const canReorderStarred = workspaceId !== null && starredItems.length > 1;
	const handleStarredReorder = React.useCallback(
		(sortableIds: Array<string>) => {
			if (!workspaceId) {
				return;
			}

			const items = resolveSidebarSortableItems(
				sortableIds,
				starredReorderItemsBySortableId,
			);
			if (!items) {
				toast.error("Failed to reorder starred items");
				return;
			}

			void reorderStarred({ workspaceId, items }).catch((error) => {
				console.error("Failed to reorder starred items", error);
				toast.error("Failed to reorder starred items");
			});
		},
		[reorderStarred, starredReorderItemsBySortableId, workspaceId],
	);

	if (starredItems.length === 0) {
		return null;
	}

	const list = (
		<SidebarMenu>
			{starredItems.map((item) => (
				<StarredItemRow
					key={`${item.kind}:${item.id}`}
					item={item}
					activeStreamingChatIds={activeStreamingChatIds}
					automationChatIds={automationChatIds}
					currentChatId={currentChatId}
					currentChatTitle={currentChatTitle}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					onAddAutomation={onAddAutomation}
					onChatSelect={onChatSelect}
					onNotePrefetch={onNotePrefetch}
					onNoteSelect={onNoteSelect}
					onProjectSelect={onProjectSelect}
					onNoteTitleChange={onNoteTitleChange}
					onNoteTrashed={onNoteTrashed}
					recordingNoteId={recordingNoteId}
					sortableId={
						canReorderStarred
							? getStarredSortableId(toStarredReorderItem(item))
							: undefined
					}
					workspaceId={workspaceId}
				/>
			))}
		</SidebarMenu>
	);

	return (
		<SidebarCollapsibleGroup
			title="Starred"
			className="group-data-[collapsible=icon]:hidden"
		>
			{canReorderStarred ? (
				<SidebarSortableList
					ids={starredSortableIds}
					onReorder={handleStarredReorder}
				>
					{list}
				</SidebarSortableList>
			) : (
				list
			)}
		</SidebarCollapsibleGroup>
	);
}

function StarredItemRow({
	item,
	sortableId,
	activeStreamingChatIds,
	automationChatIds,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	onAddAutomation,
	onChatSelect,
	onNotePrefetch,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	recordingNoteId,
	workspaceId,
}: {
	item: StarredItem;
	sortableId?: string;
	activeStreamingChatIds?: ReadonlySet<string>;
	automationChatIds?: ReadonlySet<string>;
	currentChatId: string | null;
	currentChatTitle?: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	onAddAutomation?: (chatId: string) => void;
	onChatSelect: (chatId: string) => void;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	recordingNoteId: Id<"notes"> | null;
	workspaceId: Id<"workspaces"> | null;
}) {
	if (sortableId) {
		return (
			<SortableStarredItem
				item={item}
				activeStreamingChatIds={activeStreamingChatIds}
				automationChatIds={automationChatIds}
				currentChatId={currentChatId}
				currentChatTitle={currentChatTitle}
				currentNoteId={currentNoteId}
				currentNoteTitle={currentNoteTitle}
				onAddAutomation={onAddAutomation}
				onChatSelect={onChatSelect}
				onNotePrefetch={onNotePrefetch}
				onNoteSelect={onNoteSelect}
				onProjectSelect={onProjectSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
				recordingNoteId={recordingNoteId}
				sortableId={sortableId}
				workspaceId={workspaceId}
			/>
		);
	}

	return (
		<StarredItemContent
			item={item}
			activeStreamingChatIds={activeStreamingChatIds}
			automationChatIds={automationChatIds}
			currentChatId={currentChatId}
			currentChatTitle={currentChatTitle}
			currentNoteId={currentNoteId}
			currentNoteTitle={currentNoteTitle}
			onAddAutomation={onAddAutomation}
			onChatSelect={onChatSelect}
			onNotePrefetch={onNotePrefetch}
			onNoteSelect={onNoteSelect}
			onProjectSelect={onProjectSelect}
			onNoteTitleChange={onNoteTitleChange}
			onNoteTrashed={onNoteTrashed}
			recordingNoteId={recordingNoteId}
			workspaceId={workspaceId}
		/>
	);
}

function SortableStarredItem({
	sortableId,
	...props
}: React.ComponentProps<typeof StarredItemRow> & { sortableId: string }) {
	const sortable = useSidebarSortableBindings(sortableId);

	return <StarredItemContent {...props} sortable={sortable} />;
}

function StarredItemContent({
	item,
	sortable,
	activeStreamingChatIds,
	automationChatIds,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	onAddAutomation,
	onChatSelect,
	onNotePrefetch,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	recordingNoteId,
	workspaceId,
}: Omit<React.ComponentProps<typeof StarredItemRow>, "sortableId"> & {
	sortable?: SidebarSortableBindings;
}) {
	if (item.kind === "note") {
		return (
			<StarredNoteItem
				note={item.note}
				currentNoteId={currentNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				sortable={sortable}
				onNotePrefetch={onNotePrefetch}
				onNoteSelect={onNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
			/>
		);
	}

	if (item.kind === "chat") {
		return (
			<StarredChatItem
				chat={item.chat}
				activeStreamingChatIds={activeStreamingChatIds}
				automationChatIds={automationChatIds}
				currentChatId={currentChatId}
				currentChatTitle={currentChatTitle}
				sortable={sortable}
				onAddAutomation={onAddAutomation}
				onChatSelect={onChatSelect}
			/>
		);
	}

	return (
		<StarredProjectItem
			project={item.project}
			notes={item.notes}
			workspaceId={workspaceId}
			currentNoteId={currentNoteId}
			currentNoteTitle={currentNoteTitle}
			recordingNoteId={recordingNoteId}
			sortable={sortable}
			onNotePrefetch={onNotePrefetch}
			onNoteSelect={onNoteSelect}
			onProjectSelect={onProjectSelect}
			onNoteTitleChange={onNoteTitleChange}
			onNoteTrashed={onNoteTrashed}
		/>
	);
}

function StarredChatItem({
	chat,
	activeStreamingChatIds,
	automationChatIds,
	currentChatId,
	currentChatTitle,
	sortable,
	onAddAutomation,
	onChatSelect,
}: {
	chat: Doc<"chats">;
	activeStreamingChatIds?: ReadonlySet<string>;
	automationChatIds?: ReadonlySet<string>;
	currentChatId: string | null;
	currentChatTitle?: string;
	sortable?: SidebarSortableBindings;
	onAddAutomation?: (chatId: string) => void;
	onChatSelect: (chatId: string) => void;
}) {
	const chatId = getChatId(chat);
	const isActive = chatId === currentChatId;
	const title =
		isActive && currentChatTitle?.trim() ? currentChatTitle : chat.title;
	const displayTitle = getChatDisplayTitle(title);
	const hasAutomation = automationChatIds?.has(chatId) ?? false;
	const isStreaming = activeStreamingChatIds?.has(chatId) ?? false;

	return (
		<SidebarMenuItem
			ref={sortable?.ref}
			style={sortable?.style}
			className={sortable?.isDragging ? "relative z-10 opacity-80" : undefined}
		>
			<ChatActionsMenu
				chat={chat}
				hasAutomation={hasAutomation}
				onAddAutomation={onAddAutomation}
				align="start"
				side="right"
			>
				<SidebarMenuAction
					className="pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
					aria-label={`Open actions for ${displayTitle}`}
				>
					<MoreHorizontal />
				</SidebarMenuAction>
			</ChatActionsMenu>
			<SidebarMenuButton
				className="min-w-0"
				isActive={isActive}
				onClick={() => onChatSelect(chatId)}
				{...sortable?.buttonProps}
			>
				{isStreaming ? (
					<LoaderCircle
						className="animate-spin"
						aria-label="Chat is generating"
					/>
				) : (
					<MessageCircle />
				)}
				<span className="min-w-0 flex-1 truncate">{displayTitle}</span>
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

function StarredProjectItem({
	project,
	notes,
	workspaceId,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onNotePrefetch,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	sortable,
}: {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">>;
	workspaceId: Id<"workspaces"> | null;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	sortable?: SidebarSortableBindings;
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
			onProjectSelect={onProjectSelect}
			onNoteTitleChange={onNoteTitleChange}
			onNoteTrashed={onNoteTrashed}
			onOpenChange={setOpen}
			projectRowActions={null}
			sortable={sortable}
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
	sortable,
}: {
	note: Doc<"notes">;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	sortable?: SidebarSortableBindings;
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
				sortableButtonProps={sortable?.buttonProps}
			/>
		),
		[
			note,
			currentNoteId,
			currentNoteTitle,
			recordingNoteId,
			onNotePrefetch,
			onNoteSelect,
			sortable?.buttonProps,
		],
	);

	return (
		<SidebarMenuItem
			ref={sortable?.ref}
			style={sortable?.style}
			className={sortable?.isDragging ? "relative z-10 opacity-80" : undefined}
		>
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
					className="pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
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
	sortableButtonProps,
}: {
	note: Doc<"notes">;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	sortableButtonProps?: React.HTMLAttributes<HTMLButtonElement>;
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
			{...sortableButtonProps}
		>
			{isRecording ? <SidebarRecordingSpinner /> : <FileText />}
			<span>{displayTitle}</span>
		</SidebarMenuButton>
	);
}
