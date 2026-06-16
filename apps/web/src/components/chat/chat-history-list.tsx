import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Clock, MessageCircle, MoreHorizontal } from "lucide-react";
import { getChatId } from "@/lib/chat";
import { formatRelativeTimestamp } from "@/lib/chat-timestamp";
import {
	groupItemsByRelativeDate,
	RELATIVE_DATE_GROUP_SECTIONS,
} from "@/lib/group-by-relative-date";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ChatActionsMenu } from "./chat-actions-menu";

type ChatHistoryListProps = {
	chats: Array<Doc<"chats">>;
	isChatsLoading: boolean;
	activeChatId: string | null;
	onOpenChat: (chatId: string) => void;
	onPrefetchChat: (chatId: string) => void;
	onMoveToTrash: (chatId: string) => void;
	automationChatIds?: ReadonlySet<string>;
	activeStreamingChatIds?: ReadonlySet<string>;
	onAddAutomation?: (chatId: string) => void;
};

const getChatActivityTime = (chat: Doc<"chats">) =>
	chat.lastMessageAt || chat.updatedAt || chat.createdAt || chat._creationTime;

export function ChatHistoryList({
	chats,
	isChatsLoading,
	activeChatId,
	onOpenChat,
	onPrefetchChat,
	onMoveToTrash,
	automationChatIds,
	activeStreamingChatIds,
	onAddAutomation,
}: ChatHistoryListProps) {
	const groupedChats = groupItemsByRelativeDate(chats, getChatActivityTime);
	const chatSections = RELATIVE_DATE_GROUP_SECTIONS.map((section) => ({
		...section,
		chats: groupedChats[section.key],
	}));

	return (
		<div className="mx-auto mt-6 w-full max-w-xl">
			{isChatsLoading ? (
				<div className="min-h-[168px]" aria-hidden="true" />
			) : chats.length > 0 ? (
				<div className="space-y-1">
					{chatSections.map((section) => {
						if (section.chats.length === 0) {
							return null;
						}

						return (
							<div key={section.key} className="space-y-2">
								<div className="flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-foreground/70">
									{section.label}
								</div>
								<div className="space-y-2">
									{section.chats.map((chat) => {
										return (
											<ChatHistoryItem
												key={chat._id}
												chat={chat}
												activeChatId={activeChatId}
												onOpenChat={onOpenChat}
												onPrefetchChat={onPrefetchChat}
												onMoveToTrash={onMoveToTrash}
												hasAutomation={
													automationChatIds?.has(getChatId(chat)) ?? false
												}
												isStreaming={
													activeStreamingChatIds?.has(getChatId(chat)) ?? false
												}
												onAddAutomation={onAddAutomation}
											/>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			) : (
				<Empty className="max-w-xl">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessageCircle className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No chats yet</EmptyTitle>
						<EmptyDescription>
							Start a conversation and it will show up here
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	);
}

function ChatHistoryItem({
	chat,
	activeChatId,
	onOpenChat,
	onPrefetchChat,
	onMoveToTrash,
	hasAutomation,
	isStreaming,
	onAddAutomation,
}: {
	chat: Doc<"chats">;
	activeChatId: string | null;
	onOpenChat: (chatId: string) => void;
	onPrefetchChat: (chatId: string) => void;
	onMoveToTrash: (chatId: string) => void;
	hasAutomation: boolean;
	isStreaming: boolean;
	onAddAutomation?: (chatId: string) => void;
}) {
	const storedChatId = getChatId(chat);
	const preview = chat.authorName?.trim() || "Unknown user";
	const activityTime = getChatActivityTime(chat);
	const activityDate = new Date(activityTime);
	const formattedActivityTime = formatRelativeTimestamp(activityDate);
	const activityDateTime = activityDate.toISOString();

	return (
		<div
			className={cn(
				"group flex items-center rounded-lg p-1 transition-colors hover:bg-accent has-[[data-chat-actions]:focus-visible]:bg-transparent has-[[data-chat-actions]:hover]:bg-transparent",
				activeChatId === storedChatId ? "bg-transparent" : "bg-transparent",
			)}
		>
			<button
				type="button"
				onClick={() => onOpenChat(storedChatId)}
				onFocus={() => onPrefetchChat(storedChatId)}
				onMouseEnter={() => onPrefetchChat(storedChatId)}
				onPointerDown={() => onPrefetchChat(storedChatId)}
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-1 text-left"
			>
				<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
					{isStreaming ? (
						<Spinner className="size-4" aria-label="Chat is generating" />
					) : (
						<MessageCircle className="size-4" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">
						{chat.title || "New chat"}
					</div>
					<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
						<span className="truncate">{preview}</span>
						<span aria-hidden="true">·</span>
						<time dateTime={activityDateTime} className="shrink-0 tabular-nums">
							{formattedActivityTime}
						</time>
					</div>
				</div>
			</button>
			{hasAutomation ? (
				<Clock
					className="mr-1 size-4 shrink-0 text-muted-foreground"
					aria-label="Automation set"
				/>
			) : null}
			<ChatActionsMenu
				chat={chat}
				hasAutomation={hasAutomation}
				onAddAutomation={onAddAutomation}
				onMoveToTrash={onMoveToTrash}
			>
				<button
					type="button"
					data-chat-actions
					className="flex aspect-square size-5 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 outline-hidden transition-[color,opacity] group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 data-[state=open]:text-foreground"
					aria-label={`Open actions for ${chat.title || "chat"}`}
					onClick={(event) => event.stopPropagation()}
				>
					<MoreHorizontal className="size-4" />
				</button>
			</ChatActionsMenu>
		</div>
	);
}
