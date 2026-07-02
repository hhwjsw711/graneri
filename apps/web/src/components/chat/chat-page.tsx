import { useChat } from "@ai-sdk/react";
import { isDesktopRuntime } from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { cn } from "@workspace/ui/lib/utils";
import type { ChatAddToolOutputFunction, UIMessage } from "ai";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronUp, FileText, Search, X } from "lucide-react";
import * as React from "react";
// react-doctor-disable-next-line react-doctor/no-flush-sync
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
	type ChatAttachment,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/file-attachment-controls";
import { hasUploadingAttachments } from "@/components/ai-elements/file-attachment-utils";
import type { AutomationListItem } from "@/components/automations/automation-types";
import {
	escapeChatMessageSelectorValue,
	getChatMessageElement,
} from "@/components/chat/chat-message-dom";
import { ChatMessagesEntry } from "@/components/chat/chat-messages-entry";
import {
	type ChatSummaryOpenSourceRequest,
	OPEN_CHAT_SUMMARY_EVENT,
} from "@/components/chat/chat-summary-events";
import { ChatSummarySheetEntry } from "@/components/chat/chat-summary-sheet-entry";
import { ChatUserMessageNavigationRail } from "@/components/chat/chat-user-message-navigation-rail";
import type {
	ChatModel,
	ReasoningEffort,
} from "@/components/chat/model-picker";
import { COMPOSER_DOCK_WRAPPER_CLASS } from "@/components/layout/composer-dock";
import { PageTitle } from "@/components/layout/page-title";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { useAppSources } from "@/hooks/use-app-sources";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { useQueuedChatDrain } from "@/hooks/use-queued-chat-drain";
import { useQueuedFollowUpControls } from "@/hooks/use-queued-follow-up-controls";
import { useResumeActiveChatRun } from "@/hooks/use-resume-active-chat-run";
import { useWorkspaceChatTransport } from "@/hooks/use-workspace-chat-transport";
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
	getStoredChatReasoningEffort,
	getStoredReasoningEffort,
	getStoredReasoningEffortOverride,
	resolveReasoningEffortPreference,
	storeChatReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import { waitForBrowserPaint } from "@/lib/browser-paint";
import { getChatId } from "@/lib/chat";
import { stopActiveChatStream } from "@/lib/chat-active-stream";
import { getPendingAutomationDeleteConfirmation } from "@/lib/chat-automation-confirmation";
import { submitAutomationConfirmationChatTurn } from "@/lib/chat-automation-confirmation-submit";
import { getChatText } from "@/lib/chat-message";
import {
	appendLocalOptimisticChatMessages,
	hasRenderableChatMessageText,
	mergePersistedChatMessagesWithController,
	normalizeChatMessages,
} from "@/lib/chat-message-state";
import { toQueuedUserMessageInput } from "@/lib/chat-queue";
import {
	buildWorkspaceChatRequestBody,
	buildWorkspaceChatRequestBodyFromLocalFolders,
} from "@/lib/chat-request-preparation";
import { getUIMessageSeedKey, toStoredChatMessages } from "@/lib/chat-snapshot";
import { CHAT_STREAM_UI_THROTTLE_MS } from "@/lib/chat-streaming-performance";
import {
	removeChatMessageById,
	submitChatTurn,
} from "@/lib/chat-submit-session";
import {
	applyPendingMessageTruncation,
	getMessagesBefore,
} from "@/lib/chat-thread";
import { getChatComposerDraftScope } from "@/lib/composer-draft";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { ensureCssHighlightStyles } from "@/lib/css-highlight-styles";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";
import {
	loadStoredSharedLocalFolders,
	rehydrateSharedLocalFolders,
} from "@/lib/local-folder-sharing";
import { logError } from "@/lib/logger";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { createTextMatchRanges, escapeRegExp } from "@/lib/text-search-ranges";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ChatComposer, type ChatComposerMention } from "./chat-composer";
import { ChatHistoryList } from "./chat-history-list";

