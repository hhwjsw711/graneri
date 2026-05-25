import { Button } from "@workspace/ui/components/button";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { Copy, PenLine, Plus, RotateCcw, Trash2 } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { CHAT_ACTIONS_VISIBILITY_CLASS } from "@/components/chat/message-layout";
import { ChatMessageListContent } from "@/components/chat/message-list";

export type NoteChatMessagesProps = {
	chatError: Error | undefined;
	chatMessages: UIMessage[];
	chatViewportRef: React.Ref<HTMLDivElement>;
	disableAddToNote: boolean;
	disablePadding: boolean;
	isChatLoading: boolean;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
	onDeleteMessage?: (messageId: string) => void;
	onEditMessage?: (messageId: string, text: string) => void;
	onRegenerateMessage?: (messageId: string) => void;
};

// react-doctor-disable-next-line deslop/unused-export
export default function NoteChatMessages({
	chatError,
	chatMessages,
	chatViewportRef,
	disableAddToNote,
	disablePadding,
	isChatLoading,
	onAddMessageToNote,
	onDeleteMessage,
	onEditMessage,
	onRegenerateMessage,
}: NoteChatMessagesProps) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			viewportClassName={cn(
				"flex min-h-full flex-col gap-4 pr-4 pb-2",
				disablePadding && "px-2",
			)}
			viewportRef={chatViewportRef}
		>
			<ChatMessageListContent
				breathingSpaceClassName="min-h-[max(112px,20vh)] w-full shrink-0"
				error={chatError}
				includeSources={false}
				isLoading={isChatLoading}
				messageStackClassName="gap-2"
				messages={chatMessages}
				streamdownClassName={
					disablePadding ? "note-chat-sidebar-streamdown" : undefined
				}
				textContainerClassName=""
				turnClassName={() => "flex flex-col gap-3"}
				renderAssistantActions={({ displayText, message, timestamp }) => (
					<NoteAssistantMessageActions
						disableAddToNote={disableAddToNote}
						displayText={displayText}
						messageId={message.id}
						onAddMessageToNote={onAddMessageToNote}
						onRegenerateMessage={onRegenerateMessage}
						timestamp={timestamp}
					/>
				)}
				renderUserActions={({ displayText, message, timestamp }) => (
					<NoteUserMessageActions
						displayText={displayText}
						messageId={message.id}
						onDeleteMessage={onDeleteMessage}
						onEditMessage={onEditMessage}
						timestamp={timestamp}
					/>
				)}
			/>
		</ScrollArea>
	);
}

function NoteAssistantMessageActions({
	disableAddToNote,
	displayText,
	messageId,
	onAddMessageToNote,
	onRegenerateMessage,
	timestamp,
}: {
	disableAddToNote: boolean;
	displayText: string;
	messageId: string;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
	onRegenerateMessage?: (messageId: string) => void;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn("flex items-center gap-1", CHAT_ACTIONS_VISIBILITY_CLASS)}
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
			<NoteCopyMessageButton text={displayText} />
			<NoteAddToNoteButton
				disabled={disableAddToNote}
				displayText={displayText}
				onAddMessageToNote={onAddMessageToNote}
			/>
			{timestamp ? (
				<span className="px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
		</div>
	);
}

function NoteUserMessageActions({
	displayText,
	messageId,
	onDeleteMessage,
	onEditMessage,
	timestamp,
}: {
	displayText: string;
	messageId: string;
	onDeleteMessage?: (messageId: string) => void;
	onEditMessage?: (messageId: string, text: string) => void;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn("flex justify-end gap-1", CHAT_ACTIONS_VISIBILITY_CLASS)}
		>
			{timestamp ? (
				<span className="self-center px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
			{displayText ? (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="size-7 text-muted-foreground hover:text-foreground"
								aria-label="Edit"
								onClick={() => onEditMessage?.(messageId, displayText)}
							>
								<PenLine className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Edit</TooltipContent>
					</Tooltip>
					<NoteCopyMessageButton text={displayText} />
				</>
			) : null}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-7 text-muted-foreground hover:text-foreground"
						aria-label="Delete"
						disabled={!onDeleteMessage}
						onClick={() => onDeleteMessage?.(messageId)}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Delete</TooltipContent>
			</Tooltip>
		</div>
	);
}

function NoteCopyMessageButton({ text }: { text: string }) {
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

function NoteAddToNoteButton({
	disabled,
	displayText,
	onAddMessageToNote,
}: {
	disabled: boolean;
	displayText: string;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="size-7 text-muted-foreground hover:text-foreground"
					disabled={disabled}
					aria-label="Add to note"
					onClick={() => {
						if (!onAddMessageToNote) {
							return;
						}

						void Promise.resolve(onAddMessageToNote(displayText)).catch(() =>
							toast.error("Failed to add"),
						);
					}}
				>
					<Plus className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Add to note</TooltipContent>
		</Tooltip>
	);
}
