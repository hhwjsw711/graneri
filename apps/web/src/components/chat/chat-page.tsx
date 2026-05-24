import { useChat } from "@ai-sdk/react";
import { isDesktopRuntime } from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowDown,
	ChevronDown,
	ChevronUp,
	FileText,
	Search,
	X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	type ChatAttachment,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/file-attachment-controls";
import {
	getReadyFileParts,
	hasUploadingAttachments,
} from "@/components/ai-elements/file-attachment-utils";
import type { AutomationListItem } from "@/components/automations/automation-types";
import {
	type ChatSummaryOpenSourceRequest,
	ChatSummarySheet,
	OPEN_CHAT_SUMMARY_EVENT,
} from "@/components/chat/chat-summary-sheet";
import { ChatMessages } from "@/components/chat/messages";
import type {
	ChatModel,
	ReasoningEffort,
} from "@/components/chat/model-picker";
import { COMPOSER_DOCK_WRAPPER_CLASS } from "@/components/layout/composer-dock";
import { PageTitle } from "@/components/layout/page-title";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { useAppSources } from "@/hooks/use-app-sources";
import { useStickyScrollToBottom } from "@/hooks/use-sticky-scroll-to-bottom";
import {
	getStoredChatModel as getStoredLocalChatModel,
	storeChatModel,
} from "@/lib/ai/chat-model";
import {
	chatModels,
	findChatModel,
	findReasoningEffort,
} from "@/lib/ai/models";
import {
	getStoredReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import { getChatId } from "@/lib/chat";
import { stopActiveChatStream } from "@/lib/chat-active-stream";
import { getChatText } from "@/lib/chat-message";
import { getUIMessageSeedKey, toStoredChatMessages } from "@/lib/chat-snapshot";
import { getMessagesBefore } from "@/lib/chat-thread";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { ensureCssHighlightStyles } from "@/lib/css-highlight-styles";
import {
	loadStoredSharedLocalFolders,
	rehydrateSharedLocalFolders,
	shareLocalFoldersFromText,
	storeSharedLocalFolders,
} from "@/lib/local-folder-sharing";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { getChatApiUrl } from "@/lib/runtime-config";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ChatComposer, type ChatComposerMention } from "./chat-composer";
import { ChatHistoryList } from "./chat-history-list";

