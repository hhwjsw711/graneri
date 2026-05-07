import { useChat } from "@ai-sdk/react";
import { Button } from "@workspace/ui/components/button";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, FileText } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	type ChatAttachment,
	getReadyFileParts,
	hasUploadingAttachments,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/file-attachment-controls";
import type { AutomationListItem } from "@/components/automations/automation-types";
import {
	ChatSummarySheet,
	OPEN_CHAT_SUMMARY_EVENT,
} from "@/components/chat/chat-summary-sheet";
import { ChatMessages } from "@/components/chat/messages";
import type { ChatModel } from "@/components/chat/model-picker";
import { COMPOSER_DOCK_WRAPPER_CLASS } from "@/components/layout/composer-dock";
import { PageTitle } from "@/components/layout/page-title";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { useAppSources } from "@/hooks/use-app-sources";
import { useStickyScrollToBottom } from "@/hooks/use-sticky-scroll-to-bottom";
import { chatModels, defaultChatModel, findChatModel } from "@/lib/ai/models";
import { getChatId } from "@/lib/chat";
import { getChatText } from "@/lib/chat-message";
import { getUIMessageSeedKey, toStoredChatMessages } from "@/lib/chat-snapshot";
import { getMessagesBefore } from "@/lib/chat-thread";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ChatComposer } from "./chat-composer";
import { ChatHistoryList } from "./chat-history-list";

type ChatPageProps = {
	chatId: string;
	initialMessages: UIMessage[];
	isInitialMessagesLoading?: boolean;
	onChatPersisted?: (chatId: string) => void;
	chats: Array<Doc<"chats">>;
	isChatsLoading: boolean;
	activeChatId: string | null;
	onOpenChat: (chatId: string) => void;
	onPrefetchChat: (chatId: string) => void;
	onChatRemoved: (chatId: string) => void;
	isDesktopMac: boolean;
	onOpenConnectionsSettings: () => void;
	onCreateNoteFromResponse?: (
		title: string,
		content: string,
	) => Promise<"created" | undefined> | "created" | undefined;
	automations?: AutomationListItem[];
	onAddAutomation?: (chatId: string) => void;
};

const getLatestUserMessageText = (messages: UIMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];

		if (message?.role !== "user") {
			continue;
		}

		const text = getChatText(message);
		if (text) {
			return text;
		}
	}

	return "";
};

const getStoredChatModel = (model: string | undefined): ChatModel | null =>
	model ? (findChatModel(model) ?? null) : null;

