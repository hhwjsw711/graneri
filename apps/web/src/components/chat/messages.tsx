import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { Check, Copy, PenLine, Plus, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CHAT_ACTIONS_VISIBILITY_CLASS } from "@/components/chat/message-layout";
import {
	type ChatMessageActionContext,
	ChatMessageListContent,
} from "@/components/chat/message-list";
import { getChatMessageMetadata } from "@/lib/chat-message";
import type { ChatComposerMention } from "./chat-composer";

type ChatMessagesActionProps = {
	messageIdPendingDelete: string | null;
	onDeleteClick: (messageId: string) => void;
	onEditMessage?: (
		messageId: string,
		text: string,
		mentions: ChatComposerMention[],
	) => void;
	onDeleteMessage?: (messageId: string) => void;
	onPlusAction?: (
		content: string,
	) => Promise<"created" | undefined> | "created" | undefined;
	onRegenerateMessage?: (messageId: string) => void;
	setMessageIdPendingDelete: React.Dispatch<
		React.SetStateAction<string | null>
	>;
};

export type ChatMessagesProps = {
	messages: UIMessage[];
	error?: Error;
	isLoading?: boolean;
	onEditMessage?: (
		messageId: string,
		text: string,
		mentions: ChatComposerMention[],
	) => void;
	onDeleteMessage?: (messageId: string) => void;
	onPlusAction?: (
		content: string,
	) => Promise<"created" | undefined> | "created" | undefined;
	onRegenerateMessage?: (messageId: string) => void;
	onOpenMention?: (noteId: string) => void;
};

// react-doctor-disable-next-line deslop/unused-export
export default function ChatMessages({
	messages,
	error,
	isLoading,
	onEditMessage,
	onDeleteMessage,
	onPlusAction,
	onRegenerateMessage,
	onOpenMention,
}: ChatMessagesProps) {
	const [messageIdPendingDelete, setMessageIdPendingDelete] = React.useState<
		string | null
	>(null);
	const handleDeleteClick = React.useCallback(
		(messageId: string) => {
			if (messageIdPendingDelete === messageId) {
				onDeleteMessage?.(messageId);
				setMessageIdPendingDelete(null);
				return;
			}

			setMessageIdPendingDelete(messageId);
		},
		[messageIdPendingDelete, onDeleteMessage],
	);
	const getTurnClassName = React.useCallback(
		(isLastTurn: boolean) => cn("space-y-3", isLastTurn && "pb-9"),
		[],
	);
	const renderAssistantActions = React.useCallback(
		({ message, messageText, timestamp }: ChatMessageActionContext) => (
			<AssistantMessageActions
				messageId={message.id}
				messageText={messageText}
				onPlusAction={onPlusAction}
				onRegenerateMessage={onRegenerateMessage}
				timestamp={timestamp}
			/>
		),
		[onPlusAction, onRegenerateMessage],
	);
	const renderUserActions = React.useCallback(
		({ message, messageText, timestamp }: ChatMessageActionContext) => (
			<UserMessageActions
				isPendingDelete={messageIdPendingDelete === message.id}
				messageId={message.id}
				messageText={messageText}
				mentions={getChatMessageMetadata(message)?.mentionPositions ?? []}
				onDeleteClick={handleDeleteClick}
				onDeleteMessage={onDeleteMessage}
				onEditMessage={onEditMessage}
				setMessageIdPendingDelete={setMessageIdPendingDelete}
				timestamp={timestamp}
			/>
		),
		[handleDeleteClick, messageIdPendingDelete, onDeleteMessage, onEditMessage],
	);

	return (
		<ChatMessageListContent
			className="space-y-4"
			error={error}
			errorClassName="px-4"
			isLoading={isLoading}
			messages={messages}
			streamdownClassName="note-streamdown"
			textContainerClassName="mt-2 flex flex-row items-start gap-2 first:mt-0"
			turnClassName={getTurnClassName}
			renderAssistantActions={renderAssistantActions}
			renderUserActions={renderUserActions}
			onOpenMention={onOpenMention}
		/>
	);
}