type ChatPageProps = {
	chatId: string;
	initialMessages: UIMessage[];
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

const getStoredChatReasoningEffort = (
	reasoningEffort: string | undefined,
): ReasoningEffort | null =>
	reasoningEffort ? (findReasoningEffort(reasoningEffort)?.id ?? null) : null;

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getMentionRequestContext = (
	mentions: ChatComposerMention[],
	selectedSourceIds: string[],
) => {
	const noteMentionIds: string[] = [];
	const toolMentionIds: string[] = [];

	for (const mention of mentions) {
		if (mention.type === "tool" || mention.id.startsWith("app:")) {
			toolMentionIds.push(mention.id);
			continue;
		}

		noteMentionIds.push(mention.id);
	}

	return {
		mentionIds: [...new Set(noteMentionIds)],
		requestSelectedSourceIds: [
			...new Set([...selectedSourceIds, ...toolMentionIds]),
		],
	};
};

const getChatSearchMatches = (messages: UIMessage[], query: string) => {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	const matches: Array<{ messageId: string; text: string }> = [];
	const matcher = new RegExp(escapeRegExp(normalizedQuery), "u");
	for (const message of messages) {
		const text = getChatText(message);
		if (matcher.test(text.toLocaleLowerCase())) {
			matches.push({ messageId: message.id, text });
		}
	}

	return matches;
};

type CssHighlightRegistry = {
	set: (name: string, highlight: Highlight) => void;
	delete: (name: string) => void;
};

type CssWithHighlights = typeof CSS & {
	highlights?: CssHighlightRegistry;
};

type MessageSearchState = {
	open: boolean;
	query: string;
	index: number;
};

type MessageSearchAction =
	| { type: "close" }
	| { type: "open" }
	| { type: "setQuery"; query: string }
	| { type: "setIndex"; index: number };

const messageSearchReducer = (
	state: MessageSearchState,
	action: MessageSearchAction,
): MessageSearchState => {
	if (action.type === "open") {
		return { ...state, open: true };
	}

	if (action.type === "close") {
		return { open: false, query: "", index: 0 };
	}

	if (action.type === "setQuery") {
		return { ...state, query: action.query, index: 0 };
	}

	return { ...state, index: action.index };
};

declare const Highlight: (new (...ranges: Range[]) => Highlight) | undefined;
type Highlight = object;

const CHAT_SEARCH_MATCH_HIGHLIGHT = "chat-search-match";
const CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT = "chat-search-active-match";

const createTextMatchRanges = ({
	element,
	query,
}: {
	element: HTMLElement;
	query: string;
}) => {
	const ranges: Range[] = [];
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return ranges;
	}

	const matcher = new RegExp(escapeRegExp(normalizedQuery), "gu");
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let currentNode = walker.nextNode();

	while (currentNode) {
		const textNode = currentNode as Text;
		const normalizedText = textNode.data.toLocaleLowerCase();
		let match = matcher.exec(normalizedText);

		while (match) {
			const range = document.createRange();
			const searchIndex = match.index;
			range.setStart(textNode, searchIndex);
			range.setEnd(textNode, searchIndex + normalizedQuery.length);
			ranges.push(range);
			match = matcher.exec(normalizedText);
		}

		matcher.lastIndex = 0;
		currentNode = walker.nextNode();
	}

	return ranges;
};

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
	const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
		getStoredReasoningEffort,
	);
	const [mentions, setMentions] = React.useState<ChatComposerMention[]>([]);
	const [modelPopoverOpen, setModelPopoverOpen] = React.useState(false);
	const [sourcesOpen, setSourcesOpen] = React.useState(false);
	const [summaryOpen, setSummaryOpen] = React.useState(false);
	const [summaryOpenSourceRequest, setSummaryOpenSourceRequest] =
		React.useState<ChatSummaryOpenSourceRequest | null>(null);
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
	const [appsEnabled, setAppsEnabled] = React.useState(true);
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	const [isPreparingRequest, setIsPreparingRequest] = React.useState(false);
	const [sharedLocalFolders, setSharedLocalFolders] = React.useState<
		DesktopLocalFolder[]
	>([]);
	const localFolderStorageScope = `chat:${chatId}`;
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
	React.useEffect(() => {
		let isCurrent = true;
		const storedFolders = loadStoredSharedLocalFolders(localFolderStorageScope);
		setSharedLocalFolders(storedFolders);

		void rehydrateSharedLocalFolders(localFolderStorageScope).then(
			(folders) => {
				if (isCurrent) {
					setSharedLocalFolders(folders);
				}
			},
		);

		return () => {
			isCurrent = false;
		};
	}, [localFolderStorageScope]);
	const truncateFromMessage = useMutation(api.chats.truncateFromMessage);
	const persistChatSettings = useMutation(api.chats.setChatSettings);
	const storedMessages = useQuery(
		api.chats.getMessages,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const activeStreamStatus = useQuery(
		api.chats.getActiveStreamStatus,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const runningAutomationRun = useQuery(
		api.automations.getRunningRunForChat,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const activeStreamChatIds = useQuery(
		api.chats.listActiveStreamChatIds,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const transport = React.useMemo(() => {
		const chatApiUrl = getChatApiUrl();

		return new DefaultChatTransport({
			api: chatApiUrl,
			prepareSendMessagesRequest: ({
				id,
				messages,
				body,
				headers,
				credentials,
				trigger,
				messageId,
			}) => ({
				api: chatApiUrl,
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
		});
	}, [activeWorkspaceId]);
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
		experimental_throttle: 50,
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
		const isLocalRequestRunning =
			status === "submitted" || status === "streaming" || isPreparingRequest;

		if (isLocalRequestRunning) {
			return;
		}

		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);
			const shouldUsePersistedMessages =
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedPersistedMessagesSeedKeyRef.current ||
				persistedMessages.length > currentMessages.length;

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
	const isPersistedChatStreaming = activeStreamStatus === "streaming";
	const isAutomationRunning = Boolean(runningAutomationRun);
	const isLoading =
		isLocalChatLoading || isPersistedChatStreaming || isAutomationRunning;
	const hasMessages = messages.length > 0 || isAutomationRunning;
	const isNotesLoading = notes === undefined;
	const selectedModel =
		(selectedModelOverride?.chatId === chatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(currentChat?.model) ??
		getStoredLocalChatModel() ??
		chatModels[0];
	const selectedReasoningEffort =
		getStoredChatReasoningEffort(currentChat?.reasoningEffort) ??
		reasoningEffort;
	const isModelResolving = isChatsLoading && !currentChat;
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			setSelectedModelOverride({ chatId, model });
			storeChatModel(model);

			if (!activeWorkspaceId || currentChat?.model === model.model) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId,
				model: model.model,
			}).catch((error) => {
				console.error("Failed to persist chat model", error);
				toast.error("Failed to save model");
			});
		},
		[activeWorkspaceId, chatId, currentChat?.model, persistChatSettings],
	);
	const handleReasoningEffortChange = React.useCallback(
		(value: ReasoningEffort) => {
			setReasoningEffort(value);
			storeReasoningEffort(value);

			if (!activeWorkspaceId || currentChat?.reasoningEffort === value) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId,
				reasoningEffort: value,
			}).catch((error) => {
				console.error("Failed to persist chat reasoning effort", error);
				toast.error("Failed to save reasoning");
			});
		},
		[
			activeWorkspaceId,
			chatId,
			currentChat?.reasoningEffort,
			persistChatSettings,
		],
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
	const handleSubmit = React.useCallback(async () => {
		const value = draft;

		if (
			(!value.trim() && attachedFiles.length === 0) ||
			hasUploadingAttachments(attachedFiles) ||
			isLoading
		) {
			return;
		}

		setIsPreparingRequest(true);

		try {
			const convexToken = await getCachedConvexToken();
			const currentSharedLocalFolders = await rehydrateSharedLocalFolders(
				localFolderStorageScope,
			);
			const { allFolders: nextSharedLocalFolders } =
				await shareLocalFoldersFromText({
					currentFolders: currentSharedLocalFolders,
					text: value,
				});
			setSharedLocalFolders(nextSharedLocalFolders);
			storeSharedLocalFolders(localFolderStorageScope, nextSharedLocalFolders);
			onChatPersisted?.(chatId);
			const readyFiles = getReadyFileParts(attachedFiles);
			const filePayload = readyFiles.length > 0 ? { files: readyFiles } : {};
			const { mentionIds, requestSelectedSourceIds } = getMentionRequestContext(
				mentions,
				selectedSourceIds,
			);
			const metadata =
				mentions.length > 0 ? { mentionPositions: mentions } : undefined;
			const nextOutgoingMessage = editingMessageId
				? {
						messageId: editingMessageId,
						text: value,
						metadata,
						...filePayload,
					}
				: {
						text: value,
						metadata,
						...filePayload,
					};

			void Promise.resolve(
				sendMessage(nextOutgoingMessage, {
					body: {
						model: selectedModel.model,
						reasoningEffort: selectedReasoningEffort,
						localFolders: nextSharedLocalFolders,
						webSearchEnabled,
						appsEnabled,
						mentions: mentionIds,
						selectedSourceIds: requestSelectedSourceIds,
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
						workspaceId: activeWorkspaceId,
						convexToken,
					},
				}),
			).finally(() => {
				setIsPreparingRequest(false);
			});
			setEditingMessageId(null);
			setDraft("");
			setMentions([]);
			setAttachedFiles([]);
		} catch (error) {
			console.error("Failed to prepare chat request", error);
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
		localFolderStorageScope,
		mentions,
		onChatPersisted,
		selectedReasoningEffort,
		selectedModel.model,
		sendMessage,
		webSearchEnabled,
		selectedSourceIds,
	]);

	const handleDraftKeyDown = React.useCallback(
		(event: KeyboardEvent) => {
			if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
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

	const handleStop = React.useCallback(() => {
		stop();

		if (!isPersistedChatStreaming || !activeWorkspaceId) {
			return;
		}

		void stopActiveChatStream({
			chatId,
			workspaceId: activeWorkspaceId,
		}).catch((error) => {
			console.error("Failed to stop active chat stream", error);
		});
	}, [activeWorkspaceId, chatId, isPersistedChatStreaming, stop]);

	const handleEditMessage = React.useCallback(
		(
			messageId: string,
			text: string,
			messageMentions: ChatComposerMention[],
		) => {
			if (isLoading) {
				handleStop();
			}

			setEditingMessageId(messageId);
			setDraft(text);
			setMentions(messageMentions);
			setAttachedFiles([]);
		},
		[handleStop, isLoading],
	);

	const handleCancelEdit = React.useCallback(() => {
		setEditingMessageId(null);
		setDraft("");
		setMentions([]);
		setAttachedFiles([]);
	}, []);

	const buildRequestBody = React.useCallback(async () => {
		const convexToken = await getCachedConvexToken();
		const { mentionIds, requestSelectedSourceIds } = getMentionRequestContext(
			mentions,
			selectedSourceIds,
		);

		return {
			model: selectedModel.model,
			reasoningEffort: selectedReasoningEffort,
			localFolders: sharedLocalFolders,
			webSearchEnabled,
			appsEnabled,
			mentions: mentionIds,
			selectedSourceIds: requestSelectedSourceIds,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
			workspaceId: activeWorkspaceId,
			convexToken,
		};
	}, [
		activeWorkspaceId,
		appsEnabled,
		mentions,
		selectedReasoningEffort,
		selectedModel.model,
		selectedSourceIds,
		sharedLocalFolders,
		webSearchEnabled,
	]);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			if (isLoading) {
				handleStop();
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
			handleStop,
			isLoading,
			setMessages,
			truncateFromMessage,
		],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (isLoading) {
				handleStop();
			}

			setIsPreparingRequest(true);

			try {
				const requestBody = await buildRequestBody();
				setEditingMessageId(null);
				setDraft("");
				void Promise.resolve(
					regenerate({
						messageId: assistantMessageId,
						body: requestBody,
					}),
				).finally(() => {
					setIsPreparingRequest(false);
				});
			} catch (error) {
				console.error("Failed to prepare chat regeneration", error);
				setIsPreparingRequest(false);
			}
		},
		[buildRequestBody, handleStop, isLoading, regenerate],
	);
	const handleOpenMention = React.useCallback((sourceId: string) => {
		setSummaryOpen(true);
		setSummaryOpenSourceRequest((current) => ({
			sourceId,
			requestId: (current?.requestId ?? 0) + 1,
		}));
	}, []);

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
		handleStop,
		handleWebSearchEnabledChange,
		hasMessages,
		activeStreamChatIds: activeStreamChatIds ?? [],
		isLoading,
		isNotesLoading,
		messages,
		modelPopoverOpen,
		selectedModel: isModelResolving ? null : selectedModel,
		reasoningEffort: selectedReasoningEffort,
		selectedSourceIds,
		setAppsEnabled,
		setDraft,
		setMentions,
		setModelPopoverOpen,
		setReasoningEffort: handleReasoningEffortChange,
		setSelectedModel: handleSelectedModelChange,
		setSourcesOpen,
		setSummaryOpen,
		summaryOpenSourceRequest,
		sourcesOpen,
		summaryOpen,
		webSearchEnabled,
		workspaceSources,
		appSources,
		editingMessageId,
		mentions,
		handleCancelEdit,
		onDeleteMessage: handleDeleteMessage,
		onOpenMention: handleOpenMention,
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
		onEditMessage: handleEditMessage,
		onRegenerateMessage: handleRegenerateMessage,
	};
};

