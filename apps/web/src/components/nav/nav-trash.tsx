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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useMutation, useQuery } from "convex/react";
import {
	FileText,
	type LucideIcon,
	MessageCircle,
	Search,
	Trash2,
	Undo2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { getChatId } from "@/lib/chat";
import {
	groupItemsByRelativeDate,
	RELATIVE_DATE_GROUP_SECTIONS,
} from "@/lib/group-by-relative-date";
import { logError } from "@/lib/logger";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { removeNoteChats, restoreNoteChats } from "@/lib/optimistic-note-chats";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const TRASH_NOTE_SKELETON_IDS = [
	"trash-note-skeleton-1",
	"trash-note-skeleton-2",
	"trash-note-skeleton-3",
	"trash-note-skeleton-4",
] as const;

type TrashListItem = {
	key: string;
	title: string;
	icon: LucideIcon;
	updatedAt: number;
	onRestore: () => void;
	onDelete: () => void;
};

export function NavTrash({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { isMobile } = useSidebarShell();

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<Popover open={open} onOpenChange={onOpenChange}>
					<PopoverTrigger asChild>
						<SidebarMenuButton isActive={open}>
							<Trash2 />
							<span>Trash</span>
						</SidebarMenuButton>
					</PopoverTrigger>
					<PopoverContent
						className="h-[420px] max-h-[70vh] w-[min(380px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
						side={isMobile ? "bottom" : "right"}
						align="end"
						alignOffset={-24}
					>
						<TrashPopoverContent />
					</PopoverContent>
				</Popover>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

function TrashPopoverContent() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [search, setSearch] = React.useState("");
	const [deleteNoteId, setDeleteNoteId] = React.useState<Id<"notes"> | null>(
		null,
	);
	const [deleteChatId, setDeleteChatId] = React.useState<string | null>(null);
	const archivedNotes = useQuery(
		api.notes.listArchived,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const archivedChats = useQuery(
		api.chats.listArchived,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const restore = useMutation(api.notes.restore).withOptimisticUpdate(
		(localStore, args) => {
			const archived = localStore.getQuery(api.notes.listArchived, {
				workspaceId: args.workspaceId,
			});
			const note = archived?.find((item) => item._id === args.id) ?? null;

			if (archived !== undefined) {
				localStore.setQuery(
					api.notes.listArchived,
					{ workspaceId: args.workspaceId },
					archived.filter((item) => item._id !== args.id),
				);
			}

			if (note) {
				const active =
					localStore.getQuery(api.notes.list, {
						workspaceId: args.workspaceId,
					}) ?? [];
				localStore.setQuery(api.notes.list, { workspaceId: args.workspaceId }, [
					{
						...note,
						isArchived: false,
						archivedAt: undefined,
					},
					...active.filter((item) => item._id !== args.id),
				]);
			}

			restoreNoteChats(localStore, args.workspaceId, args.id);
		},
	);
	const remove = useMutation(api.notes.remove).withOptimisticUpdate(
		(localStore, args) => {
			const archived = localStore.getQuery(api.notes.listArchived, {
				workspaceId: args.workspaceId,
			});
			if (archived !== undefined) {
				localStore.setQuery(
					api.notes.listArchived,
					{ workspaceId: args.workspaceId },
					archived.filter((item) => item._id !== args.id),
				);
			}

			removeNoteChats(localStore, args.workspaceId, args.id);
		},
	);
	const restoreChat = useMutation(api.chats.restore).withOptimisticUpdate(
		(localStore, args) => {
			const archived = localStore.getQuery(api.chats.listArchived, {
				workspaceId: args.workspaceId,
			});
			const chat =
				archived?.find((item) => getChatId(item) === args.chatId) ?? null;

			if (archived !== undefined) {
				localStore.setQuery(
					api.chats.listArchived,
					{ workspaceId: args.workspaceId },
					archived.filter((item) => getChatId(item) !== args.chatId),
				);
			}

			if (chat) {
				const active =
					localStore.getQuery(api.chats.list, {
						workspaceId: args.workspaceId,
					}) ?? [];
				localStore.setQuery(api.chats.list, { workspaceId: args.workspaceId }, [
					{
						...chat,
						isArchived: false,
						archivedAt: undefined,
					},
					...active.filter((item) => getChatId(item) !== args.chatId),
				]);
			}
		},
	);
	const removeChat = useMutation(api.chats.remove).withOptimisticUpdate(
		(localStore, args) => {
			const archived = localStore.getQuery(api.chats.listArchived, {
				workspaceId: args.workspaceId,
			});
			if (archived !== undefined) {
				localStore.setQuery(
					api.chats.listArchived,
					{ workspaceId: args.workspaceId },
					archived.filter((item) => getChatId(item) !== args.chatId),
				);
			}
		},
	);
	const filteredNotes = React.useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!archivedNotes) {
			return [];
		}

		if (!query) {
			return archivedNotes;
		}

		return archivedNotes.filter((note) => {
			const haystack = [
				note.title,
				note.searchableText,
				note.authorName ?? "",
			].join(" ");

			return haystack.toLowerCase().includes(query);
		});
	}, [archivedNotes, search]);
	const filteredChats = React.useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!archivedChats) {
			return [];
		}

		if (!query) {
			return archivedChats;
		}

		return archivedChats.filter((chat) =>
			[chat.title, chat.preview, chat.authorName ?? "", chat.model ?? ""]
				.join(" ")
				.toLowerCase()
				.includes(query),
		);
	}, [archivedChats, search]);
	const hasArchivedNotes = (archivedNotes?.length ?? 0) > 0;
	const hasArchivedChats = (archivedChats?.length ?? 0) > 0;
	const hasArchivedItems = hasArchivedNotes || hasArchivedChats;

	const handleRestore = React.useCallback(
		(noteId: Id<"notes">) => {
			if (!activeWorkspaceId) {
				return;
			}

			void restore({ workspaceId: activeWorkspaceId, id: noteId })
				.then(() => {
					toast.success("Note restored");
				})
				.catch((error) => {
					logError({
						event: "client.error",
						error: error,
						message: "Failed to restore note",
					});
					toast.error("Failed to restore note");
				});
		},
		[activeWorkspaceId, restore],
	);
	const handleRestoreChat = React.useCallback(
		(chatId: string) => {
			if (!activeWorkspaceId) {
				return;
			}

			void restoreChat({ workspaceId: activeWorkspaceId, chatId })
				.then(() => {
					toast.success("Chat restored");
				})
				.catch((error) => {
					logError({
						event: "client.error",
						error: error,
						message: "Failed to restore chat",
					});
					toast.error("Failed to restore chat");
				});
		},
		[activeWorkspaceId, restoreChat],
	);

	const handleDelete = React.useCallback(() => {
		if (!deleteNoteId) {
			return;
		}

		if (!activeWorkspaceId) {
			return;
		}

		void remove({ workspaceId: activeWorkspaceId, id: deleteNoteId })
			.then(() => {
				setDeleteNoteId(null);
				toast.success("Note deleted permanently");
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete note",
				});
				toast.error("Failed to delete note");
			});
	}, [activeWorkspaceId, deleteNoteId, remove]);
	const handleDeleteChat = React.useCallback(() => {
		if (!deleteChatId) {
			return;
		}

		if (!activeWorkspaceId) {
			return;
		}

		void removeChat({ workspaceId: activeWorkspaceId, chatId: deleteChatId })
			.then(() => {
				setDeleteChatId(null);
				toast.success("Chat deleted permanently");
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete chat",
				});
				toast.error("Failed to delete chat");
			});
	}, [activeWorkspaceId, deleteChatId, removeChat]);

	return (
		<>
			<div className="flex h-full flex-col text-sm">
				<TrashSearchInput
					search={search}
					onSearchChange={(event) => setSearch(event.target.value)}
				/>

				<ScrollArea className="min-h-0 flex-1" viewportClassName="p-2 pt-1">
					{archivedNotes === undefined || archivedChats === undefined ? (
						<TrashPopoverSkeleton />
					) : filteredNotes.length > 0 || filteredChats.length > 0 ? (
						<TrashResults
							notes={filteredNotes}
							chats={filteredChats}
							onRestoreNote={handleRestore}
							onDeleteNote={setDeleteNoteId}
							onRestoreChat={handleRestoreChat}
							onDeleteChat={setDeleteChatId}
						/>
					) : (
						<TrashEmptyState hasArchivedItems={hasArchivedItems} />
					)}
				</ScrollArea>

				<div className="border-t px-3 py-2">
					<div className="text-xs text-muted-foreground">
						Items older than 30 days will be automatically deleted.
					</div>
				</div>
			</div>
			<DeleteConfirmDialog
				open={deleteNoteId !== null}
				description="This action cannot be undone. This will permanently delete your note."
				onOpenChange={(open) => {
					if (!open) {
						setDeleteNoteId(null);
					}
				}}
				onConfirm={handleDelete}
			/>
			<DeleteConfirmDialog
				open={deleteChatId !== null}
				description="This action cannot be undone. This will permanently delete your chat."
				onOpenChange={(open) => {
					if (!open) {
						setDeleteChatId(null);
					}
				}}
				onConfirm={handleDeleteChat}
			/>
		</>
	);
}