const useChatPageController = ({
	chatId,
	initialMessages,
	onChatPersisted,
	chats,
	isChatsLoading,
}: Pick<
	ChatPageProps,
	"chatId" | "initialMessages" | "onChatPersisted" | "chats" | "isChatsLoading"
>) => {
	const activeWorkspaceId = useActiveWorkspaceId();
	const currentChat = React.useMemo(
		() => chats.find((chat) => getChatId(chat) === chatId) ?? null,
		[chats, chatId],
	);
	const [draft, setDraft] = React.useState("");
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	useRevokeAttachmentObjectUrls(attachedFiles);
	const [selectedModelOverride, setSelectedModelOverride] = React.useState<{
		chatId: string;
		model: ChatModel;
	} | null>(null);
	const [mentionPopoverOpen, setMentionPopoverOpen] = React.useState(false);
	const [documentSearchTerm, setDocumentSearchTerm] = React.useState("");
	const [mentions, setMentions] = React.useState<string[]>([]);
	const [modelPopoverOpen, setModelPopoverOpen] = React.useState(false);
	const [sourcesOpen, setSourcesOpen] = React.useState(false);
	const [summaryOpen, setSummaryOpen] = React.useState(false);
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
	const [appsEnabled, setAppsEnabled] = React.useState(true);
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	const [isPreparingRequest, setIsPreparingRequest] = React.useState(false);
	const [selectedSourceIds, setSelectedSourceIds] = React.useState<string[]>(
		[],
	);
	const notes = useQuery(
		api.notes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const appSources = useAppSources(activeWorkspaceId);
	React.useEffect(() => {
		void activeWorkspaceId;
		setSelectedSourceIds([]);
	}, [activeWorkspaceId]);
	const truncateFromMessage = useMutation(api.chats.truncateFromMessage);
	const persistChatModel = useMutation(api.chats.setModel);
	const storedMessages = useQuery(
		api.chats.getMessages,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const runningAutomationRun = useQuery(
		api.automations.getRunningRunForChat,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const transport = React.useMemo(
		() =>
			new DefaultChatTransport({
				api: "/api/chat",
				prepareSendMessagesRequest: ({
					id,
					messages,
					body,
					headers,
					credentials,
					trigger,
					messageId,
				}) => ({
					api: "/api/chat",
					headers,
					credentials,
					body: {
						...body,
						id,
						message: messages[messages.length - 1],
						trigger,
						messageId,
						workspaceId: activeWorkspaceId,
					},
				}),
			}),
		[activeWorkspaceId],
	);
	const {
		messages,
		setMessages,
		sendMessage,
		regenerate,
		error,
		status,
		stop,
	} = useChat({
		id: chatId,
		messages: initialMessages,
		transport,
	});
	const persistedMessages = React.useMemo(
		() =>
			storedMessages === undefined
				? initialMessages
				: toStoredChatMessages(storedMessages),
		[initialMessages, storedMessages],
	);

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);
	const persistedMessagesSeedKey = React.useMemo(
		() => getUIMessageSeedKey(persistedMessages),
		[persistedMessages],
	);
	const appliedPersistedMessagesSeedKeyRef = React.useRef(
		persistedMessagesSeedKey,
	);

	React.useEffect(() => {
		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);
			const isLocalRequestRunning =
				status === "submitted" || status === "streaming" || isPreparingRequest;
			const shouldUsePersistedMessages =
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedPersistedMessagesSeedKeyRef.current ||
				(!isLocalRequestRunning &&
					persistedMessages.length > currentMessages.length);

			if (shouldUsePersistedMessages) {
				appliedPersistedMessagesSeedKeyRef.current = persistedMessagesSeedKey;
				return persistedMessages;
			}

			return currentMessages;
		});
	}, [
		isPreparingRequest,
		persistedMessages,
		persistedMessagesSeedKey,
		setMessages,
		status,
	]);

	const isLocalChatLoading =
		status === "submitted" || status === "streaming" || isPreparingRequest;
	const isAutomationRunning = Boolean(runningAutomationRun);
	const isLoading = isLocalChatLoading || isAutomationRunning;
	const hasMessages = messages.length > 0 || isAutomationRunning;
	const isNotesLoading = notes === undefined;
	const selectedModel =
		(selectedModelOverride?.chatId === chatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(currentChat?.model) ??
		defaultChatModel ??
		chatModels[0];
	const isModelResolving = isChatsLoading && !currentChat;
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			setSelectedModelOverride({ chatId, model });

			if (!activeWorkspaceId || currentChat?.model === model.model) {
				return;
			}

			void persistChatModel({
				workspaceId: activeWorkspaceId,
				chatId,
				model: model.model,
			}).catch((error) => {
				console.error("Failed to persist chat model", error);
				toast.error("Failed to save model");
			});
		},
		[activeWorkspaceId, chatId, currentChat?.model, persistChatModel],
	);

	const contextPages = React.useMemo(
		() =>
			(notes ?? []).map((note) => ({
				id: note._id,
				title: getNoteDisplayTitle(note.title),
				icon: FileText,
				preview: note.searchableText.trim(),
				content: note.content,
				updatedAt: note.updatedAt,
			})),
		[notes],
	);
	const workspaceSources = React.useMemo(
		() =>
			contextPages.map((page) => ({
				id: page.id,
				title: page.title,
				preview: page.preview,
				content: page.content,
				updatedAt: page.updatedAt,
			})),
		[contextPages],
	);
	const shouldSearchDocuments = documentSearchTerm.trim().length > 0;
	const mentionableDocuments = React.useMemo(() => {
		const query = documentSearchTerm.trim().toLowerCase();

		if (!query) {
			return contextPages;
		}

		return contextPages.filter((page) =>
			[page.title, page.preview].join(" ").toLowerCase().includes(query),
		);
	}, [contextPages, documentSearchTerm]);

	const handleSubmit = React.useCallback(async () => {
		const value = draft.trim();

		if (
			(!value && attachedFiles.length === 0) ||
			hasUploadingAttachments(attachedFiles) ||
			isLoading
		) {
			return;
		}

		setIsPreparingRequest(true);

		try {
			const convexToken = await getCachedConvexToken();
			onChatPersisted?.(chatId);
			const readyFiles = getReadyFileParts(attachedFiles);
			const filePayload = readyFiles.length > 0 ? { files: readyFiles } : {};
			const nextOutgoingMessage = editingMessageId
				? {
						messageId: editingMessageId,
						text: value,
						...filePayload,
					}
				: { text: value, ...filePayload };

			void sendMessage(nextOutgoingMessage, {
				body: {
					model: selectedModel.model,
					webSearchEnabled,
					appsEnabled,
					mentions,
					selectedSourceIds,
					workspaceId: activeWorkspaceId,
					convexToken,
				},
			});
			setEditingMessageId(null);
			setDraft("");
			setAttachedFiles([]);
		} finally {
			setIsPreparingRequest(false);
		}
	}, [
		activeWorkspaceId,
		appsEnabled,
		attachedFiles,
		chatId,
		draft,
		editingMessageId,
		isLoading,
		mentions,
		onChatPersisted,
		selectedModel.model,
		selectedSourceIds,
		sendMessage,
		webSearchEnabled,
	]);

	const handleDraftKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (
				event.key !== "Enter" ||
				event.shiftKey ||
				event.nativeEvent.isComposing
			) {
				return;
			}

			event.preventDefault();
			void handleSubmit();
		},
		[handleSubmit],
	);

	const handleWebSearchEnabledChange = React.useCallback((enabled: boolean) => {
		setWebSearchEnabled(enabled);
	}, []);

	const handleEditMessage = React.useCallback(
		(messageId: string, text: string) => {
			if (isLoading) {
				stop();
			}

			setEditingMessageId(messageId);
			setDraft(text);
			setAttachedFiles([]);
		},
		[isLoading, stop],
	);

	const handleCancelEdit = React.useCallback(() => {
		setEditingMessageId(null);
		setDraft("");
		setAttachedFiles([]);
	}, []);

	const buildRequestBody = React.useCallback(async () => {
		const convexToken = await getCachedConvexToken();

		return {
			model: selectedModel.model,
			webSearchEnabled,
			appsEnabled,
			mentions,
			selectedSourceIds,
			workspaceId: activeWorkspaceId,
			convexToken,
		};
	}, [
		activeWorkspaceId,
		appsEnabled,
		mentions,
		selectedModel.model,
		selectedSourceIds,
		webSearchEnabled,
	]);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			if (isLoading) {
				stop();
			}

			setMessages((currentMessages) =>
				getMessagesBefore(currentMessages, messageId),
			);
			setEditingMessageId(null);
			setDraft("");

			if (!activeWorkspaceId) {
				return;
			}

			void truncateFromMessage({
				workspaceId: activeWorkspaceId,
				chatId,
				messageId,
			}).catch((error) => {
				console.error("Failed to delete message", error);
				toast.error("Failed to delete message");
			});
		},
		[
			activeWorkspaceId,
			chatId,
			isLoading,
			setMessages,
			stop,
			truncateFromMessage,
		],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (isLoading) {
				stop();
			}

			setIsPreparingRequest(true);

			try {
				const requestBody = await buildRequestBody();
				setEditingMessageId(null);
				setDraft("");
				void regenerate({
					messageId: assistantMessageId,
					body: requestBody,
				});
			} finally {
				setIsPreparingRequest(false);
			}
		},
		[buildRequestBody, isLoading, regenerate, stop],
	);

	return {
		appsEnabled,
		contextPages,
		currentChatTitle: currentChat?.title ?? "",
		draft,
		error,
		handleClearSelectedSources: () => setSelectedSourceIds([]),
		attachedFiles,
		setAttachedFiles,
		handleDraftKeyDown,
		handleSubmit,
		handleWebSearchEnabledChange,
		hasMessages,
		isLoading,
		isNotesLoading,
		mentionPopoverOpen,
		mentionableDocuments,
		messages,
		modelPopoverOpen,
		selectedModel: isModelResolving ? null : selectedModel,
		selectedSourceIds,
		setAppsEnabled,
		setDocumentSearchTerm,
		setDraft,
		setMentionPopoverOpen,
		setMentions,
		setModelPopoverOpen,
		setSelectedModel: handleSelectedModelChange,
		setSourcesOpen,
		setSummaryOpen,
		stop,
		shouldSearchDocuments,
		sourcesOpen,
		summaryOpen,
		webSearchEnabled,
		workspaceSources,
		appSources,
		documentSearchTerm,
		editingMessageId,
		mentions,
		handleCancelEdit,
		onDeleteMessage: handleDeleteMessage,
		onAddMention: (pageId: string) => {
			setMentions((current) =>
				current.includes(pageId) ? current : [...current, pageId],
			);
			setDocumentSearchTerm("");
			setMentionPopoverOpen(false);
		},
		onRemoveMention: (pageId: string) => {
			setMentions((current) => current.filter((id) => id !== pageId));
		},
		onAddSource: (sourceId: string) => {
			setSelectedSourceIds((current) => {
				if (current.includes(sourceId)) {
					return current;
				}

				return [...current, sourceId];
			});
		},
		onRemoveAutoAddedSource: (sourceId: string) => {
			setSelectedSourceIds((current) =>
				current.includes(sourceId)
					? current.filter((id) => id !== sourceId)
					: current,
			);
		},
		onToggleSource: (sourceId: string) => {
			setSelectedSourceIds((current) => {
				if (sourceId.startsWith("app:")) {
					return current.includes(sourceId)
						? current.filter((id) => id !== sourceId)
						: [...current, sourceId];
				}

				return current.includes(sourceId)
					? current.filter((id) => id !== sourceId)
					: [...current, sourceId];
			});
		},
		onEditMessage: handleEditMessage,
		onRegenerateMessage: handleRegenerateMessage,
	};
};

