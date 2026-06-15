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
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation } from "convex/react";
import { Archive, Clock, Pencil, Star, StarOff } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { NoteTitleEditInput } from "@/components/note/note-title-edit-input";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { getChatId } from "@/lib/chat";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { optimisticPatchChat } from "./optimistic-patch-chat";
import { optimisticRemoveChat } from "./optimistic-remove-chat";
import { optimisticRenameChat } from "./optimistic-rename-chat";

type ChatActionsMenuProps = {
	chat: Doc<"chats">;
	children: React.ReactNode;
	onMoveToTrash?: (chatId: string) => void;
	onAddAutomation?: (chatId: string) => void;
	hasAutomation?: boolean;
	showMoveToTrash?: boolean;
	align?: "start" | "center" | "end";
	side?: "top" | "right" | "bottom" | "left";
};

type ChatActionsMenuState = {
	confirmTrashOpen: boolean;
	menuOpen: boolean;
	renameOpen: boolean;
	renameValue: string;
	isRenaming: boolean;
	isUpdatingStar: boolean;
	isMovingToTrash: boolean;
};

type ChatActionsMenuStateUpdate =
	| Partial<ChatActionsMenuState>
	| ((currentState: ChatActionsMenuState) => Partial<ChatActionsMenuState>);

const createChatActionsMenuState = (
	chat: Doc<"chats">,
): ChatActionsMenuState => ({
	confirmTrashOpen: false,
	menuOpen: false,
	renameOpen: false,
	renameValue: chat.title,
	isRenaming: false,
	isUpdatingStar: false,
	isMovingToTrash: false,
});

const chatActionsMenuStateReducer = (
	state: ChatActionsMenuState,
	update: ChatActionsMenuStateUpdate,
): ChatActionsMenuState => ({
	...state,
	...(typeof update === "function" ? update(state) : update),
});