function TrashPopoverSkeleton() {
	return (
		<div className="space-y-1">
			{TRASH_NOTE_SKELETON_IDS.map((id) => (
				<div
					key={id}
					className="grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-1.5"
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<div className="flex size-6 shrink-0 items-center justify-center">
							<Skeleton className="size-4 rounded-sm" />
						</div>
						<Skeleton className="h-4 w-32 max-w-full" />
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Skeleton className="size-5 rounded-md" />
						<Skeleton className="size-5 rounded-md" />
					</div>
				</div>
			))}
		</div>
	);
}

function TrashSearchInput({
	search,
	onSearchChange,
}: {
	search: string;
	onSearchChange: React.ChangeEventHandler<HTMLInputElement>;
}) {
	return (
		<div className="p-2 pb-1">
			<div className="relative">
				<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={search}
					onChange={onSearchChange}
					className="h-8 bg-secondary pr-2 pl-8 focus-visible:border-input focus-visible:ring-0"
					placeholder="Search trash..."
				/>
			</div>
		</div>
	);
}

function TrashResults({
	notes,
	chats,
	onRestoreNote,
	onDeleteNote,
	onRestoreChat,
	onDeleteChat,
}: {
	notes: Array<Doc<"notes">>;
	chats: Array<Doc<"chats">>;
	onRestoreNote: (noteId: Id<"notes">) => void;
	onDeleteNote: (noteId: Id<"notes">) => void;
	onRestoreChat: (chatId: string) => void;
	onDeleteChat: (chatId: string) => void;
}) {
	const items = React.useMemo(
		() =>
			[
				...notes.map<TrashListItem>((note) => ({
					key: `note-${note._id}`,
					title: getNoteDisplayTitle(note.title),
					icon: FileText,
					updatedAt: note.updatedAt || note.createdAt || note._creationTime,
					onRestore: () => onRestoreNote(note._id),
					onDelete: () => onDeleteNote(note._id),
				})),
				...chats.map<TrashListItem>((chat) => ({
					key: `chat-${chat._id}`,
					title: chat.title || "New chat",
					icon: MessageCircle,
					updatedAt: chat.updatedAt || chat.createdAt || chat._creationTime,
					onRestore: () => onRestoreChat(getChatId(chat)),
					onDelete: () => onDeleteChat(getChatId(chat)),
				})),
			].sort((left, right) => right.updatedAt - left.updatedAt),
		[chats, notes, onDeleteChat, onDeleteNote, onRestoreChat, onRestoreNote],
	);
	const groupedItems = React.useMemo(
		() => groupItemsByRelativeDate(items, (item) => item.updatedAt),
		[items],
	);

	return (
		<div className="space-y-1">
			{RELATIVE_DATE_GROUP_SECTIONS.map((section) => {
				const sectionItems = groupedItems[section.key];

				if (sectionItems.length === 0) {
					return null;
				}

				return (
					<div key={section.key} className="space-y-1">
						<div className="px-1.5 pt-1 text-xs font-medium text-muted-foreground">
							{section.label}
						</div>
						{sectionItems.map((item) => (
							<TrashItemRow
								key={item.key}
								title={item.title}
								icon={item.icon}
								onRestore={item.onRestore}
								onDelete={item.onDelete}
							/>
						))}
					</div>
				);
			})}
		</div>
	);
}