function AssistantMessageActions({
	messageId,
	messageText,
	onPlusAction,
	onRegenerateMessage,
	timestamp,
}: {
	messageId: string;
	messageText: string;
	onPlusAction?: ChatMessagesActionProps["onPlusAction"];
	onRegenerateMessage?: (messageId: string) => void;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn(
				"mt-2 flex items-center gap-1",
				CHAT_ACTIONS_VISIBILITY_CLASS,
			)}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-7 text-muted-foreground hover:text-foreground"
						aria-label="Regenerate"
						disabled={!onRegenerateMessage}
						onClick={() => onRegenerateMessage?.(messageId)}
					>
						<RotateCcw className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Regenerate</TooltipContent>
			</Tooltip>
			<CopyMessageButton text={messageText} />
			<CreateNoteButton messageText={messageText} onPlusAction={onPlusAction} />
			{timestamp ? (
				<span className="px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
		</div>
	);
}

function UserMessageActions({
	isPendingDelete,
	messageId,
	messageText,
	mentions,
	onDeleteClick,
	onDeleteMessage,
	onEditMessage,
	setMessageIdPendingDelete,
	timestamp,
}: {
	isPendingDelete: boolean;
	messageId: string;
	messageText: string;
	mentions: ChatComposerMention[];
	onDeleteClick: (messageId: string) => void;
	onDeleteMessage?: (messageId: string) => void;
	onEditMessage?: (
		messageId: string,
		text: string,
		mentions: ChatComposerMention[],
	) => void;
	setMessageIdPendingDelete: React.Dispatch<
		React.SetStateAction<string | null>
	>;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn(
				"mt-2 flex justify-end gap-1",
				CHAT_ACTIONS_VISIBILITY_CLASS,
			)}
		>
			{timestamp ? (
				<span className="self-center px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
			{messageText ? (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="size-7 text-muted-foreground hover:text-foreground"
								aria-label="Edit"
								onClick={() =>
									onEditMessage?.(messageId, messageText, mentions)
								}
							>
								<PenLine className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Edit</TooltipContent>
					</Tooltip>
					<CopyMessageButton text={messageText} />
				</>
			) : null}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={cn(
							"size-7 text-muted-foreground hover:text-foreground",
							isPendingDelete &&
								"text-destructive hover:bg-destructive/10 hover:text-destructive dark:text-red-500",
						)}
						aria-label="Delete"
						disabled={!onDeleteMessage}
						onClick={() => onDeleteClick(messageId)}
						onMouseLeave={() => {
							if (isPendingDelete) {
								setMessageIdPendingDelete(null);
							}
						}}
					>
						{isPendingDelete ? (
							<Check className="size-3.5" />
						) : (
							<Trash2 className="size-3.5" />
						)}
					</Button>
				</TooltipTrigger>
				{isPendingDelete ? null : <TooltipContent>Delete</TooltipContent>}
			</Tooltip>
		</div>
	);
}

function CopyMessageButton({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="size-7 text-muted-foreground hover:text-foreground"
					aria-label="Copy"
					onClick={() => {
						void navigator.clipboard
							.writeText(text)
							.then(() => toast.success("Copied"))
							.catch(() => toast.error("Failed to copy"));
					}}
				>
					<Copy className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Copy</TooltipContent>
		</Tooltip>
	);
}

function CreateNoteButton({
	messageText,
	onPlusAction,
}: {
	messageText: string;
	onPlusAction?: ChatMessagesActionProps["onPlusAction"];
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="size-7 text-muted-foreground hover:text-foreground"
					aria-label="Create note"
					disabled={!onPlusAction}
					onClick={() => {
						if (!onPlusAction) {
							return;
						}
						void Promise.resolve(onPlusAction(messageText))
							.then((result) => {
								if (result === "created") {
									toast.success("Note created");
								}
							})
							.catch(() => toast.error("Failed to create note"));
					}}
				>
					<Plus className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Create note</TooltipContent>
		</Tooltip>
	);
}