// oxlint-disable-next-line react-doctor/no-giant-component -- Page-level orchestrator wires chat state, search, history, and summary surfaces.
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
	const historyViewportRef = React.useRef<HTMLDivElement | null>(null);
	const searchInputRef = React.useRef<HTMLInputElement | null>(null);
	const [messageSearch, dispatchMessageSearch] = React.useReducer(
		messageSearchReducer,
		{ open: false, query: "", index: 0 },
	);
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
	const canSearchMessages =
		shouldShowActiveChatSurface && controller.hasMessages;
	const messageSearchMatches = React.useMemo(
		() => getChatSearchMatches(controller.messages, messageSearch.query),
		[controller.messages, messageSearch.query],
	);
	const messageSearchIndex =
		messageSearchMatches.length > 0
			? Math.min(messageSearch.index, messageSearchMatches.length - 1)
			: 0;
	const activeMessageSearchMatch =
		messageSearchMatches.length > 0
			? messageSearchMatches[messageSearchIndex]
			: null;
	const viewportRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			historyViewportRef.current = node;
			containerRef(controller.hasMessages ? node : null);
		},
		[containerRef, controller.hasMessages],
	);
	const canShowChatSummary = activeChatId === chatId;
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const activeStreamingChatIds = React.useMemo(() => {
		const ids = new Set(controller.activeStreamChatIds);

		if (controller.isLoading && controller.hasMessages) {
			ids.add(chatId);
		}

		return ids;
	}, [
		chatId,
		controller.activeStreamChatIds,
		controller.hasMessages,
		controller.isLoading,
	]);
	const currentAutomation = React.useMemo(
		() =>
			(automations ?? []).find((automation) => automation.chatId === chatId) ??
			null,
		[automations, chatId],
	);
	React.useEffect(() => {
		const handleOpenSummary = () => {
			if (!canShowChatSummary) {
				return;
			}

			controller.setSummaryOpen((current) => !current);
		};

		window.addEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);

		return () => {
			window.removeEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);
		};
	}, [canShowChatSummary, controller.setSummaryOpen]);
	React.useEffect(() => {
		if (!canShowChatSummary) {
			controller.setSummaryOpen(false);
		}
	}, [canShowChatSummary, controller.setSummaryOpen]);
	React.useLayoutEffect(() => {
		if (shouldShowActiveChatSurface) {
			return;
		}

		historyViewportRef.current?.scrollTo?.({
			top: 0,
			behavior: "auto",
		});
	}, [shouldShowActiveChatSurface]);
	React.useEffect(() => {
		if (!canSearchMessages) {
			dispatchMessageSearch({ type: "close" });
		}
	}, [canSearchMessages]);
	React.useEffect(() => {
		if (!messageSearch.open) {
			return;
		}

		requestAnimationFrame(() => {
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		});
	}, [messageSearch.open]);
	React.useEffect(() => {
		if (!activeMessageSearchMatch || !messageSearch.open) {
			return;
		}

		const escapedMessageId =
			typeof CSS !== "undefined" && typeof CSS.escape === "function"
				? CSS.escape(activeMessageSearchMatch.messageId)
				: activeMessageSearchMatch.messageId.replace(/"/g, '\\"');
		const messageElement = document.querySelector<HTMLElement>(
			`[data-chat-message-id="${escapedMessageId}"]`,
		);

		messageElement?.scrollIntoView?.({
			block: "center",
			behavior: "smooth",
		});
	}, [activeMessageSearchMatch, messageSearch.open]);
	React.useEffect(() => {
		const highlightRegistry =
			typeof CSS === "undefined"
				? undefined
				: (CSS as CssWithHighlights).highlights;

		if (
			!messageSearch.open ||
			!messageSearch.query.trim() ||
			!highlightRegistry ||
			typeof Highlight === "undefined"
		) {
			highlightRegistry?.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry?.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
			return;
		}

		ensureCssHighlightStyles();

		const matchRanges: Range[] = [];
		const activeMatchRanges: Range[] = [];

		for (const match of messageSearchMatches) {
			const escapedMessageId =
				typeof CSS !== "undefined" && typeof CSS.escape === "function"
					? CSS.escape(match.messageId)
					: match.messageId.replace(/"/g, '\\"');
			const messageElement = document.querySelector<HTMLElement>(
				`[data-chat-message-id="${escapedMessageId}"]`,
			);

			if (!messageElement) {
				continue;
			}

			const ranges = createTextMatchRanges({
				element: messageElement,
				query: messageSearch.query,
			});

			if (match.messageId === activeMessageSearchMatch?.messageId) {
				activeMatchRanges.push(...ranges);
				continue;
			}

			matchRanges.push(...ranges);
		}

		highlightRegistry.set(
			CHAT_SEARCH_MATCH_HIGHLIGHT,
			new Highlight(...matchRanges),
		);
		highlightRegistry.set(
			CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT,
			new Highlight(...activeMatchRanges),
		);

		return () => {
			highlightRegistry.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
		};
	}, [
		activeMessageSearchMatch,
		messageSearchMatches,
		messageSearch.open,
		messageSearch.query,
	]);
	React.useEffect(() => {
		if (!canSearchMessages || !isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key.toLowerCase() !== "f" && event.code !== "KeyF")
			) {
				return;
			}

			event.preventDefault();
			if (messageSearch.open) {
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				});
			}
			dispatchMessageSearch({ type: "open" });
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [canSearchMessages, messageSearch.open]);
	const handleMessageSearchPrevious = React.useCallback(() => {
		dispatchMessageSearch({
			type: "setIndex",
			index:
				messageSearchMatches.length === 0
					? 0
					: (messageSearchIndex - 1 + messageSearchMatches.length) %
						messageSearchMatches.length,
		});
	}, [messageSearchIndex, messageSearchMatches.length]);
	const handleMessageSearchNext = React.useCallback(() => {
		dispatchMessageSearch({
			type: "setIndex",
			index:
				messageSearchMatches.length === 0
					? 0
					: (messageSearchIndex + 1) % messageSearchMatches.length,
		});
	}, [messageSearchIndex, messageSearchMatches.length]);
	const handleMessageSearchKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				dispatchMessageSearch({ type: "close" });
				return;
			}

			if (event.key !== "Enter") {
				return;
			}

			event.preventDefault();
			if (event.shiftKey) {
				handleMessageSearchPrevious();
				return;
			}

			handleMessageSearchNext();
		},
		[handleMessageSearchNext, handleMessageSearchPrevious],
	);
	// Web chat uses a 4rem shell header, while the native mac shell keeps a
	// taller md offset. Matching the shell height keeps short-chat docks flush.
	const chatSurfaceMinHeightClass = isDesktopMac
		? "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-5rem)]"
		: "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-4rem)]";
	const shouldShowScrollToLatest =
		controller.hasMessages && !isChatViewportAtBottom;
	const composer = (
		<ChatComposer
			useCompactLayout={shouldShowActiveChatSurface}
			draft={controller.draft}
			topAccessory={
				shouldShowScrollToLatest ? (
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
			mentions={controller.mentions}
			onSubmit={controller.handleSubmit}
			onStop={controller.handleStop}
			attachedFiles={controller.attachedFiles}
			onAttachedFilesChange={controller.setAttachedFiles}
			isLoading={controller.isLoading}
			selectedModel={controller.selectedModel}
			reasoningEffort={controller.reasoningEffort}
			modelPopoverOpen={controller.modelPopoverOpen}
			onModelPopoverOpenChange={controller.setModelPopoverOpen}
			onSelectedModelChange={controller.setSelectedModel}
			onReasoningEffortChange={controller.setReasoningEffort}
			mentionableDocuments={controller.contextPages}
			isNotesLoading={controller.isNotesLoading}
			onMentionsChange={controller.setMentions}
			sourcesOpen={controller.sourcesOpen}
			onSourcesOpenChange={controller.setSourcesOpen}
			webSearchEnabled={controller.webSearchEnabled}
			onWebSearchEnabledChange={controller.handleWebSearchEnabledChange}
			selectedSourceIds={controller.selectedSourceIds}
			appSources={controller.appSources}
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
				viewportRef={viewportRef}
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
								{messageSearch.open ? (
									<ChatMessageSearchBar
										inputRef={searchInputRef}
										query={messageSearch.query}
										onQueryChange={(value) => {
											dispatchMessageSearch({ type: "setQuery", query: value });
										}}
										matchCount={messageSearchMatches.length}
										matchIndex={
											messageSearchMatches.length > 0 ? messageSearchIndex : -1
										}
										onPrevious={handleMessageSearchPrevious}
										onNext={handleMessageSearchNext}
										onClose={() => dispatchMessageSearch({ type: "close" })}
										onKeyDown={handleMessageSearchKeyDown}
									/>
								) : null}
								<div className="flex-1 pt-8 pb-28 md:pb-32">
									<ChatMessages
										messages={controller.messages}
										error={controller.error}
										isLoading={controller.isLoading}
										onDeleteMessage={controller.onDeleteMessage}
										onEditMessage={controller.onEditMessage}
										onOpenMention={controller.onOpenMention}
										onPlusAction={handleCreateNoteFromResponse}
										onRegenerateMessage={controller.onRegenerateMessage}
									/>
								</div>

								<div className="sticky bottom-0 z-10 mt-auto h-0">
									<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
										<div className="pointer-events-auto relative mx-auto w-[calc(100%-2rem)] min-w-0 max-w-full md:max-w-xl">
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
											activeStreamingChatIds={activeStreamingChatIds}
											onAddAutomation={onAddAutomation}
										/>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</ScrollArea>
			{canShowChatSummary ? (
				<ChatSummarySheet
					open={controller.summaryOpen}
					messages={controller.messages}
					automation={currentAutomation}
					chatTitle={controller.currentChatTitle}
					desktopSafeTop={isDesktopMac}
					workspaceSources={controller.workspaceSources}
					openSourceRequest={controller.summaryOpenSourceRequest}
					onAddSource={controller.onAddSource}
					onRemoveAutoAddedSource={controller.onRemoveAutoAddedSource}
					onOpenChange={controller.setSummaryOpen}
				/>
			) : null}
		</>
	);
}

function ChatMessageSearchBar({
	inputRef,
	query,
	onQueryChange,
	matchCount,
	matchIndex,
	onPrevious,
	onNext,
	onClose,
	onKeyDown,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
	matchIndex: number;
	onPrevious: () => void;
	onNext: () => void;
	onClose: () => void;
	onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}) {
	const matchLabel =
		query.trim().length === 0
			? ""
			: matchCount > 0
				? `${matchIndex + 1}/${matchCount}`
				: "No results";

	return (
		<div className="fixed top-20 right-4 left-4 z-50 mx-auto flex max-w-md items-center gap-1 rounded-lg border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur md:right-8 md:left-auto md:w-80">
			<Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
			<Input
				ref={inputRef}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Search chat"
				aria-label="Search chat"
				className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
			/>
			<span
				className={cn(
					"min-w-14 shrink-0 text-right text-xs tabular-nums",
					matchCount === 0 && query.trim().length > 0
						? "text-muted-foreground"
						: "text-foreground/70",
				)}
			>
				{matchLabel}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Previous match"
				onClick={onPrevious}
			>
				<ChevronUp className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Next match"
				onClick={onNext}
			>
				<ChevronDown className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				aria-label="Close chat search"
				onClick={onClose}
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}