function TrashItemRow({
	title,
	icon: Icon,
	onRestore,
	onDelete,
}: {
	title: string;
	icon: LucideIcon;
	onRestore: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="group grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
			<div className="flex min-w-0 items-center gap-1.5">
				<div className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
					<Icon className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm">{title}</div>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
				<TrashItemAction
					label={`Restore ${title}`}
					onClick={onRestore}
					tooltip="Restore"
				>
					<Undo2 className="size-4" />
				</TrashItemAction>
				<TrashItemAction
					label={`Delete ${title}`}
					onClick={onDelete}
					tooltip="Delete"
					destructive
				>
					<Trash2 className="size-4" />
				</TrashItemAction>
			</div>
		</div>
	);
}

function TrashItemAction({
	label,
	onClick,
	tooltip,
	destructive = false,
	children,
}: {
	label: string;
	onClick: () => void;
	tooltip: string;
	destructive?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className={
						destructive
							? "flex size-5 cursor-pointer items-center justify-center rounded-md p-0 text-destructive outline-hidden transition-transform focus-visible:ring-2 hover:bg-sidebar-accent hover:text-destructive [&>svg]:size-4 [&>svg]:shrink-0 dark:text-red-500"
							: "flex size-5 cursor-pointer items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden transition-transform focus-visible:ring-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
					}
					onClick={onClick}
					aria-label={label}
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}

function TrashEmptyState({ hasArchivedItems }: { hasArchivedItems: boolean }) {
	return (
		<div className="flex h-full items-center justify-center p-6">
			<Empty className="w-full gap-3 border-0 p-0">
				<EmptyHeader className="gap-1">
					<EmptyMedia variant="icon" className="text-muted-foreground">
						<Trash2 />
					</EmptyMedia>
					<EmptyTitle>No results</EmptyTitle>
					<EmptyDescription className="text-xs">
						{hasArchivedItems
							? "Try a different search."
							: "Deleted notes and chats will appear here"}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}

function DeleteConfirmDialog({
	open,
	description,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	description: string;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
						onClick={onConfirm}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