export function ChatActionsMenu({
	chat,
	children,
	onMoveToTrash,
	onAddAutomation,
	hasAutomation = false,
	showMoveToTrash = true,
	align = "end",
	side,
}: ChatActionsMenuProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const renameInputRef = React.useRef<HTMLInputElement>(null);
	const [menuState, updateMenuState] = React.useReducer(
		chatActionsMenuStateReducer,
		null,
		() => createChatActionsMenuState(chat),
	);
	const {
		confirmTrashOpen,
		menuOpen,
		renameOpen,
		renameValue,
		isRenaming,
		isUpdatingStar,
		isMovingToTrash,
	} = menuState;
	const storedChatId = getChatId(chat);
	const isStarred = chat.isStarred ?? false;
	const renameChat = useMutation(api.chats.updateTitle).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameChat(
				localStore,
				args.workspaceId,
				args.chatId,
				args.title,
				chat.noteId,
			);
		},
	);
	const toggleStar = useMutation(api.chats.toggleStar).withOptimisticUpdate(
		(localStore, args) => {
			optimisticPatchChat(
				localStore,
				args.workspaceId,
				args.chatId,
				(currentChat) => ({
					...currentChat,
					isStarred: !(currentChat.isStarred ?? false),
				}),
				chat.noteId,
			);
		},
	);
	const moveToTrash = useMutation(api.chats.moveToTrash).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRemoveChat(localStore, args.workspaceId, args.chatId);
		},
	);

	React.useEffect(() => {
		if (renameOpen) {
			return;
		}

		updateMenuState({ renameValue: chat.title });
	}, [chat.title, renameOpen]);

	const handleRename = React.useCallback(async () => {
		if (!activeWorkspaceId || isRenaming) {
			return;
		}

		const nextTitle = renameValue.trim();
		const currentTitle = chat.title.trim();

		if (nextTitle === currentTitle) {
			updateMenuState({ renameOpen: false, renameValue: nextTitle });
			return;
		}

		updateMenuState({ isRenaming: true });

		try {
			await renameChat({
				workspaceId: activeWorkspaceId,
				chatId: storedChatId,
				title: nextTitle,
			});
			updateMenuState({ renameOpen: false, renameValue: nextTitle });
			toast.success("Chat renamed");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to rename chat",
			});
			toast.error("Failed to rename chat");
		} finally {
			updateMenuState({ isRenaming: false });
		}
	}, [
		activeWorkspaceId,
		chat.title,
		isRenaming,
		renameChat,
		renameValue,
		storedChatId,
	]);

	const handleRenameOpenChange = React.useCallback(
		(open: boolean) => {
			if (open) {
				updateMenuState({ renameOpen: true });
				return;
			}

			void handleRename();
		},
		[handleRename],
	);

	const handleStartRename = React.useCallback(() => {
		updateMenuState({
			menuOpen: false,
			renameValue: chat.title,
			renameOpen: true,
		});
	}, [chat.title]);

	const handleRenameCancel = React.useCallback(() => {
		updateMenuState({ renameOpen: false, renameValue: chat.title });
	}, [chat.title]);

	const handleToggleStar = React.useCallback(async () => {
		if (!activeWorkspaceId || isUpdatingStar) {
			return;
		}

		updateMenuState({ isUpdatingStar: true });

		try {
			const result = await toggleStar({
				workspaceId: activeWorkspaceId,
				chatId: storedChatId,
			});
			toast.success(result.isStarred ? "Chat starred" : "Chat unstarred");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update chat star",
			});
			toast.error("Failed to update chat star");
		} finally {
			updateMenuState({ isUpdatingStar: false });
		}
	}, [activeWorkspaceId, isUpdatingStar, storedChatId, toggleStar]);

	const handleMoveToTrash = React.useCallback(async () => {
		if (!activeWorkspaceId || isMovingToTrash) {
			return;
		}

		updateMenuState({ isMovingToTrash: true });

		try {
			await moveToTrash({
				workspaceId: activeWorkspaceId,
				chatId: storedChatId,
			});
			onMoveToTrash?.(storedChatId);
			updateMenuState({ confirmTrashOpen: false });
			toast.success("Chat moved to trash");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to move chat to trash",
			});
			toast.error("Failed to move chat to trash");
		} finally {
			updateMenuState({ isMovingToTrash: false });
		}
	}, [
		activeWorkspaceId,
		isMovingToTrash,
		moveToTrash,
		onMoveToTrash,
		storedChatId,
	]);

	return (
		<>
			<DropdownMenu
				open={menuOpen}
				onOpenChange={(open) => updateMenuState({ menuOpen: open })}
			>
				<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
				<ChatActionsDropdownContent
					chatId={storedChatId}
					status={{
						hasAutomation,
						isMovingToTrash,
						isStarred,
						isUpdatingStar,
						canUpdate: Boolean(activeWorkspaceId),
						showMoveToTrash,
					}}
					onAddAutomation={onAddAutomation}
					onStartRename={handleStartRename}
					onToggleStar={handleToggleStar}
					onOpenTrashConfirm={() =>
						updateMenuState({
							menuOpen: false,
							confirmTrashOpen: true,
						})
					}
					onCloseMenu={() => updateMenuState({ menuOpen: false })}
					align={align}
					side={side}
				/>
			</DropdownMenu>
			<Dialog open={renameOpen} onOpenChange={handleRenameOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename chat</DialogTitle>
						<DialogDescription>
							Enter a new title for this chat.
						</DialogDescription>
					</DialogHeader>
					<div>
						<NoteTitleEditInput
							focusOnMount
							commitOnBlur={false}
							className={cn(
								"h-9 rounded-lg px-3 text-sm",
								isRenaming && "opacity-70",
							)}
							inputRef={renameInputRef}
							value={renameValue}
							placeholder="New chat"
							onValueChange={(value) => updateMenuState({ renameValue: value })}
							onCommit={() => {
								void handleRename();
							}}
							onCancel={handleRenameCancel}
						/>
					</div>
					<div className="flex justify-end gap-2">
						<Button
							variant="ghost"
							onClick={handleRenameCancel}
							disabled={isRenaming}
						>
							Cancel
						</Button>
						<Button
							onClick={() => {
								void handleRename();
							}}
							disabled={isRenaming}
						>
							{isRenaming ? "Renaming..." : "Rename"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={confirmTrashOpen}
				onOpenChange={(open) => updateMenuState({ confirmTrashOpen: open })}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Move chat to trash?</AlertDialogTitle>
						<AlertDialogDescription>
							This will move your chat to Trash. You can restore it later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isMovingToTrash}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								void handleMoveToTrash();
							}}
							disabled={isMovingToTrash}
						>
							{isMovingToTrash ? "Moving..." : "Move to trash"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function ChatActionsDropdownContent({
	chatId,
	status,
	onAddAutomation,
	onStartRename,
	onToggleStar,
	onOpenTrashConfirm,
	onCloseMenu,
	align,
	side,
}: {
	chatId: string;
	status: {
		hasAutomation: boolean;
		isMovingToTrash: boolean;
		isStarred: boolean;
		isUpdatingStar: boolean;
		canUpdate: boolean;
		showMoveToTrash: boolean;
	};
	onAddAutomation: ((chatId: string) => void) | undefined;
	onStartRename: () => void;
	onToggleStar: () => Promise<void>;
	onOpenTrashConfirm: () => void;
	onCloseMenu: () => void;
	align: "start" | "center" | "end";
	side: "top" | "right" | "bottom" | "left" | undefined;
}) {
	const {
		hasAutomation,
		isMovingToTrash,
		isStarred,
		isUpdatingStar,
		canUpdate,
		showMoveToTrash,
	} = status;

	return (
		<DropdownMenuContent align={align} side={side}>
			<DropdownMenuItem
				className="cursor-pointer"
				disabled={!canUpdate}
				onSelect={onStartRename}
			>
				<Pencil />
				Rename
			</DropdownMenuItem>
			<DropdownMenuItem
				className="cursor-pointer"
				disabled={!canUpdate || isUpdatingStar}
				onSelect={() => {
					onCloseMenu();
					void onToggleStar();
				}}
			>
				{isStarred ? <StarOff /> : <Star />}
				{isStarred ? "Unstar" : "Star"}
			</DropdownMenuItem>
			{onAddAutomation ? (
				<DropdownMenuItem
					className="cursor-pointer"
					disabled={!canUpdate}
					onSelect={() => {
						onCloseMenu();
						onAddAutomation(chatId);
					}}
				>
					<Clock />
					{hasAutomation ? "Edit automation" : "Add automation"}
				</DropdownMenuItem>
			) : null}
			{showMoveToTrash ? (
				<DropdownMenuItem
					className="cursor-pointer"
					disabled={isMovingToTrash || !canUpdate}
					onSelect={onOpenTrashConfirm}
				>
					<Archive />
					Move to trash
				</DropdownMenuItem>
			) : null}
		</DropdownMenuContent>
	);
}