export type ChatPageProps = {
	chatId: string;
	onChatPersisted?: (chatId: string) => void;
	chats: Array<Doc<"chats">>;
	isChatsLoading: boolean;
	activeStreamingChatIds: ReadonlySet<string>;
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

type ScopedLocalOptimisticMessages = {
	chatId: string;
	messages: UIMessage[];
};

const EMPTY_STEER_HANDOFF_STREAMING_MESSAGE_IDS = new Set<string>();
type StateUpdate<T> = T | ((currentState: T) => T);

const stateUpdateReducer = <T,>(
	currentState: T,
	updateState: StateUpdate<T>,
): T =>
	typeof updateState === "function"
		? (updateState as (currentState: T) => T)(currentState)
		: updateState;

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

const getRegenerationMessages = ({
	assistantMessageId,
	messages,
}: {
	assistantMessageId: string;
	messages: UIMessage[];
}) => {
	const assistantMessageIndex = messages.findIndex(
		(message) => message.id === assistantMessageId,
	);

	if (assistantMessageIndex < 0) {
		throw new Error("Cannot regenerate a missing assistant message.");
	}

	const userMessageIndex = messages
		.slice(0, assistantMessageIndex)
		.findLastIndex((message) => message.role === "user");

	if (userMessageIndex < 0) {
		throw new Error("Cannot regenerate without a previous user message.");
	}

	return normalizeChatMessages(messages.slice(0, userMessageIndex + 1));
};

const getStoredChatModel = (model: string | undefined): ChatModel | null =>
	model ? (findChatModel(model) ?? null) : null;

const getPersistedChatReasoningEffort = (
	reasoningEffort: string | undefined,
): ReasoningEffort | null =>
	reasoningEffort ? (findReasoningEffort(reasoningEffort)?.id ?? null) : null;

const getMentionRequestContext = (mentions: ChatComposerMention[]) => {
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
		requestSelectedSourceIds: [...new Set(toolMentionIds)],
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

type ChatComposerDraftMetadata = {
	mentions: ChatComposerMention[];
};

const useChatPageController = ({
	chatId,
	onChatPersisted,
	chats,
	isChatsLoading,
	activeStreamingChatIds,
}: Pick<
	ChatPageProps,
	| "chatId"
	| "onChatPersisted"
	| "chats"
	| "isChatsLoading"
	| "activeStreamingChatIds"
>) => {
	const activeWorkspaceId = useActiveWorkspaceId();
	const draftStorageScope = activeWorkspaceId
		? // react-doctor-disable-next-line react-doctor/no-event-handler
			getChatComposerDraftScope({ chatId, workspaceId: activeWorkspaceId })
		: null;
	const currentChat = React.useMemo(
		// react-doctor-disable-next-line react-doctor/no-event-handler
		() => chats.find((chat) => getChatId(chat) === chatId) ?? null,
		[chats, chatId],
	);
	const {
		clear: clearDraft,
		getSnapshot: getDraftSnapshot,
		metadata: draftMetadata,
		setMetadata: setDraftMetadata,
		setText: setDraft,
		text: draft,
	} = useComposerDraft<ChatComposerDraftMetadata>(draftStorageScope);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	useRevokeAttachmentObjectUrls(attachedFiles);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [selectedModelOverride, setSelectedModelOverride] = React.useState<{
		chatId: string;
		model: ChatModel;
	} | null>(null);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
		getStoredReasoningEffort,
	);
	const mentions = React.useMemo(
		() =>
			Array.isArray(draftMetadata?.mentions) ? draftMetadata.mentions : [],
		[draftMetadata],
	);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [modelPopoverOpen, setModelPopoverOpen] = React.useState(false);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [sourcesOpen, setSourcesOpen] = React.useState(false);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [summaryOpen, setSummaryOpen] = React.useState(false);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [summaryOpenSourceRequest, setSummaryOpenSourceRequest] =
		React.useState<ChatSummaryOpenSourceRequest | null>(null);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [isPreparingRequest, setIsPreparingRequest] = React.useState(false);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [sharedLocalFolders, setSharedLocalFolders] = React.useState<
		DesktopLocalFolder[]
	>([]);
	const localFolderStorageScope = `chat:${chatId}`;
	const notes = useQuery(
		api.notes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const appSources = useAppSources(activeWorkspaceId);
	const handleMentionsChange = React.useCallback(
		(nextMentions: ChatComposerMention[]) => {
			setDraftMetadata(
				nextMentions.length > 0 ? { mentions: nextMentions } : null,
			);
		},
		[setDraftMetadata],
	);
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
	const updateUserPreferences = useMutation(api.userPreferences.update);
	const enqueueQueuedMessage = useMutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
	);
	const updateQueuedMessage = useMutation(
		api.assistantQueuedMessages.updateQueued,
	);
	const stopAutomationRun = useMutation(api.automations.stopRun);
	const userPreferences = useQuery(api.userPreferences.get, {});
	const storedMessages = useQuery(
		api.chats.getMessages,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const activeRun = useQuery(
		api.assistantRuns.getAttachableRun,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const attachableActiveRun =
		activeRun && activeRun.status !== "stopping" ? activeRun : null;
	const runningAutomationRun = useQuery(
		api.automations.getRunningRunForChat,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const transport = useWorkspaceChatTransport(activeWorkspaceId);
	const latestRequestBodyRef = React.useRef<Record<string, unknown> | null>(
		null,
	);
	const addToolOutputRef =
		React.useRef<ChatAddToolOutputFunction<UIMessage> | null>(null);
	const [localOptimisticMessages, setLocalOptimisticMessages] =
		React.useReducer(
			stateUpdateReducer<ScopedLocalOptimisticMessages | null>,
			null,
		);
	const [
		activeSteerHandoffStreamingMessageIds,
		setActiveSteerHandoffStreamingMessageIds,
	] = React.useReducer(
		stateUpdateReducer<ReadonlySet<string>>,
		undefined,
		() => new Set<string>(),
	);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const [pendingTruncateMessageId, setPendingTruncateMessageId] =
		React.useState<string | null>(null);
	const handleToolCall = React.useMemo(
		() =>
			createDesktopLocalToolCallHandler({
				addToolOutputRef,
				latestRequestBodyRef,
			}),
		[],
	);
	const {
		messages,
		setMessages,
		sendMessage,
		regenerate,
		error,
		status,
		stop,
		resumeStream,
		addToolOutput,
	} = useChat({
		id: chatId,
		experimental_throttle: CHAT_STREAM_UI_THROTTLE_MS,
		transport,
		onToolCall: handleToolCall,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
	});
	addToolOutputRef.current = addToolOutput;
	const controllerMessages = React.useMemo(
		() => normalizeChatMessages(messages),
		[messages],
	);

	const persistedMessages = React.useMemo(
		() =>
			storedMessages === undefined ? [] : toStoredChatMessages(storedMessages),
		[storedMessages],
	);
	const activePendingTruncateMessageId =
		pendingTruncateMessageId &&
		persistedMessages.some((message) => message.id === pendingTruncateMessageId)
			? pendingTruncateMessageId
			: null;
	const visiblePersistedMessages = React.useMemo(
		() =>
			applyPendingMessageTruncation(
				persistedMessages,
				activePendingTruncateMessageId,
			),
		[activePendingTruncateMessageId, persistedMessages],
	);

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);

	const isAiRequestPending = status === "submitted" || status === "streaming";
	const isChatRequestPending = isPreparingRequest || isAiRequestPending;
	const hasLocallyCompletedAssistantMessage =
		!isAiRequestPending &&
		Boolean(
			attachableActiveRun &&
				hasRenderableChatMessageText(
					controllerMessages.find(
						(message) =>
							message.id === attachableActiveRun.assistantMessageId &&
							message.role === "assistant",
					),
				),
		);
	const displayActiveRun = hasLocallyCompletedAssistantMessage
		? null
		: attachableActiveRun;
	const activeAssistantMessageId = React.useMemo(() => {
		if (!displayActiveRun) {
			return null;
		}

		const controllerMessagesAfterLatestUser = controllerMessages.slice(
			controllerMessages.findLastIndex((message) => message.role === "user") +
				1,
		);
		const snapshotMessagesAfterLatestUser = visiblePersistedMessages.slice(
			visiblePersistedMessages.findLastIndex(
				(message) => message.role === "user",
			) + 1,
		);
		const activeControllerAssistantMessage = [
			...controllerMessagesAfterLatestUser,
		]
			.reverse()
			.find((message) => message.role === "assistant");
		const activeSnapshotAssistantMessage = [...snapshotMessagesAfterLatestUser]
			.reverse()
			.find((message) => message.role === "assistant");

		return (
			activeControllerAssistantMessage?.id ??
			activeSnapshotAssistantMessage?.id ??
			displayActiveRun.assistantMessageId
		);
	}, [controllerMessages, displayActiveRun, visiblePersistedMessages]);
	const steerHandoffStreamingMessageIds =
		displayActiveRun || isAiRequestPending || isPreparingRequest
			? activeSteerHandoffStreamingMessageIds
			: EMPTY_STEER_HANDOFF_STREAMING_MESSAGE_IDS;

	const persistedMessagesSeedKey = React.useMemo(
		() => getUIMessageSeedKey(visiblePersistedMessages),
		[visiblePersistedMessages],
	);
	const appliedPersistedMessagesSeedKeyRef = React.useRef(
		persistedMessagesSeedKey,
	);

	useResumeActiveChatRun({
		activeRun: displayActiveRun,
		chatId,
		enabled: !isChatRequestPending,
		resumeStream,
		workspaceId: activeWorkspaceId,
	});

	React.useEffect(() => {
		const isLocalRequestRunning =
			status === "submitted" || status === "streaming" || isPreparingRequest;

		if (isLocalRequestRunning) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);
			const nextPersistedMessages = activeAssistantMessageId
				? removeChatMessageById(
						visiblePersistedMessages,
						activeAssistantMessageId,
					)
				: visiblePersistedMessages;
			const shouldUsePersistedMessages =
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedPersistedMessagesSeedKeyRef.current ||
				(!activeRun && nextPersistedMessages.length > 0);

			if (shouldUsePersistedMessages) {
				appliedPersistedMessagesSeedKeyRef.current = persistedMessagesSeedKey;
				return nextPersistedMessages;
			}

			return normalizeChatMessages(currentMessages);
		});
	}, [
		activeRun,
		activeAssistantMessageId,
		isPreparingRequest,
		persistedMessagesSeedKey,
		setMessages,
		status,
		visiblePersistedMessages,
	]);

	const isAutomationRunning = Boolean(runningAutomationRun);
	const isPersistedChatStreaming = Boolean(displayActiveRun);
	const isChatUiPending =
		isChatRequestPending || isPersistedChatStreaming || isAutomationRunning;
	const canStop =
		isChatRequestPending || isPersistedChatStreaming || isAutomationRunning;
	const mergedDisplayMessages = React.useMemo(() => {
		if (!activeAssistantMessageId || !displayActiveRun) {
			return controllerMessages.length > 0
				? controllerMessages
				: visiblePersistedMessages;
		}

		const activeControllerMessage = controllerMessages.find(
			(message) =>
				message.id === activeAssistantMessageId && message.role === "assistant",
		);
		const activeSnapshotMessage = visiblePersistedMessages.find(
			(message) =>
				message.id === activeAssistantMessageId && message.role === "assistant",
		);
		const activeAssistantMessage = hasRenderableChatMessageText(
			activeControllerMessage,
		)
			? activeControllerMessage
			: activeSnapshotMessage;

		return mergePersistedChatMessagesWithController({
			activeAssistantMessage,
			activeAssistantMessageId,
			controllerMessages,
			persistedQueuedMessagePosition:
				displayActiveRun.interruptedAssistantMessageIds.length > 0 &&
				!displayActiveRun.interruptedAssistantMessageIds.includes(
					activeAssistantMessageId,
				)
					? "before-active"
					: "after-active",
			persistedMessages: visiblePersistedMessages,
		});
	}, [
		activeAssistantMessageId,
		displayActiveRun,
		controllerMessages,
		visiblePersistedMessages,
	]);
	const displayMessages = React.useMemo(
		() =>
			appendLocalOptimisticChatMessages({
				displayMessages: mergedDisplayMessages,
				localOptimisticMessages:
					localOptimisticMessages?.chatId === chatId
						? localOptimisticMessages.messages
						: [],
				resolvedMessages: visiblePersistedMessages,
			}),
		[
			chatId,
			localOptimisticMessages,
			mergedDisplayMessages,
			visiblePersistedMessages,
		],
	);
	const automationDeleteConfirmation = React.useMemo(
		() => getPendingAutomationDeleteConfirmation(displayMessages),
		[displayMessages],
	);
	const streamingMessageIds = React.useMemo(
		() =>
			new Set([
				...steerHandoffStreamingMessageIds,
				...(displayActiveRun?.interruptedAssistantMessageIds ?? []),
			]),
		[
			displayActiveRun?.interruptedAssistantMessageIds,
			steerHandoffStreamingMessageIds,
		],
	);
	const hasMessages = displayMessages.length > 0 || isAutomationRunning;
	const localMessageIds = React.useMemo(
		() =>
			new Set([
				...controllerMessages.map((message) => message.id),
				...(localOptimisticMessages?.chatId === chatId
					? localOptimisticMessages.messages.map((message) => message.id)
					: []),
			]),
		[chatId, controllerMessages, localOptimisticMessages],
	);
	const stopCurrentStream = React.useCallback(
		async ({ interruptActiveRun = false } = {}) => {
			stop();

			if (runningAutomationRun) {
				await stopAutomationRun({
					automationId: runningAutomationRun.automationId,
					runId: runningAutomationRun.runId,
				});
				return;
			}

			if (!displayActiveRun) {
				return;
			}

			if (!activeWorkspaceId) {
				throw new Error("Cannot stop chat stream without an active workspace.");
			}
			await stopActiveChatStream({
				chatId,
				interruptActiveRun,
				workspaceId: activeWorkspaceId,
			});
		},
		[
			activeWorkspaceId,
			chatId,
			displayActiveRun,
			runningAutomationRun,
			stop,
			stopAutomationRun,
		],
	);
	const { queuedMessages, setQueuedMessages } = useQueuedChatDrain({
		activeRun: displayActiveRun,
		chatId,
		contextLabel: "chat",
		isBlocked: isChatRequestPending || isAutomationRunning,
		latestRequestBodyRef,
		localMessageIds,
		sendMessage,
		workspaceId: activeWorkspaceId,
	});
	const {
		editDraft: queuedMessageEditDraft,
		finishQueuedMessageEdit,
		onQueuedFollowUpsReorder,
		queuedFollowUps,
		restoreEditedQueuedMessage,
		sendQueuedFollowUpNow,
	} = useQueuedFollowUpControls({
		activeRun: displayActiveRun,
		chatId,
		contextLabel: "chat",
		latestRequestBodyRef,
		localMessageIds,
		onEditMessage: (queuedMessage) => {
			setEditingMessageId(queuedMessage._id);
			setDraft(queuedMessage.text);
			setDraftMetadata(null);
			setAttachedFiles([]);
		},
		queuedMessages,
		sendMessage,
		setQueuedMessages,
		onSteerStart: () => {
			const handoffMessageIds = [
				...(activeAssistantMessageId ? [activeAssistantMessageId] : []),
				...(displayActiveRun?.assistantMessageId
					? [displayActiveRun.assistantMessageId]
					: []),
			];
			if (handoffMessageIds.length === 0) {
				return undefined;
			}

			setActiveSteerHandoffStreamingMessageIds((messageIds) => {
				const nextMessageIds = new Set(messageIds);
				for (const messageId of handoffMessageIds) {
					nextMessageIds.add(messageId);
				}
				return nextMessageIds;
			});

			return () =>
				setActiveSteerHandoffStreamingMessageIds((messageIds) => {
					const nextMessageIds = new Set(messageIds);
					for (const messageId of handoffMessageIds) {
						nextMessageIds.delete(messageId);
					}
					return nextMessageIds;
				});
		},
		workspaceId: activeWorkspaceId,
	});
	const queuedFollowUp = queuedMessages[0] ?? null;
	const isNotesLoading = notes === undefined;
	const selectedModel =
		(selectedModelOverride?.chatId === chatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(currentChat?.model) ??
		getStoredLocalChatModel() ??
		chatModels[0];
	const selectedReasoningEffort = resolveReasoningEffortPreference({
		persistedChatReasoningEffort: getPersistedChatReasoningEffort(
			currentChat?.reasoningEffort,
		),
		chatReasoningEffortOverride: getStoredChatReasoningEffort(chatId),
		globalReasoningEffortOverride: getStoredReasoningEffortOverride(),
		userPreferenceReasoningEffort: userPreferences?.reasoningEffort,
		fallbackReasoningEffort: reasoningEffort,
	});
	// react-doctor-disable-next-line react-doctor/no-event-handler
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
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist chat model",
				});
				toast.error("Failed to save model");
			});
		},
		[activeWorkspaceId, chatId, currentChat?.model, persistChatSettings],
	);
	const handleReasoningEffortChange = React.useCallback(
		(value: ReasoningEffort) => {
			setReasoningEffort(value);
			storeReasoningEffort(value);
			storeChatReasoningEffort(chatId, value);

			void updateUserPreferences({ reasoningEffort: value }).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist default reasoning effort",
				});
			});

			if (!activeWorkspaceId || currentChat?.reasoningEffort === value) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId,
				reasoningEffort: value,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist chat reasoning effort",
				});
				toast.error("Failed to save reasoning");
			});
		},
		[
			activeWorkspaceId,
			chatId,
			currentChat?.reasoningEffort,
			persistChatSettings,
			updateUserPreferences,
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
		const value = getDraftSnapshot().text;

		if (
			(!value.trim() && attachedFiles.length === 0) ||
			hasUploadingAttachments(attachedFiles) ||
			(isChatRequestPending && !displayActiveRun && !activeRun) ||
			isAutomationRunning ||
			(displayActiveRun && attachedFiles.length > 0)
		) {
			return;
		}

		const metadata =
			mentions.length > 0 ? { mentionPositions: mentions } : undefined;
		let optimisticMessageId: string | null = null;

		try {
			if (queuedMessageEditDraft) {
				if (!activeWorkspaceId) {
					throw new Error("Cannot edit queued message without a workspace.");
				}

				setIsPreparingRequest(true);
				const { mentionIds, requestSelectedSourceIds } =
					getMentionRequestContext(mentions);
				const requestBody = await buildWorkspaceChatRequestBody({
					localFolderStorageScope,
					mentions: mentionIds,
					model: selectedModel.model,
					reasoningEffort: selectedReasoningEffort,
					resolveConvexToken: getCachedConvexToken,
					selectedSourceIds: requestSelectedSourceIds,
					text: value,
					webSearchEnabled,
					workspaceId: activeWorkspaceId,
				});
				const updatedQueuedMessage = await updateQueuedMessage({
					workspaceId: activeWorkspaceId,
					chatId,
					queuedMessageId: queuedMessageEditDraft.message._id,
					message: toQueuedUserMessageInput({
						messageId: queuedMessageEditDraft.message.messageId,
						metadata,
						requestBody,
						text: value,
					}),
				});

				latestRequestBodyRef.current = requestBody;
				finishQueuedMessageEdit(updatedQueuedMessage);
				setEditingMessageId(null);
				clearDraft();
				setAttachedFiles([]);
				setIsPreparingRequest(false);
				return;
			}

			// react-doctor-disable-next-line react-doctor/no-event-handler
			onChatPersisted?.(chatId);
			setIsPreparingRequest(true);

			const { mentionIds, requestSelectedSourceIds } =
				getMentionRequestContext(mentions);

			const result = await submitChatTurn({
				attachedFiles,
				buildRequestBody: () =>
					buildWorkspaceChatRequestBody({
						localFolderStorageScope,
						mentions: mentionIds,
						model: selectedModel.model,
						reasoningEffort: selectedReasoningEffort,
						resolveConvexToken: getCachedConvexToken,
						selectedSourceIds: requestSelectedSourceIds,
						text: value,
						webSearchEnabled,
						workspaceId: activeWorkspaceId,
					}),
				chatId,
				displayActiveRun,
				editingMessageId,
				enqueueQueuedMessage,
				metadata,
				onOptimisticMessage: (message) => {
					optimisticMessageId = message.id;
					// react-doctor-disable-next-line react-doctor/no-flush-sync
					flushSync(() => {
						setEditingMessageId(null);
						clearDraft();
						setAttachedFiles([]);
						setLocalOptimisticMessages((currentState) => ({
							chatId,
							messages: normalizeChatMessages([
								...(currentState?.chatId === chatId
									? currentState.messages
									: []),
								message,
							]),
						}));
						setMessages((currentMessages) =>
							normalizeChatMessages([...currentMessages, message]),
						);
					});
				},
				onRequestPrepared: ({ localFolders, requestBody }) => {
					setSharedLocalFolders(localFolders);
					latestRequestBodyRef.current = requestBody;
				},
				onQueuedMessageSaved: ({ optimisticMessageId, queuedMessage }) => {
					setQueuedMessages((messages) =>
						messages.map((message) =>
							message._id === optimisticMessageId ? queuedMessage : message,
						),
					);
				},
				queueActiveRun:
					displayActiveRun ?? (isAiRequestPending ? activeRun : null),
				sendMessage,
				text: value,
				workspaceId: activeWorkspaceId,
			});

			if (result.status === "queued") {
				setEditingMessageId(null);
				clearDraft();
				setAttachedFiles([]);
				await waitForBrowserPaint();
				setIsPreparingRequest(false);
				return;
			}
			setIsPreparingRequest(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to prepare chat request",
			});
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to prepare chat request",
			);
			if (optimisticMessageId) {
				const failedOptimisticMessageId = optimisticMessageId;
				setLocalOptimisticMessages((currentState) =>
					currentState?.chatId === chatId
						? {
								chatId,
								messages: removeChatMessageById(
									currentState.messages,
									failedOptimisticMessageId,
								),
							}
						: currentState,
				);
				setMessages((currentMessages) =>
					removeChatMessageById(currentMessages, failedOptimisticMessageId),
				);
			}
			setDraft(value);
			setDraftMetadata(mentions.length > 0 ? { mentions } : null);
			setAttachedFiles(attachedFiles);
			setIsPreparingRequest(false);
		}
	}, [
		activeWorkspaceId,
		activeRun,
		attachedFiles,
		chatId,
		displayActiveRun,
		editingMessageId,
		enqueueQueuedMessage,
		finishQueuedMessageEdit,
		getDraftSnapshot,
		isAiRequestPending,
		isAutomationRunning,
		isChatRequestPending,
		localFolderStorageScope,
		mentions,
		onChatPersisted,
		queuedMessageEditDraft,
		clearDraft,
		setDraft,
		setDraftMetadata,
		selectedReasoningEffort,
		selectedModel.model,
		sendMessage,
		setMessages,
		setQueuedMessages,
		updateQueuedMessage,
		webSearchEnabled,
	]);

	const submitAutomationConfirmationResponse = React.useCallback(
		async (text: string) => {
			const outgoingText = text.trim();
			if (
				!outgoingText ||
				hasUploadingAttachments(attachedFiles) ||
				(isChatRequestPending && !displayActiveRun && !activeRun) ||
				isAutomationRunning
			) {
				return;
			}

			setIsPreparingRequest(true);
			await submitAutomationConfirmationChatTurn({
				activeRun,
				activeWorkspaceId,
				buildRequestBody: (confirmationText) =>
					buildWorkspaceChatRequestBody({
						localFolderStorageScope,
						mentions: [],
						model: selectedModel.model,
						reasoningEffort: selectedReasoningEffort,
						resolveConvexToken: getCachedConvexToken,
						selectedSourceIds: [],
						text: confirmationText,
						webSearchEnabled,
						workspaceId: activeWorkspaceId,
					}),
				chatId,
				displayActiveRun,
				enqueueQueuedMessage,
				isAiRequestPending,
				onBeforeSubmit: () => {
					// react-doctor-disable-next-line react-doctor/no-event-handler
					onChatPersisted?.(chatId);
				},
				onFinally: () => {
					setIsPreparingRequest(false);
				},
				onRequestPrepared: ({ localFolders, requestBody }) => {
					setSharedLocalFolders(localFolders);
					latestRequestBodyRef.current = requestBody;
				},
				sendMessage,
				setLocalOptimisticMessages,
				setMessages,
				setQueuedMessages,
				text: outgoingText,
			});
		},
		[
			activeWorkspaceId,
			activeRun,
			attachedFiles,
			chatId,
			displayActiveRun,
			enqueueQueuedMessage,
			isAiRequestPending,
			isAutomationRunning,
			isChatRequestPending,
			localFolderStorageScope,
			onChatPersisted,
			selectedReasoningEffort,
			selectedModel.model,
			sendMessage,
			setMessages,
			setQueuedMessages,
			webSearchEnabled,
		],
	);

	const handleAutomationConfirmationCancel = React.useCallback(() => {
		if (!automationDeleteConfirmation) {
			return;
		}

		void submitAutomationConfirmationResponse(
			`Cancel deletion of automation ${automationDeleteConfirmation.automationId}.`,
		);
	}, [automationDeleteConfirmation, submitAutomationConfirmationResponse]);

	const handleAutomationConfirmationConfirm = React.useCallback(() => {
		if (!automationDeleteConfirmation) {
			return;
		}

		void submitAutomationConfirmationResponse(
			`Confirm delete automation ${automationDeleteConfirmation.automationId}.`,
		);
	}, [automationDeleteConfirmation, submitAutomationConfirmationResponse]);

	const handleAutomationConfirmationTextAnswer = React.useCallback(
		(answer: string) => {
			if (!automationDeleteConfirmation) {
				return;
			}

			void submitAutomationConfirmationResponse(answer);
		},
		[automationDeleteConfirmation, submitAutomationConfirmationResponse],
	);

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
		const stopPromise = queuedFollowUp
			? sendQueuedFollowUpNow()
			: stopCurrentStream();

		void stopPromise.catch((error) => {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to stop chat stream",
			});
			toast.error(
				error instanceof Error ? error.message : "Failed to stop chat stream",
			);
		});
	}, [queuedFollowUp, sendQueuedFollowUpNow, stopCurrentStream]);

	const handleEditMessage = React.useCallback(
		(
			messageId: string,
			text: string,
			messageMentions: ChatComposerMention[],
		) => {
			if (canStop) {
				handleStop();
			}

			setEditingMessageId(messageId);
			setDraft(text);
			setDraftMetadata(
				messageMentions.length > 0 ? { mentions: messageMentions } : null,
			);
			setAttachedFiles([]);
		},
		[canStop, handleStop, setDraft, setDraftMetadata],
	);

	const handleCancelEdit = React.useCallback(() => {
		restoreEditedQueuedMessage();
		setEditingMessageId(null);
		clearDraft();
		setAttachedFiles([]);
	}, [clearDraft, restoreEditedQueuedMessage]);

	const buildRequestBody = React.useCallback(async () => {
		const { mentionIds, requestSelectedSourceIds } =
			getMentionRequestContext(mentions);

		return await buildWorkspaceChatRequestBodyFromLocalFolders({
			localFolders: sharedLocalFolders,
			mentions: mentionIds,
			model: selectedModel.model,
			reasoningEffort: selectedReasoningEffort,
			resolveConvexToken: getCachedConvexToken,
			selectedSourceIds: requestSelectedSourceIds,
			webSearchEnabled,
			workspaceId: activeWorkspaceId,
		});
	}, [
		activeWorkspaceId,
		mentions,
		selectedReasoningEffort,
		selectedModel.model,
		sharedLocalFolders,
		webSearchEnabled,
	]);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			if (canStop) {
				handleStop();
			}

			setPendingTruncateMessageId(messageId);
			setMessages((currentMessages) =>
				normalizeChatMessages(getMessagesBefore(currentMessages, messageId)),
			);
			setLocalOptimisticMessages((currentMessages) =>
				currentMessages?.chatId === chatId
					? {
							chatId,
							messages: normalizeChatMessages(
								getMessagesBefore(currentMessages.messages, messageId),
							),
						}
					: currentMessages,
			);
			setEditingMessageId(null);
			clearDraft();

			if (!activeWorkspaceId) {
				return;
			}

			void truncateFromMessage({
				workspaceId: activeWorkspaceId,
				chatId,
				messageId,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete message",
				});
				toast.error("Failed to delete message");
				setPendingTruncateMessageId(null);
			});
		},
		[
			activeWorkspaceId,
			canStop,
			chatId,
			handleStop,
			setMessages,
			clearDraft,
			truncateFromMessage,
		],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (canStop) {
				await stopCurrentStream();
			}

			setIsPreparingRequest(true);

			try {
				const requestBody = await buildRequestBody();
				const regenerationMessages = getRegenerationMessages({
					assistantMessageId,
					messages: persistedMessages,
				});
				latestRequestBodyRef.current = requestBody;
				setEditingMessageId(null);
				clearDraft();
				setMessages(regenerationMessages);
				void Promise.resolve(
					regenerate({
						messageId: assistantMessageId,
						body: requestBody,
					}),
				).finally(() => {
					setIsPreparingRequest(false);
				});
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to prepare chat regeneration",
				});
				setIsPreparingRequest(false);
			}
		},
		[
			buildRequestBody,
			canStop,
			clearDraft,
			persistedMessages,
			regenerate,
			setMessages,
			stopCurrentStream,
		],
	);
	const handleOpenMention = React.useCallback((sourceId: string) => {
		setSummaryOpen(true);
		setSummaryOpenSourceRequest((current) => ({
			sourceId,
			requestId: (current?.requestId ?? 0) + 1,
		}));
	}, []);
	const visibleActiveStreamingChatIds = React.useMemo(() => {
		if (!hasLocallyCompletedAssistantMessage) {
			// react-doctor-disable-next-line react-doctor/no-event-handler
			return activeStreamingChatIds;
		}

		const ids = new Set(activeStreamingChatIds);
		ids.delete(chatId);
		return ids;
	}, [activeStreamingChatIds, chatId, hasLocallyCompletedAssistantMessage]);

	return {
		contextPages,
		currentChatTitle: currentChat?.title ?? "",
		draft,
		error,
		attachedFiles,
		setAttachedFiles,
		handleDraftKeyDown,
		handleSubmit,
		handleStop,
		handleWebSearchEnabledChange,
		hasMessages,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		activeStreamingChatIds: visibleActiveStreamingChatIds,
		canStop,
		isLoading: isChatUiPending,
		isNotesLoading,
		messages: displayMessages,
		streamingMessageIds,
		modelPopoverOpen,
		selectedModel: isModelResolving ? null : selectedModel,
		reasoningEffort: selectedReasoningEffort,
		setDraft,
		setMentions: handleMentionsChange,
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
		automationDeleteConfirmation,
		isAutomationConfirmationSubmitting: isPreparingRequest,
		onAutomationConfirmationCancel: handleAutomationConfirmationCancel,
		onAutomationConfirmationConfirm: handleAutomationConfirmationConfirm,
		onAutomationConfirmationTextAnswer: handleAutomationConfirmationTextAnswer,
		editingMessageId,
		mentions,
		handleCancelEdit,
		queuedFollowUps,
		onQueuedFollowUpsReorder,
		onDeleteMessage: handleDeleteMessage,
		onOpenMention: handleOpenMention,
		onEditMessage: handleEditMessage,
		onRegenerateMessage: handleRegenerateMessage,
	};
};