export function ChatPage({
	chatId,
	initialMessages,
	onChatPersisted,
	chats,
	isChatsLoading,
	activeChatId,
	onOpenChat,
	onPrefetchChat,
	onChatRemoved,
	isDesktopMac,
	onOpenConnectionsSettings,
	onCreateNoteFromResponse,
	automations,
	onAddAutomation,
}: ChatPageProps) {
	const controller = useChatPageController({
		chatId,
		initialMessages,
		onChatPersisted,
		chats,
		isChatsLoading,
	});
	const {
		containerRef,
		isAtBottom: isChatViewportAtBottom,
		scrollToBottom: scrollChatToBottom,
	} = useStickyScrollToBottom();
	const handleCreateNoteFromResponse = React.useCallback(
		(content: string) => {
			if (!onCreateNoteFromResponse) {
				return undefined;
			}

			const title =
				controller.currentChatTitle.trim() ||
				getLatestUserMessageText(controller.messages) ||
				"New note";

			return onCreateNoteFromResponse(title, content);
		},
		[
			controller.currentChatTitle,
			controller.messages,
			onCreateNoteFromResponse,
		],
	);
	const shouldShowActiveChatSurface =
		controller.hasMessages || activeChatId === chatId;
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const currentAutomation = React.useMemo(
		() =>
			(automations ?? []).find((automation) => automation.chatId === chatId) ??
			null,
		[automations, chatId],
	);
	React.useEffect(() => {
		const handleOpenSummary = () => {
			controller.setSummaryOpen((current) => !current);
		};

		window.addEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);

		return () => {
			window.removeEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);
		};
	}, [controller.setSummaryOpen]);
	// Web chat uses a 4rem shell header, while the native mac shell keeps a
	// taller md offset. Matching the shell height keeps short-chat docks flush.
	const chatSurfaceMinHeightClass = isDesktopMac
		? "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-5rem)]"
		: "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-4rem)]";
	const composer = (
		<ChatComposer
			useCompactLayout={shouldShowActiveChatSurface}
			draft={controller.draft}
			topAccessory={
				controller.hasMessages && !isChatViewportAtBottom ? (
					<Button
						type="button"
						variant="secondary"
						size="icon"
						className="size-9 rounded-full border border-border/60 shadow-md"
						onClick={() => scrollChatToBottom()}
						aria-label="Scroll to latest messages"
					>
						<ArrowDown className="size-4" />
					</Button>
				) : undefined
			}
			onDraftChange={controller.setDraft}
			onDraftKeyDown={controller.handleDraftKeyDown}
			onSubmit={controller.handleSubmit}
			onStop={controller.stop}
			attachedFiles={controller.attachedFiles}
			onAttachedFilesChange={controller.setAttachedFiles}
			isLoading={controller.isLoading}
			selectedModel={controller.selectedModel}
			modelPopoverOpen={controller.modelPopoverOpen}
			onModelPopoverOpenChange={controller.setModelPopoverOpen}
			onSelectedModelChange={controller.setSelectedModel}
			mentionPopoverOpen={controller.mentionPopoverOpen}
			onMentionPopoverOpenChange={controller.setMentionPopoverOpen}
			documentSearchTerm={controller.documentSearchTerm}
			onDocumentSearchTermChange={controller.setDocumentSearchTerm}
			mentions={controller.mentions}
			contextPages={controller.contextPages}
			mentionableDocuments={controller.mentionableDocuments}
			isNotesLoading={controller.isNotesLoading}
			emptyStateMessage={
				controller.shouldSearchDocuments
					? "No notes found."
					: "No notes available."
			}
			shouldSearchDocuments={controller.shouldSearchDocuments}
			onAddMention={controller.onAddMention}
			onRemoveMention={controller.onRemoveMention}
			sourcesOpen={controller.sourcesOpen}
			onSourcesOpenChange={controller.setSourcesOpen}
			webSearchEnabled={controller.webSearchEnabled}
			onWebSearchEnabledChange={controller.handleWebSearchEnabledChange}
			appsEnabled={controller.appsEnabled}
			onAppsEnabledChange={controller.setAppsEnabled}
			selectedSourceIds={controller.selectedSourceIds}
			appSources={controller.appSources}
			onToggleSource={controller.onToggleSource}
			onClearSelectedSources={controller.handleClearSelectedSources}
			onOpenConnectionsSettings={onOpenConnectionsSettings}
			editingMessageId={controller.editingMessageId}
			onCancelEdit={controller.handleCancelEdit}
		/>
	);

	return (
		<>
			<ScrollArea
				className="min-h-0 flex-1"
				viewportClassName="overscroll-contain"
				viewportRef={controller.hasMessages ? containerRef : undefined}
			>
				<div className="box-border flex w-full max-w-full min-w-0 flex-1 justify-center px-4 md:px-6">
					<div
						className={cn(
							"flex min-h-0 w-full min-w-0 max-w-5xl flex-1 flex-col",
							isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
						)}
					>
						{shouldShowActiveChatSurface ? (
							<div
								className={cn(
									"relative mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col md:max-w-xl",
									chatSurfaceMinHeightClass,
								)}
							>
								<div className="flex-1 pt-8 pb-28 md:pb-32">
									<ChatMessages
										messages={controller.messages}
										error={controller.error}
										isLoading={controller.isLoading}
										onDeleteMessage={controller.onDeleteMessage}
										onEditMessage={controller.onEditMessage}
										onPlusAction={handleCreateNoteFromResponse}
										onRegenerateMessage={controller.onRegenerateMessage}
									/>
								</div>

								<div className="sticky bottom-0 z-10 mt-auto h-0">
									<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
										<div className="pointer-events-auto relative mx-auto w-[calc(100%-2rem)] min-w-0 max-w-full md:w-full md:max-w-xl">
											{composer}
										</div>
									</div>
								</div>
							</div>
						) : (
							<div
								className={cn(
									"mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col md:max-w-xl",
									chatSurfaceMinHeightClass,
								)}
							>
								<div className="flex flex-1 flex-col gap-6 pb-8">
									<PageTitle isDesktopMac={isDesktopMac} className="w-full">
										Ask anything
									</PageTitle>

									{composer}

									<div className="min-h-0 flex-1">
										<ChatHistoryList
											chats={chats}
											isChatsLoading={isChatsLoading}
											activeChatId={activeChatId}
											onOpenChat={onOpenChat}
											onPrefetchChat={onPrefetchChat}
											onMoveToTrash={onChatRemoved}
											automationChatIds={automationChatIds}
											onAddAutomation={onAddAutomation}
										/>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</ScrollArea>
			<ChatSummarySheet
				open={controller.summaryOpen}
				messages={controller.messages}
				automation={currentAutomation}
				chatTitle={controller.currentChatTitle}
				desktopSafeTop={isDesktopMac}
				workspaceSources={controller.workspaceSources}
				onAddSource={controller.onAddSource}
				onRemoveAutoAddedSource={controller.onRemoveAutoAddedSource}
				onOpenChange={controller.setSummaryOpen}
			/>
		</>
	);
}
