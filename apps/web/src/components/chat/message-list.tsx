import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { Paperclip, X } from "lucide-react";
import * as React from "react";
import { ShimmerText } from "@/components/ai-elements/shimmer";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
import { CollapsibleMessageContent } from "@/components/chat/collapsible-message-content";
import {
	ASSISTANT_CHAT_CONTENT_CLASS,
	CHAT_MESSAGE_MAX_WIDTH_CLASS,
	getChatMessageJustifyClass,
	USER_CHAT_BUBBLE_CLASS,
} from "@/components/chat/message-layout";
import { ChatRecipeReceipt } from "@/components/chat/recipe-receipt";
import {
	extractFileParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";
import { collectMessageSources } from "@/lib/chat-sources";
import {
	formatChatMessageTimestamp,
	getChatMessageTimestamp,
} from "@/lib/chat-timestamp";
import {
	getLastAssistantHasRenderableContent,
	groupMessagesIntoTurns,
} from "@/lib/chat-turns";

export type ChatMessageActionContext = {
	displayText: string;
	message: UIMessage;
	messageText: string;
	timestamp: string | null;
};

export function ChatMessageListContent({
	messages,
	error,
	isLoading,
	className,
	turnClassName,
	messageStackClassName,
	textContainerClassName,
	streamdownClassName,
	breathingSpaceClassName = "min-h-[max(140px,24vh)] w-full",
	errorClassName,
	includeSources = true,
	renderAssistantActions,
	renderUserActions,
}: {
	messages: UIMessage[];
	error?: Error;
	isLoading?: boolean;
	className?: string;
	turnClassName?: (isLastTurn: boolean) => string;
	messageStackClassName?: string;
	textContainerClassName?: string;
	streamdownClassName?:
		| string
		| ((role: UIMessage["role"]) => string | undefined);
	breathingSpaceClassName?: string;
	errorClassName?: string;
	includeSources?: boolean;
	renderAssistantActions?: (
		context: ChatMessageActionContext,
	) => React.ReactNode;
	renderUserActions?: (context: ChatMessageActionContext) => React.ReactNode;
}) {
	const displayMessages = React.useMemo(() => {
		const lastMessage = messages[messages.length - 1];

		if (!isLoading || lastMessage?.role === "assistant") {
			return messages;
		}

		return [
			...messages,
			{
				id: "pending-assistant-message",
				role: "assistant" as const,
				parts: [],
			},
		];
	}, [isLoading, messages]);
	const lastMessage = displayMessages[displayMessages.length - 1];
	const turns = React.useMemo(
		() => groupMessagesIntoTurns(displayMessages),
		[displayMessages],
	);
	const showAssistantBreathingSpace =
		isLoading ||
		(lastMessage?.role === "assistant" &&
			getLastAssistantHasRenderableContent(
				displayMessages,
				(message) =>
					getChatText(message).length > 0 ||
					extractFileParts(message).length > 0 ||
					(includeSources && collectMessageSources(message).length > 0),
			));

	return (
		<div className={className}>
			{turns.map((turn, turnIndex) => {
				const isLastTurn = turnIndex === turns.length - 1;
				const turnKey = turn.userMessage?.id ?? `assistant-turn-${turnIndex}`;
				const turnMessages = [
					...(turn.userMessage ? [turn.userMessage] : []),
					...turn.assistantMessages,
				];

				return (
					<div key={turnKey} className={turnClassName?.(isLastTurn)}>
						{turnMessages.map((message) => (
							<ChatMessageListItem
								key={message.id}
								message={message}
								includeSources={includeSources}
								isLoading={isLoading}
								lastMessageId={lastMessage?.id}
								messageStackClassName={messageStackClassName}
								renderAssistantActions={renderAssistantActions}
								renderUserActions={renderUserActions}
								streamdownClassName={streamdownClassName}
								textContainerClassName={textContainerClassName}
							/>
						))}
					</div>
				);
			})}

			{showAssistantBreathingSpace ? (
				<div aria-hidden="true" className={breathingSpaceClassName} />
			) : null}

			{error ? (
				<p className={cn("text-sm text-destructive", errorClassName)}>
					{error.message}
				</p>
			) : null}
		</div>
	);
}

function ChatMessageListItem({
	message,
	includeSources,
	isLoading,
	lastMessageId,
	messageStackClassName,
	renderAssistantActions,
	renderUserActions,
	streamdownClassName,
	textContainerClassName,
}: {
	message: UIMessage;
	includeSources: boolean;
	isLoading?: boolean;
	lastMessageId?: string;
	messageStackClassName?: string;
	renderAssistantActions?: (
		context: ChatMessageActionContext,
	) => React.ReactNode;
	renderUserActions?: (context: ChatMessageActionContext) => React.ReactNode;
	streamdownClassName?:
		| string
		| ((role: UIMessage["role"]) => string | undefined);
	textContainerClassName?: string;
}) {
	const fileParts = extractFileParts(message);
	const metadata = getChatMessageMetadata(message);
	const selectedRecipe = metadata?.recipe ?? null;
	const displayText = metadata?.recipeOnly ? "" : getChatText(message);
	const messageText = metadata?.recipeOnly ? "" : getChatText(message);
	const messageSources =
		includeSources && message.role === "assistant"
			? collectMessageSources(message)
			: [];
	const isStreamingAssistantMessage =
		isLoading && message.role === "assistant" && message.id === lastMessageId;
	const isEmpty = displayText.length === 0;
	const timestamp = formatChatMessageTimestamp(
		getChatMessageTimestamp(message),
	);

	if (
		isEmpty &&
		fileParts.length === 0 &&
		!selectedRecipe &&
		!isStreamingAssistantMessage
	) {
		return null;
	}

	const actionContext = {
		displayText,
		message,
		messageText,
		timestamp,
	};

	return (
		<div
			data-chat-message-id={message.id}
			className={cn(
				"group/message flex w-full",
				getChatMessageJustifyClass(message.role),
			)}
		>
			<div
				className={cn(
					"flex flex-col",
					message.role === "user" ? "items-end" : "items-start",
					CHAT_MESSAGE_MAX_WIDTH_CLASS,
					messageStackClassName,
				)}
			>
				{selectedRecipe ? (
					<ChatRecipeReceipt
						isUserMessage={message.role === "user"}
						recipe={selectedRecipe}
					/>
				) : null}
				<ChatMessageFileAttachments files={fileParts} />
				<ChatMessageText
					displayText={displayText}
					isEmpty={isEmpty}
					isStreamingAssistantMessage={Boolean(isStreamingAssistantMessage)}
					role={message.role}
					streamdownClassName={streamdownClassName}
					textContainerClassName={textContainerClassName}
				/>
				{message.role === "assistant" && !isEmpty
					? renderAssistantActions?.(actionContext)
					: null}
				{message.role === "user" && (!isEmpty || selectedRecipe)
					? renderUserActions?.(actionContext)
					: null}
				{messageSources.length > 0 ? (
					<MessageSources messageId={message.id} sources={messageSources} />
				) : null}
			</div>
		</div>
	);
}

function ChatMessageText({
	displayText,
	isEmpty,
	isStreamingAssistantMessage,
	role,
	streamdownClassName,
	textContainerClassName,
}: {
	displayText: string;
	isEmpty: boolean;
	isStreamingAssistantMessage: boolean;
	role: UIMessage["role"];
	streamdownClassName?:
		| string
		| ((role: UIMessage["role"]) => string | undefined);
	textContainerClassName?: string;
}) {
	if (!isStreamingAssistantMessage && !displayText) {
		return null;
	}
	const resolvedStreamdownClassName =
		typeof streamdownClassName === "function"
			? streamdownClassName(role)
			: streamdownClassName;

	return (
		<div className={textContainerClassName}>
			<div
				className={cn(
					role === "user"
						? USER_CHAT_BUBBLE_CLASS
						: ASSISTANT_CHAT_CONTENT_CLASS,
					isStreamingAssistantMessage && isEmpty && "text-muted-foreground",
				)}
			>
				{isStreamingAssistantMessage && isEmpty ? (
					<div className="text-sm text-muted-foreground">
						<ShimmerText>Thinking</ShimmerText>
					</div>
				) : (
					<CollapsibleMessageContent
						role={role}
						text={displayText}
						isAnimating={isStreamingAssistantMessage}
						streamdownClassName={resolvedStreamdownClassName}
						mode={isStreamingAssistantMessage ? "streaming" : "static"}
					/>
				)}
			</div>
		</div>
	);
}

function MessageSources({
	messageId,
	sources,
}: {
	messageId: string;
	sources: ReturnType<typeof collectMessageSources>;
}) {
	return (
		<Sources defaultOpen={false} className="mt-1">
			<SourcesTrigger count={sources.length} />
			<SourcesContent>
				{sources.map((source) => (
					<Source
						key={`${messageId}:${source.href}`}
						href={source.href}
						title={source.title}
					/>
				))}
			</SourcesContent>
		</Sources>
	);
}

function ChatMessageFileAttachments({
	files,
}: {
	files: ReturnType<typeof extractFileParts>;
}) {
	const [previewImage, setPreviewImage] = React.useState<
		ReturnType<typeof extractFileParts>[number] | null
	>(null);

	if (files.length === 0) {
		return null;
	}

	return (
		<>
			<div className="mt-2 flex max-w-full flex-wrap gap-2 first:mt-0">
				{files.map((file) =>
					file.mediaType.startsWith("image/") ? (
						<button
							key={file.url}
							type="button"
							className="size-24 cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => setPreviewImage(file)}
						>
							<img
								src={file.url}
								alt={file.filename || "Attached image"}
								className="size-full object-cover"
							/>
						</button>
					) : (
						<button
							key={file.url}
							type="button"
							className="flex size-24 items-center justify-center rounded-md border border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<Paperclip className="size-5" />
							<span className="sr-only">
								{file.filename || "Attached file"}
							</span>
						</button>
					),
				)}
			</div>
			<Dialog
				open={previewImage !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPreviewImage(null);
					}
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="!top-0 !left-0 !flex !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 items-center justify-center !rounded-none !border-0 !bg-transparent p-10 !shadow-none !ring-0 sm:!max-w-none"
					style={
						{
							"--tw-enter-scale": "1",
							"--tw-exit-scale": "1",
						} as React.CSSProperties
					}
					onPointerDown={(event) => {
						if (event.target === event.currentTarget) {
							setPreviewImage(null);
						}
					}}
				>
					<DialogTitle className="sr-only">
						{previewImage?.filename || "Attached image preview"}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Image attachment preview.
					</DialogDescription>
					{previewImage ? (
						<img
							src={previewImage.url}
							alt={previewImage.filename || "Attached image preview"}
							className="max-h-full max-w-full object-contain shadow-2xl"
						/>
					) : null}
					<DialogClose className="absolute top-4 right-4 cursor-pointer rounded-full bg-background/90 p-2 text-foreground shadow-lg transition hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring">
						<X className="size-5" />
						<span className="sr-only">Close</span>
					</DialogClose>
				</DialogContent>
			</Dialog>
		</>
	);
}
