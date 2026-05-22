import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { FileText, Paperclip, X } from "lucide-react";
import * as React from "react";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { ShimmerText } from "@/components/ai-elements/shimmer";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
import { ToolGroup } from "@/components/ai-elements/tools/tool-group";
import { toToolPartLike } from "@/components/ai-elements/tools/tool-part-like";
import { getToolMeta } from "@/components/ai-elements/tools/tool-registry";
import { ToolRenderer } from "@/components/ai-elements/tools/tool-renderer";
import { AppSourceIcon } from "@/components/app-source-icon";
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
	extractGeneratedArtifacts,
	extractReasoningParts,
	extractToolParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";
import {
	CHAT_APP_SOURCE_PROVIDERS,
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import { collectMessageSources } from "@/lib/chat-sources";
import {
	formatChatMessageTimestamp,
	getChatMessageTimestamp,
} from "@/lib/chat-timestamp";
import {
	getLastAssistantHasRenderableContent,
	groupMessagesIntoTurns,
} from "@/lib/chat-turns";
import { getMentionProvider } from "@/lib/tiptap-mention";

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
	onOpenMention,
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
	onOpenMention?: (noteId: string) => void;
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
					extractReasoningParts(message).length > 0 ||
					extractToolParts(message).length > 0 ||
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
								onOpenMention={onOpenMention}
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
	onOpenMention,
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
	onOpenMention?: (noteId: string) => void;
	streamdownClassName?:
		| string
		| ((role: UIMessage["role"]) => string | undefined);
	textContainerClassName?: string;
}) {
	const fileParts = extractFileParts(message);
	const generatedArtifacts =
		message.role === "assistant" ? extractGeneratedArtifacts(message) : [];
	const toolParts =
		message.role === "assistant" ? extractToolParts(message) : [];
	const reasoningParts =
		message.role === "assistant" ? extractReasoningParts(message) : [];
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
		generatedArtifacts.length === 0 &&
		reasoningParts.length === 0 &&
		toolParts.length === 0 &&
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
				{selectedRecipe ? <ChatRecipeReceipt recipe={selectedRecipe} /> : null}
				<ChatMessageFileAttachments files={fileParts} />
				<ChatMessageGeneratedArtifacts artifacts={generatedArtifacts} />
				<ChatMessageToolCalls
					parts={toolParts}
					chatStatus={isStreamingAssistantMessage ? "streaming" : "ready"}
				/>
				<ChatMessageReasoning
					parts={reasoningParts}
					isStreamingAssistantMessage={Boolean(isStreamingAssistantMessage)}
				/>
				<ChatMessageText
					displayText={displayText}
					isEmpty={isEmpty}
					isStreamingAssistantMessage={Boolean(isStreamingAssistantMessage)}
					mentionPositions={metadata?.mentionPositions}
					onOpenMention={onOpenMention}
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

function ChatMessageReasoning({
	isStreamingAssistantMessage,
	parts,
}: {
	isStreamingAssistantMessage: boolean;
	parts: UIMessage["parts"];
}) {
	if (parts.length === 0) {
		return null;
	}

	return (
		<div className="mb-3 flex w-full flex-col gap-2 first:mt-0">
			{parts.map((part) => {
				if (part.type !== "reasoning") {
					return null;
				}

				return (
					<Reasoning
						key={getReasoningPartKey(part)}
						text={part.text}
						isStreaming={isStreamingAssistantMessage && part.state !== "done"}
					/>
				);
			})}
		</div>
	);
}

const getReasoningPartKey = (
	part: Extract<UIMessage["parts"][number], { type: "reasoning" }>,
) => `reasoning:${part.text || part.state || "empty"}`;

function ChatMessageToolCalls({
	chatStatus,
	parts,
}: {
	chatStatus: "streaming" | "ready";
	parts: UIMessage["parts"];
}) {
	if (parts.length === 0) {
		return null;
	}

	const groups = groupAdjacentToolParts(parts);

	return (
		<div className="mb-3 flex w-full flex-col gap-2 first:mt-0">
			{groups.map((group) =>
				group.groupLabel ? (
					<ToolGroup
						key={group.key}
						parts={group.parts}
						chatStatus={chatStatus}
					/>
				) : (
					<ToolRenderer
						key={group.key}
						part={group.parts[0]}
						chatStatus={chatStatus}
					/>
				),
			)}
		</div>
	);
}

const getToolGroupInfo = (part: UIMessage["parts"][number]) => {
	const meta = getToolMeta(toToolPartLike(part));
	const groupKey = meta?.groupKey;

	if (groupKey?.startsWith("mcp:")) {
		return {
			key: groupKey,
			label: meta?.groupLabel ?? "MCP",
		};
	}

	if (groupKey === "search") {
		return {
			key: "search",
			label: "Search",
		};
	}

	if (groupKey === "image") {
		return {
			key: "image",
			label: "Image",
		};
	}

	if (groupKey === "local-folder") {
		return {
			key: "local-folder",
			label: "Local folder",
		};
	}

	if (groupKey === "automation") {
		return {
			key: "automation",
			label: "Automation",
		};
	}

	return null;
};

const groupAdjacentToolParts = (parts: UIMessage["parts"]) => {
	const groups: Array<{
		groupKey: string;
		groupLabel: string | null;
		key: string;
		parts: UIMessage["parts"];
	}> = [];

	for (const part of parts) {
		const groupInfo = getToolGroupInfo(part);
		const key = groupInfo?.key ?? `${part.type}:${groups.length}`;
		const previousGroup = groups[groups.length - 1];

		if (groupInfo && previousGroup?.groupKey === key) {
			previousGroup.parts.push(part);
			continue;
		}

		groups.push({
			groupKey: key,
			groupLabel: groupInfo?.label ?? null,
			key:
				"toolCallId" in part && typeof part.toolCallId === "string"
					? `${key}:${part.toolCallId}`
					: `${key}:${part.type}`,
			parts: [part],
		});
	}

	return groups;
};

function ChatMessageText({
	displayText,
	isEmpty,
	isStreamingAssistantMessage,
	mentionPositions,
	onOpenMention,
	role,
	streamdownClassName,
	textContainerClassName,
}: {
	displayText: string;
	isEmpty: boolean;
	isStreamingAssistantMessage: boolean;
	mentionPositions?: Array<{
		id: string;
		label: string;
		from: number;
		to: number;
		type?: "note" | "tool";
		provider?: ChatAppSourceProvider;
	}>;
	onOpenMention?: (noteId: string) => void;
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
				) : role === "user" && mentionPositions?.length ? (
					<UserMessageWithMentions
						text={displayText}
						mentionPositions={mentionPositions}
						onOpenMention={onOpenMention}
					/>
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

function UserMessageWithMentions({
	text,
	mentionPositions,
	onOpenMention,
}: {
	text: string;
	mentionPositions: Array<{
		id: string;
		label: string;
		from: number;
		to: number;
		type?: "note" | "tool";
	}>;
	onOpenMention?: (noteId: string) => void;
}) {
	const parts: React.ReactNode[] = [];
	let cursor = 0;
	const sortedMentions = [...mentionPositions]
		.filter(
			(mention) =>
				Number.isInteger(mention.from) &&
				Number.isInteger(mention.to) &&
				mention.from >= 0 &&
				mention.to > mention.from &&
				mention.from <= text.length,
		)
		.sort((a, b) => a.from - b.from);

	for (const mention of sortedMentions) {
		if (mention.from < cursor) {
			continue;
		}

		if (mention.from > cursor) {
			parts.push(text.slice(cursor, mention.from));
		}

		const isToolMention =
			mention.type === "tool" || mention.id.startsWith("app:");
		const provider = getRenderedToolMentionProvider(mention);
		parts.push(
			isToolMention ? (
				<span
					key={`${mention.id}:${mention.from}`}
					className="inline-tool-mention"
					data-mention-id={mention.id}
					data-mention-type="tool"
					data-mention-provider={provider}
				>
					<span
						aria-hidden="true"
						className="inline-tool-mention-icon"
						data-provider={provider}
					>
						{provider ? (
							<AppSourceIcon
								provider={provider}
								className="inline-tool-mention-svg"
							/>
						) : null}
					</span>
					<span className="inline-tool-mention-label">{mention.label}</span>
				</span>
			) : (
				<span
					key={`${mention.id}:${mention.from}`}
					className="inline cursor-pointer align-baseline whitespace-nowrap text-inherit"
				>
					<FileText
						aria-hidden="true"
						className="mr-1 inline size-4 align-[-0.125em] text-blue-400"
					/>
					{onOpenMention ? (
						<button
							type="button"
							className="inline cursor-pointer bg-transparent p-0 text-left align-baseline font-medium text-blue-400 decoration-blue-300/80 decoration-dotted underline-offset-4 hover:underline"
							onClick={() => onOpenMention(mention.id)}
						>
							{mention.label}
						</button>
					) : (
						<span className="cursor-pointer font-medium text-blue-400 decoration-blue-300/80 decoration-dotted underline-offset-4 hover:underline">
							{mention.label}
						</span>
					)}
				</span>
			),
		);
		cursor = Math.min(mention.to, text.length);
	}

	if (cursor < text.length) {
		parts.push(text.slice(cursor));
	}

	return <div className="whitespace-pre-wrap break-words">{parts}</div>;
}

function getRenderedToolMentionProvider({
	label,
	provider,
}: {
	label: string;
	provider?: ChatAppSourceProvider;
}) {
	const explicitProvider = getMentionProvider(provider);
	if (explicitProvider) {
		return explicitProvider;
	}

	return (
		CHAT_APP_SOURCE_PROVIDERS.find(
			(sourceProvider) => label === getAppSourceLabel(sourceProvider),
		) ?? null
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

function ChatMessageGeneratedArtifacts({
	artifacts,
}: {
	artifacts: ReturnType<typeof extractGeneratedArtifacts>;
}) {
	const [previewImage, setPreviewImage] = React.useState<
		ReturnType<typeof extractGeneratedArtifacts>[number] | null
	>(null);

	if (artifacts.length === 0) {
		return null;
	}

	return (
		<>
			<div className="mb-3 flex max-w-full flex-wrap gap-2 first:mt-0">
				{artifacts.map((artifact) =>
					artifact.mediaType.startsWith("image/") ? (
						<button
							key={artifact.url}
							type="button"
							className="size-24 cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => setPreviewImage(artifact)}
						>
							<img
								src={artifact.url}
								alt={artifact.filename || "Generated image"}
								className="size-full object-cover"
							/>
						</button>
					) : (
						<a
							key={artifact.url}
							href={artifact.url}
							target="_blank"
							rel="noreferrer"
							className="flex h-10 max-w-full items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<Paperclip className="size-4 shrink-0" />
							<span className="min-w-0 truncate">
								{artifact.filename || "Generated file"}
							</span>
						</a>
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
						{previewImage?.filename || "Generated image preview"}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Generated image preview.
					</DialogDescription>
					{previewImage ? (
						<img
							src={previewImage.url}
							alt={previewImage.filename || "Generated image preview"}
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