// oxlint-disable-next-line react-doctor/no-giant-component -- Page-level orchestrator wires chat state, search, history, and summary surfaces.
export function ChatPage({
	chatId,
	onChatPersisted,
	chats,
	isChatsLoading,
	activeStreamingChatIds,
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
		// react-doctor-disable-next-line react-doctor/no-event-handler
		chatId,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		onChatPersisted,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		chats,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		isChatsLoading,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		activeStreamingChatIds,
	});
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
		// react-doctor-disable-next-line react-doctor/no-event-handler
		controller.hasMessages || activeChatId === chatId;
	const canSearchMessages =
		shouldShowActiveChatSurface && controller.hasMessages;
	const queuedFollowUps =
		activeChatId === chatId ? controller.queuedFollowUps : [];
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
	const viewportRef = React.useCallback((node: HTMLDivElement | null) => {
		historyViewportRef.current = node;
	}, []);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const canShowChatSummary = activeChatId === chatId;
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const chatHistoryStreamingChatIds = React.useMemo(() => {
		const ids = new Set(controller.activeStreamingChatIds);

		if (controller.isLoading && controller.hasMessages) {
			ids.add(chatId);
		}

		return ids;
	}, [
		chatId,
		controller.activeStreamingChatIds,
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
			// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
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

		const messageElement = getChatMessageElement(
			activeMessageSearchMatch.messageId,
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
			const messageElement = document.querySelector<HTMLElement>(
				`[data-chat-message-id="${escapeChatMessageSelectorValue(match.messageId)}"]`,
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
	// The shell header is outside this scroll viewport. Short active chats still
	// need to fill the remaining viewport so the sticky composer dock lands at
	// the same position as long chats without forcing empty-chat overflow.
	const chatSurfaceMinHeightClass = isDesktopMac
		? "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-3.5rem)]"
		: "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-4rem)]";
	const composer = (
		<ChatComposer
			useCompactLayout={shouldShowActiveChatSurface}
			draft={controller.draft}
			placeholder={
				controller.hasMessages
					? "Ask for follow-up"
					: "Ask anything. @ to use tools or mention notes"
			}
			automationConfirmation={controller.automationDeleteConfirmation}
			isAutomationConfirmationSubmitting={
				controller.isAutomationConfirmationSubmitting
			}
			onAutomationConfirmationCancel={controller.onAutomationConfirmationCancel}
			onAutomationConfirmationConfirm={
				controller.onAutomationConfirmationConfirm
			}
			onAutomationConfirmationTextAnswer={
				controller.onAutomationConfirmationTextAnswer
			}
			queuedFollowUps={queuedFollowUps}
			onQueuedFollowUpsReorder={controller.onQueuedFollowUpsReorder}
			onDraftChange={controller.setDraft}
			onDraftKeyDown={controller.handleDraftKeyDown}
			mentions={controller.mentions}
			onSubmit={controller.handleSubmit}
			onStop={controller.handleStop}
			attachedFiles={controller.attachedFiles}
			onAttachedFilesChange={controller.setAttachedFiles}
			canStop={controller.canStop}
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
			appSources={controller.appSources}
			onOpenConnectionsSettings={onOpenConnectionsSettings}
			editingMessageId={controller.editingMessageId}
			onCancelEdit={controller.handleCancelEdit}
		/>
	);

	return (
		<>
			<MessageScrollerProvider autoScroll>
				<MessageScroller className="min-h-0 flex-1">
					<MessageScrollerViewport
						ref={viewportRef}
						className="overscroll-contain [overflow-anchor:none]"
					>
						<div className="box-border flex w-full max-w-full min-w-0 flex-1 justify-center px-4 md:px-6">
							<div
								className={cn(
									"relative flex min-h-0 w-full min-w-0 max-w-5xl flex-1 flex-col",
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
													dispatchMessageSearch({
														type: "setQuery",
														query: value,
													});
												}}
												matchCount={messageSearchMatches.length}
												matchIndex={
													messageSearchMatches.length > 0
														? messageSearchIndex
														: -1
												}
												onPrevious={handleMessageSearchPrevious}
												onNext={handleMessageSearchNext}
												onClose={() => dispatchMessageSearch({ type: "close" })}
												onKeyDown={handleMessageSearchKeyDown}
											/>
										) : null}
										<div className="flex-1 pt-8 pb-28 md:pb-32">
											<ChatMessagesEntry
												messages={controller.messages}
												error={controller.error}
												isLoading={controller.isLoading}
												onDeleteMessage={controller.onDeleteMessage}
												onEditMessage={controller.onEditMessage}
												onOpenMention={controller.onOpenMention}
												onPlusAction={handleCreateNoteFromResponse}
												onRegenerateMessage={controller.onRegenerateMessage}
												streamingMessageIds={controller.streamingMessageIds}
											/>
										</div>

										<div className="sticky bottom-0 z-10 mt-auto h-0">
											<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
												<div className="pointer-events-auto relative mx-auto w-[calc(100%-2rem)] min-w-0 max-w-full md:max-w-xl">
													<div
														aria-hidden="true"
														className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-background to-transparent"
													/>
													{controller.hasMessages ? (
														<MessageScrollerButton
															aria-label="Scroll to latest messages"
															className="!bottom-[calc(100%+0.75rem)] size-8 rounded-full"
														/>
													) : null}
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
													activeStreamingChatIds={chatHistoryStreamingChatIds}
													onAddAutomation={onAddAutomation}
												/>
											</div>
										</div>
									</div>
								)}
								{shouldShowActiveChatSurface ? (
									<div className="pointer-events-none absolute top-0 right-0 hidden h-full lg:block">
										<div className="pointer-events-auto sticky top-1/2 -translate-y-1/2">
											<ChatUserMessageNavigationRail
												messages={controller.messages}
											/>
										</div>
									</div>
								) : null}
							</div>
						</div>
					</MessageScrollerViewport>
				</MessageScroller>
			</MessageScrollerProvider>
			{canShowChatSummary ? (
				<ChatSummarySheetEntry
					open={controller.summaryOpen}
					messages={controller.messages}
					automation={currentAutomation}
					chatTitle={controller.currentChatTitle}
					desktopSafeTop={isDesktopMac}
					workspaceSources={controller.workspaceSources}
					openSourceRequest={controller.summaryOpenSourceRequest}
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
