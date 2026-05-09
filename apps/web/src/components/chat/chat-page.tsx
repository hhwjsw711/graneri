import { useChat } from "@ai-sdk/react";
import { isDesktopRuntime } from "@workspace/platform/desktop";
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

const getChatSearchMatches = (messages: UIMessage[], query: string) => {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	return messages
		.map((message) => ({
			messageId: message.id,
			text: getChatText(message),
		}))
		.filter(({ text }) => text.toLocaleLowerCase().includes(normalizedQuery));
};

type CssHighlightRegistry = {
	set: (name: string, highlight: Highlight) => void;
	delete: (name: string) => void;
};

type CssWithHighlights = typeof CSS & {
	highlights?: CssHighlightRegistry;
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

	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let currentNode = walker.nextNode();

	while (currentNode) {
		const textNode = currentNode as Text;
		const normalizedText = textNode.data.toLocaleLowerCase();
		let searchIndex = normalizedText.indexOf(normalizedQuery);

		while (searchIndex !== -1) {
			const range = document.createRange();
			range.setStart(textNode, searchIndex);
			range.setEnd(textNode, searchIndex + normalizedQuery.length);
			ranges.push(range);
			searchIndex = normalizedText.indexOf(
				normalizedQuery,
				searchIndex + normalizedQuery.length,
			);
		}

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

			void Promise.resolve(
				sendMessage(nextOutgoingMessage, {
					body: {
						model: selectedModel.model,
						webSearchEnabled,
						appsEnabled,
						mentions,
						selectedSourceIds,
						workspaceId: activeWorkspaceId,
						convexToken,
					},
				}),
			).finally(() => {
				setIsPreparingRequest(false);
			});
			setEditingMessageId(null);
			setDraft("");
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
	const historyViewportRef = React.useRef<HTMLDivElement | null>(null);
	const searchInputRef = React.useRef<HTMLInputElement | null>(null);
	const [messageSearchOpen, setMessageSearchOpen] = React.useState(false);
	const [messageSearchQuery, setMessageSearchQuery] = React.useState("");
	const [messageSearchIndex, setMessageSearchIndex] = React.useState(0);
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
		() => getChatSearchMatches(controller.messages, messageSearchQuery),
		[controller.messages, messageSearchQuery],
	);
	const activeMessageSearchMatch =
		messageSearchMatches.length > 0
			? messageSearchMatches[
					Math.min(messageSearchIndex, messageSearchMatches.length - 1)
				]
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
			setMessageSearchOpen(false);
			setMessageSearchQuery("");
			setMessageSearchIndex(0);
		}
	}, [canSearchMessages]);
	React.useEffect(() => {
		if (!messageSearchOpen) {
			return;
		}

		requestAnimationFrame(() => {
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		});
	}, [messageSearchOpen]);
	React.useEffect(() => {
		if (messageSearchIndex < messageSearchMatches.length) {
			return;
		}

		setMessageSearchIndex(0);
	}, [messageSearchIndex, messageSearchMatches.length]);
	React.useEffect(() => {
		if (!activeMessageSearchMatch || !messageSearchOpen) {
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
	}, [activeMessageSearchMatch, messageSearchOpen]);
	React.useEffect(() => {
		const highlightRegistry =
			typeof CSS === "undefined"
				? undefined
				: (CSS as CssWithHighlights).highlights;

		if (
			!messageSearchOpen ||
			!messageSearchQuery.trim() ||
			!highlightRegistry ||
			typeof Highlight === "undefined"
		) {
			highlightRegistry?.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry?.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
			return;
		}

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
				query: messageSearchQuery,
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
		messageSearchOpen,
		messageSearchQuery,
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
			if (messageSearchOpen) {
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				});
			}
			setMessageSearchOpen(true);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [canSearchMessages, messageSearchOpen]);
	const handleMessageSearchPrevious = React.useCallback(() => {
		setMessageSearchIndex((current) =>
			messageSearchMatches.length === 0
				? 0
				: (current - 1 + messageSearchMatches.length) %
					messageSearchMatches.length,
		);
	}, [messageSearchMatches.length]);
	const handleMessageSearchNext = React.useCallback(() => {
		setMessageSearchIndex((current) =>
			messageSearchMatches.length === 0
				? 0
				: (current + 1) % messageSearchMatches.length,
		);
	}, [messageSearchMatches.length]);
	const handleMessageSearchKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setMessageSearchOpen(false);
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
								{messageSearchOpen ? (
									<ChatMessageSearchBar
										inputRef={searchInputRef}
										query={messageSearchQuery}
										onQueryChange={(value) => {
											setMessageSearchQuery(value);
											setMessageSearchIndex(0);
										}}
										matchCount={messageSearchMatches.length}
										matchIndex={
											messageSearchMatches.length > 0 ? messageSearchIndex : -1
										}
										onPrevious={handleMessageSearchPrevious}
										onNext={handleMessageSearchNext}
										onClose={() => setMessageSearchOpen(false)}
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
			{canShowChatSummary ? (
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
