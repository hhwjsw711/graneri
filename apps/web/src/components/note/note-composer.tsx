import { useChat } from "@ai-sdk/react";
import {
	canOpenDesktopSoundSettings,
	openDesktopSoundSettings,
} from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@workspace/ui/components/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import {
	Sidebar,
	useDockedPanelWidths,
	useSidebarRight,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart, UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
	ArrowDown,
	ArrowUp,
	AtSign,
	AudioWaveform,
	Check,
	ChevronUp,
	Copy,
	LoaderCircle,
	Minus,
	PanelBottom,
	PanelRight,
	PanelRightDashed,
	PenLine,
	Plus,
	RotateCcw,
	SlidersHorizontal,
	Square,
	Trash2,
	WandSparkles,
	X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	type ChatAttachment,
	FileAttachmentButton,
	FileAttachmentChips,
	getReadyFileParts,
	hasUploadingAttachments,
	useFileAttachmentDropzone,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/file-attachment-controls";
import { CHAT_ACTIONS_VISIBILITY_CLASS } from "@/components/chat/message-layout";
import { ChatMessageListContent } from "@/components/chat/message-list";
import {
	type ChatModel,
	ChatModelPicker,
} from "@/components/chat/model-picker";
import {
	COMPOSER_DOCK_BOTTOM_OFFSET,
	COMPOSER_OVERLAY_FOOTER_PADDING,
	COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS as NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS,
} from "@/components/layout/composer-dock";
import { parseCssLengthToPixels } from "@/components/layout/parse-css-length";
import {
	ResizableSidePanelHandle,
	ResizableTopPanelHandle,
	useResizableSidePanel,
	useResizeHandle,
} from "@/components/layout/resizable-side-panel";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import {
	prefetchChatMessagesSnapshot,
	useChatMessagesSnapshot,
} from "@/hooks/use-chat-messages-snapshot";
import { useNoteTranscriptSession } from "@/hooks/use-note-transcript-session";
import { useStickyScrollToBottom } from "@/hooks/use-sticky-scroll-to-bottom";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";
import { defaultChatModel, findChatModel } from "@/lib/ai/models";
import { getUIMessageSeedKey, toStoredChatMessages } from "@/lib/chat-snapshot";
import { getMessagesBefore } from "@/lib/chat-thread";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import { ENHANCED_NOTE_TEMPLATE_SLUG } from "@/lib/note-templates";
import {
	getRecipeIcon,
	type RecipePrompt,
	type RecipeSlug,
} from "@/lib/recipes";
import { formatTranscriptElapsed } from "@/lib/transcript";
import {
	getTranscriptionLanguageSelectValue,
	OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
	PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
	parseTranscriptionLanguageSelectValue,
} from "@/lib/transcription-languages";
import { transcriptionSessionManager } from "@/lib/transcription-session-manager";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { SpeechInput } from "../ai-elements/speech-input";
import {
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	DESKTOP_DOCKED_PANEL_MAX_WIDTH,
	DESKTOP_DOCKED_PANEL_MIN_WIDTH,
	MOBILE_DOCKED_PANEL_MIN_WIDTH,
} from "../layout/docked-panel-dimensions";

type NoteChatPresentation = "inline" | "floating" | "sidebar";
const NOTE_CHAT_FLOATING_WIDTH = "min(28rem, calc(100vw - 2rem))";
const NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX =
	"opengran.noteComposer.floatingHeight";
const NOTE_CHAT_FLOATING_DEFAULT_HEIGHT = 512;
const NOTE_CHAT_PANEL_MIN_HEIGHT = 320;
const NOTE_CHAT_PANEL_MAX_HEIGHT = 680;
const NOTE_CHAT_OVERLAY_VIEWPORT_INSET = 112;
const NOTE_CHAT_PANEL_DOCK_OFFSET =
	COMPOSER_DOCK_BOTTOM_OFFSET - COMPOSER_OVERLAY_FOOTER_PADDING;
const NOTE_CHAT_INLINE_PANEL_DOCK_OFFSET = COMPOSER_OVERLAY_FOOTER_PADDING;
const INLINE_POPOVER_FOOTER_CONTAINER_CLASS = "px-6 pt-2 pb-4";
const NOTE_COMPOSER_FOOTER_SURFACE_CLASS =
	"min-h-[96px] max-w-full overflow-hidden rounded-lg border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 data-[drag-over=true]:border-ring data-[drag-over=true]:ring-3 data-[drag-over=true]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/30";
const NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-0 pt-2.5";
const NOTE_COMPOSER_FOOTER_BODY_CLASS =
	"min-h-[40px] max-h-52 overflow-y-auto pt-2 pb-0 text-base font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0";
const NOTE_COMPOSER_FOOTER_BODY_SPACER_CLASS =
	"min-h-[40px] w-full shrink-0 px-4 pt-2 pb-0";
const NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-2.5";
const INLINE_POPOVER_FOOTER_DEFAULT_HEIGHT = 120;
const INLINE_POPOVER_DEFAULT_HEIGHT = 384;
const INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX =
	"opengran.noteComposer.inlinePopoverHeight";
const INLINE_POPOVER_HEIGHT_LEGACY_STORAGE_KEY =
	"opengran.noteComposer.inlinePopoverHeight";
const NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX =
	"opengran.noteComposer.sidebarWidth";
const TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD = 32;
const TRANSCRIPT_INITIAL_WINDOW_SIZE = 32;

const getNoteStorageScopeKey = (noteId: Id<"notes"> | null) =>
	noteId ? `note:${noteId}` : "note:draft";

const getNoteScopedStorageKey = ({
	prefix,
	noteScopeKey,
	platform,
}: {
	prefix: string;
	noteScopeKey: string;
	platform: "desktop" | "mobile";
}) => `${prefix}.${noteScopeKey}.${platform}`;

const getStoredChatModel = (model: string | undefined): ChatModel | null =>
	model ? (findChatModel(model) ?? null) : null;

const readStoredPanelHeight = (
	storageKeys: string | string[],
	fallback: number,
) => {
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const candidateKeys = Array.isArray(storageKeys)
			? storageKeys
			: [storageKeys];

		for (const storageKey of candidateKeys) {
			const storedValue = window.localStorage.getItem(storageKey);

			if (!storedValue) {
				continue;
			}

			const parsedValue = Number(storedValue);

			if (Number.isFinite(parsedValue)) {
				return parsedValue;
			}
		}

		return fallback;
	} catch {
		return fallback;
	}
};

const storePanelHeight = (storageKeys: string | string[], height: number) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const candidateKeys = Array.isArray(storageKeys)
			? storageKeys
			: [storageKeys];

		for (const storageKey of candidateKeys) {
			window.localStorage.setItem(storageKey, String(height));
		}
	} catch {
		// Ignore storage failures and keep the in-memory size.
	}
};

type NoteChatSummary = Pick<
	Doc<"chats">,
	| "_id"
	| "_creationTime"
	| "chatId"
	| "createdAt"
	| "model"
	| "title"
	| "updatedAt"
>;

type NoteComposerProps = {
	noteContext: {
		noteId: string | null;
		templateSlug?: string | null;
		title?: string;
		text?: string;
	};
	desktopSafeTop?: boolean;
	getNoteContext?: () => {
		noteId: string | null;
		templateSlug?: string | null;
		title: string;
		text: string;
	};
	autoStartTranscription?: boolean;
	onAutoStartTranscriptionHandled?: () => void;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
	onEnhanceTranscript?: (transcript: string) => Promise<void>;
	stopTranscriptionWhenMeetingEnds?: boolean;
};

const isSameCalendarDay = (left: Date, right: Date) =>
	left.getFullYear() === right.getFullYear() &&
	left.getMonth() === right.getMonth() &&
	left.getDate() === right.getDate();

const groupChatsForSelector = (chats: NoteChatSummary[]) => {
	const now = new Date();

	return chats.reduce<{
		today: NoteChatSummary[];
		previous: NoteChatSummary[];
	}>(
		(groups, chat) => {
			const chatDate = new Date(
				chat.updatedAt || chat.createdAt || chat._creationTime,
			);

			if (isSameCalendarDay(chatDate, now)) {
				groups.today.push(chat);
			} else {
				groups.previous.push(chat);
			}

			return groups;
		},
		{ today: [], previous: [] },
	);
};

const findRecipeTriggerRange = (value: string, cursorPosition: number) => {
	const textBeforeCursor = value.slice(0, cursorPosition);
	const triggerStart = textBeforeCursor.lastIndexOf("@");

	if (triggerStart === -1) {
		return null;
	}

	const characterBeforeTrigger = value[triggerStart - 1];
	if (characterBeforeTrigger && !/\s/.test(characterBeforeTrigger)) {
		return null;
	}

	const triggerText = value.slice(triggerStart + 1, cursorPosition);
	if (/\s/.test(triggerText)) {
		return null;
	}

	return {
		start: triggerStart,
		end: cursorPosition,
		query: triggerText,
	};
};

const createDraftChatId = (): string => crypto.randomUUID();

const resolveStateUpdate = <T,>(
	value: React.SetStateAction<T>,
	currentValue: T,
): T =>
	typeof value === "function"
		? (value as (previousValue: T) => T)(currentValue)
		: value;

const useNoteComposerController = ({
	noteContext,
	getNoteContext,
	autoStartTranscription,
	onAutoStartTranscriptionHandled,
	onEnhanceTranscript,
	stopTranscriptionWhenMeetingEnds,
}: NoteComposerProps) => {
	const { isMobile, state } = useSidebarShell();
	const {
		rightMode,
		rightOpen,
		rightOpenMobile,
		setHasRightSidebar,
		setRightMode,
		setRightOpen,
		setRightOpenMobile,
		setRightSidebarWidthMobileOverride,
		setRightSidebarWidthOverride,
	} = useSidebarRight();
	const { rightInsetPanelWidth } = useDockedPanelWidths();
	const [message, setMessage] = React.useState("");
	const [, setIsExpanded] = React.useState(false);
	const [panelModeState, setPanelModeState] = React.useState<
		"chat" | "transcript" | null
	>(null);
	const [presentationModeState, setPresentationModeState] =
		React.useState<NoteChatPresentation>("inline");
	const [currentChatId, setCurrentChatId] = React.useState<string>(() =>
		createDraftChatId(),
	);
	const [isPreparingRequest, setIsPreparingRequest] = React.useState(false);
	const [, startTranscriptPanelTransition] = React.useTransition();
	const noteId = (noteContext.noteId as Id<"notes"> | null) ?? null;
	const noteStorageScopeKey = getNoteStorageScopeKey(noteId);
	const inlinePopoverHeightStorageKey = isMobile
		? getNoteScopedStorageKey({
				prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
				noteScopeKey: noteStorageScopeKey,
				platform: "mobile",
			})
		: getNoteScopedStorageKey({
				prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
				noteScopeKey: noteStorageScopeKey,
				platform: "desktop",
			});
	const floatingPanelHeightStorageKey = isMobile
		? getNoteScopedStorageKey({
				prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
				noteScopeKey: noteStorageScopeKey,
				platform: "mobile",
			})
		: getNoteScopedStorageKey({
				prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
				noteScopeKey: noteStorageScopeKey,
				platform: "desktop",
			});
	const [inlinePanelHeight, setInlinePanelHeight] = React.useState(() =>
		readStoredPanelHeight(
			typeof window !== "undefined" && window.innerWidth < 768
				? getNoteScopedStorageKey({
						prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
						noteScopeKey: noteStorageScopeKey,
						platform: "mobile",
					})
				: getNoteScopedStorageKey({
						prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
						noteScopeKey: noteStorageScopeKey,
						platform: "desktop",
					}),
			INLINE_POPOVER_DEFAULT_HEIGHT,
		),
	);
	const [floatingPanelHeight, setFloatingPanelHeight] = React.useState(() =>
		readStoredPanelHeight(
			typeof window !== "undefined" && window.innerWidth < 768
				? getNoteScopedStorageKey({
						prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
						noteScopeKey: noteStorageScopeKey,
						platform: "mobile",
					})
				: getNoteScopedStorageKey({
						prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
						noteScopeKey: noteStorageScopeKey,
						platform: "desktop",
					}),
			NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
		),
	);
	const [recipePopoverOpen, setRecipePopoverOpen] = React.useState(false);
	const [modelPopoverOpen, setModelPopoverOpen] = React.useState(false);
	const [selectedModelOverride, setSelectedModelOverride] = React.useState<{
		chatId: string;
		model: ChatModel;
	} | null>(null);
	const [selectedRecipeSlug, setSelectedRecipeSlug] =
		React.useState<RecipeSlug | null>(null);
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	useRevokeAttachmentObjectUrls(attachedFiles);
	const rootRef = React.useRef<HTMLDivElement>(null);
	const inlinePanelRef = React.useRef<HTMLDivElement>(null);
	const textareaRef = React.useRef<HTMLTextAreaElement>(null);
	const reservedCommentsPanelWidth = React.useMemo(
		() => parseCssLengthToPixels(rightInsetPanelWidth ?? undefined),
		[rightInsetPanelWidth],
	);
	const leftSidebarReservedWidth =
		state === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const {
		handleResizeKeyDown: handleSidebarResizeKeyDown,
		handleResizeStart: handleSidebarResizeStart,
		isResizing: isSidebarResizing,
		panelWidth: sidebarPanelWidth,
	} = useResizableSidePanel({
		isMobile,
		side: "right",
		desktopStorageKey: getNoteScopedStorageKey({
			prefix: NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX,
			noteScopeKey: noteStorageScopeKey,
			platform: "desktop",
		}),
		mobileStorageKey: getNoteScopedStorageKey({
			prefix: NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX,
			noteScopeKey: noteStorageScopeKey,
			platform: "mobile",
		}),
		defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
		desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
		desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
		mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
		desktopLeadingOffset: leftSidebarReservedWidth,
		desktopTrailingOffset: reservedCommentsPanelWidth,
	});
	const {
		containerRef: chatViewportRef,
		isAtBottom: isChatViewportAtBottom,
		scrollToBottom: scrollChatToBottom,
	} = useStickyScrollToBottom();
	const previousSpeechListeningRef = React.useRef(false);
	const panelModeRef = React.useRef(panelModeState);
	const presentationModeRef = React.useRef(presentationModeState);
	const shouldFocusInlineChatRef = React.useRef(false);
	const panelMode = panelModeState;
	const presentationMode = presentationModeState;

	const readNoteContext = React.useCallback(
		() =>
			getNoteContext?.() ?? {
				noteId: noteContext.noteId,
				templateSlug: noteContext.templateSlug,
				title: noteContext.title ?? "",
				text: noteContext.text ?? "",
			},
		[
			getNoteContext,
			noteContext.noteId,
			noteContext.templateSlug,
			noteContext.text,
			noteContext.title,
		],
	);
	const activeWorkspaceId = useActiveWorkspaceId();
	const convex = useConvex();
	const previousChatIdRef = React.useRef(currentChatId);
	const previousNoteIdRef = React.useRef(noteId);
	const noteChats = useQuery(
		api.chats.listForNote,
		noteId && activeWorkspaceId
			? {
					workspaceId: activeWorkspaceId,
					noteId,
				}
			: "skip",
	);
	const hasStoredCurrentChat = React.useMemo(
		() => (noteChats ?? []).some((chat) => chat.chatId === currentChatId),
		[currentChatId, noteChats],
	);
	const { messages: storedMessages } = useChatMessagesSnapshot({
		chatId: hasStoredCurrentChat ? currentChatId : null,
		workspaceId: activeWorkspaceId,
	});
	const currentChatSession = useQuery(
		api.chats.getSession,
		activeWorkspaceId
			? {
					workspaceId: activeWorkspaceId,
					chatId: currentChatId,
				}
			: "skip",
	);
	const selectedNoteChat =
		(noteChats ?? []).find((chat) => chat.chatId === currentChatId) ?? null;
	const selectedModel =
		(selectedModelOverride?.chatId === currentChatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(selectedNoteChat?.model ?? currentChatSession?.model) ??
		defaultChatModel;
	const updateUserPreferences = useMutation(api.userPreferences.update);
	const truncateFromMessage = useMutation(api.chats.truncateFromMessage);
	const persistChatModel = useMutation(api.chats.setModel);
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			setSelectedModelOverride({ chatId: currentChatId, model });

			if (!activeWorkspaceId || currentChatSession?.model === model.model) {
				return;
			}

			void persistChatModel({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				model: model.model,
			}).catch((error) => {
				console.error("Failed to persist note chat model", error);
				toast.error("Failed to save model");
			});
		},
		[
			activeWorkspaceId,
			currentChatId,
			currentChatSession?.model,
			persistChatModel,
		],
	);
	const recipeData = useQuery(
		api.recipes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const userPreferences = useQuery(api.userPreferences.get, {});
	const [isSavingTranscriptionLanguage, setIsSavingTranscriptionLanguage] =
		React.useState(false);
	const isTranscriptionLanguageReady = userPreferences !== undefined;
	const transcriptionLanguage = isTranscriptionLanguageReady
		? (userPreferences?.transcriptionLanguage ?? null)
		: undefined;
	const transcriptionLanguageSelectValue = getTranscriptionLanguageSelectValue(
		transcriptionLanguage,
	);
	const shouldLoadStoredTranscriptHistory = panelModeState === "transcript";
	const transcriptionSessionState = useTranscriptionSession();

	const handleTranscriptionLanguageChange = React.useCallback(
		async (value: string) => {
			setIsSavingTranscriptionLanguage(true);

			try {
				await updateUserPreferences({
					transcriptionLanguage: parseTranscriptionLanguageSelectValue(value),
				});
			} catch (error) {
				console.error("Failed to update transcription language", error);
				toast.error("Failed to update transcription language");
			} finally {
				setIsSavingTranscriptionLanguage(false);
			}
		},
		[updateUserPreferences],
	);
	const transcriptSession = useNoteTranscriptSession({
		autoStartTranscription:
			autoStartTranscription && isTranscriptionLanguageReady,
		noteId,
		onAutoStartTranscriptionHandled,
		onEnhanceTranscript,
		shouldLoadStoredTranscriptHistory,
		stopTranscriptionWhenMeetingEnds,
		transcriptionLanguage,
	});
	const isCurrentNoteSpeechListening =
		transcriptSession.isCurrentNoteSpeechListening;
	const hasActiveTranscriptionInDifferentScope =
		transcriptionSessionState.scopeKey !== null &&
		transcriptionSessionState.scopeKey !==
			transcriptSession.currentNoteScopeKey &&
		(transcriptionSessionState.isListening ||
			transcriptionSessionState.isConnecting);

	const handlePrefetchNoteChat = React.useCallback(
		(chatId: string) => {
			if (!activeWorkspaceId) {
				return;
			}

			void prefetchChatMessagesSnapshot({
				chatId,
				convex,
				workspaceId: activeWorkspaceId,
			}).catch((error) => {
				console.error("Failed to prefetch note chat snapshot", error);
			});
		},
		[activeWorkspaceId, convex],
	);

	React.useEffect(() => {
		if (!isTranscriptionLanguageReady) {
			return;
		}

		transcriptionSessionManager.controller.configure({
			autoStartKey: hasActiveTranscriptionInDifferentScope
				? null
				: transcriptSession.autoStartKey,
			lang: transcriptionLanguage ?? undefined,
			scopeKey: hasActiveTranscriptionInDifferentScope
				? transcriptionSessionState.scopeKey
				: transcriptSession.currentNoteScopeKey,
		});
	}, [
		hasActiveTranscriptionInDifferentScope,
		isTranscriptionLanguageReady,
		transcriptSession.autoStartKey,
		transcriptSession.currentNoteScopeKey,
		transcriptionLanguage,
		transcriptionSessionState.scopeKey,
	]);

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

	const initialMessages = React.useMemo(
		() => toStoredChatMessages(storedMessages ?? []),
		[storedMessages],
	);
	const {
		messages: chatMessages,
		setMessages,
		sendMessage,
		regenerate,
		error: chatError,
		status: chatStatus,
		stop,
	} = useChat({
		id: currentChatId,
		messages: initialMessages,
		transport,
		experimental_throttle: 50,
	});

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);
	const initialMessagesSeedKey = React.useMemo(
		() => getUIMessageSeedKey(initialMessages),
		[initialMessages],
	);
	const appliedInitialMessagesSeedKeyRef = React.useRef(initialMessagesSeedKey);

	React.useEffect(() => {
		const isLocalRequestRunning =
			chatStatus === "submitted" ||
			chatStatus === "streaming" ||
			isPreparingRequest;

		if (previousChatIdRef.current !== currentChatId) {
			previousChatIdRef.current = currentChatId;
			appliedInitialMessagesSeedKeyRef.current = initialMessagesSeedKey;
			setMessages(initialMessages);
			return;
		}

		if (isLocalRequestRunning) {
			return;
		}

		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);

			if (
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedInitialMessagesSeedKeyRef.current
			) {
				appliedInitialMessagesSeedKeyRef.current = initialMessagesSeedKey;
				return initialMessages;
			}

			return currentMessages;
		});
	}, [
		chatStatus,
		currentChatId,
		initialMessages,
		initialMessagesSeedKey,
		isPreparingRequest,
		setMessages,
	]);

	const resetTextareaHeight = React.useCallback(() => {
		if (!textareaRef.current) {
			return;
		}

		textareaRef.current.style.height = "auto";
	}, []);

	const resizeTextarea = React.useCallback(() => {
		if (!textareaRef.current) {
			return;
		}

		textareaRef.current.style.cssText += "height: auto;";
		const nextHeight = textareaRef.current.scrollHeight;
		textareaRef.current.style.height = `${nextHeight}px`;
	}, []);

	const getInlinePanelMaxHeight = React.useCallback(() => {
		if (typeof window === "undefined") {
			return NOTE_CHAT_PANEL_MAX_HEIGHT;
		}

		return Math.max(
			NOTE_CHAT_PANEL_MIN_HEIGHT,
			Math.min(
				NOTE_CHAT_PANEL_MAX_HEIGHT,
				window.innerHeight - NOTE_CHAT_OVERLAY_VIEWPORT_INSET,
			),
		);
	}, []);
	const getFloatingPanelMaxHeight = React.useCallback(() => {
		if (typeof window === "undefined") {
			return NOTE_CHAT_PANEL_MAX_HEIGHT;
		}

		return Math.max(
			NOTE_CHAT_PANEL_MIN_HEIGHT,
			Math.min(
				NOTE_CHAT_PANEL_MAX_HEIGHT,
				window.innerHeight - NOTE_CHAT_OVERLAY_VIEWPORT_INSET,
			),
		);
	}, []);

	const clampInlinePanelHeight = React.useCallback(
		(nextHeight: number) => {
			return Math.min(
				getInlinePanelMaxHeight(),
				Math.max(NOTE_CHAT_PANEL_MIN_HEIGHT, nextHeight),
			);
		},
		[getInlinePanelMaxHeight],
	);
	const clampFloatingPanelHeight = React.useCallback(
		(nextHeight: number) => {
			return Math.min(
				getFloatingPanelMaxHeight(),
				Math.max(NOTE_CHAT_PANEL_MIN_HEIGHT, nextHeight),
			);
		},
		[getFloatingPanelMaxHeight],
	);

	React.useEffect(() => {
		setInlinePanelHeight((currentHeight) =>
			clampInlinePanelHeight(currentHeight),
		);
	}, [clampInlinePanelHeight]);
	React.useEffect(() => {
		setFloatingPanelHeight((currentHeight) =>
			clampFloatingPanelHeight(currentHeight),
		);
	}, [clampFloatingPanelHeight]);

	React.useEffect(() => {
		const handleWindowResize = () => {
			setInlinePanelHeight((currentHeight) =>
				clampInlinePanelHeight(currentHeight),
			);
			setFloatingPanelHeight((currentHeight) =>
				clampFloatingPanelHeight(currentHeight),
			);
		};

		window.addEventListener("resize", handleWindowResize);
		return () => {
			window.removeEventListener("resize", handleWindowResize);
		};
	}, [clampFloatingPanelHeight, clampInlinePanelHeight]);

	React.useEffect(() => {
		setInlinePanelHeight(
			clampInlinePanelHeight(
				readStoredPanelHeight(
					[
						inlinePopoverHeightStorageKey,
						INLINE_POPOVER_HEIGHT_LEGACY_STORAGE_KEY,
					],
					INLINE_POPOVER_DEFAULT_HEIGHT,
				),
			),
		);
	}, [clampInlinePanelHeight, inlinePopoverHeightStorageKey]);

	React.useEffect(() => {
		storePanelHeight(
			[inlinePopoverHeightStorageKey, INLINE_POPOVER_HEIGHT_LEGACY_STORAGE_KEY],
			inlinePanelHeight,
		);
	}, [inlinePanelHeight, inlinePopoverHeightStorageKey]);
	React.useEffect(() => {
		setFloatingPanelHeight(
			clampFloatingPanelHeight(
				readStoredPanelHeight(
					floatingPanelHeightStorageKey,
					NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
				),
			),
		);
	}, [clampFloatingPanelHeight, floatingPanelHeightStorageKey]);
	React.useEffect(() => {
		storePanelHeight(floatingPanelHeightStorageKey, floatingPanelHeight);
	}, [floatingPanelHeight, floatingPanelHeightStorageKey]);

	const inlinePanelResizeStartHeightRef = React.useRef(inlinePanelHeight);
	const inlinePanelResizeStartYRef = React.useRef(0);
	const floatingPanelResizeStartHeightRef = React.useRef(floatingPanelHeight);
	const floatingPanelResizeStartYRef = React.useRef(0);
	const handleInlinePanelResizeKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			let nextHeight: number | null = null;

			switch (event.key) {
				case "ArrowUp":
					nextHeight = inlinePanelHeight + 24;
					break;
				case "ArrowDown":
					nextHeight = inlinePanelHeight - 24;
					break;
				case "Home":
					nextHeight = NOTE_CHAT_PANEL_MIN_HEIGHT;
					break;
				case "End":
					nextHeight = getInlinePanelMaxHeight();
					break;
				default:
					return;
			}

			event.preventDefault();
			setInlinePanelHeight(clampInlinePanelHeight(nextHeight));
		},
		[clampInlinePanelHeight, getInlinePanelMaxHeight, inlinePanelHeight],
	);
	const {
		handleResizeKeyDown: handleInlinePanelResizeKeyDownInternal,
		handleResizeStart: handleInlinePanelResizeStart,
		isResizing: isInlinePanelResizing,
	} = useResizeHandle({
		cursor: "row-resize",
		onResizeStart: (event) => {
			inlinePanelResizeStartYRef.current = event.clientY;
			inlinePanelResizeStartHeightRef.current =
				inlinePanelRef.current?.getBoundingClientRect().height ??
				inlinePanelHeight;
		},
		onResizeMove: (event) => {
			const nextHeight =
				inlinePanelResizeStartHeightRef.current +
				(inlinePanelResizeStartYRef.current - event.clientY);
			setInlinePanelHeight(clampInlinePanelHeight(nextHeight));
		},
		onKeyDown: handleInlinePanelResizeKeyDown,
	});
	const handleFloatingPanelResizeKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			let nextHeight: number | null = null;

			switch (event.key) {
				case "ArrowUp":
					nextHeight = floatingPanelHeight + 24;
					break;
				case "ArrowDown":
					nextHeight = floatingPanelHeight - 24;
					break;
				case "Home":
					nextHeight = NOTE_CHAT_PANEL_MIN_HEIGHT;
					break;
				case "End":
					nextHeight = getFloatingPanelMaxHeight();
					break;
				default:
					return;
			}

			event.preventDefault();
			setFloatingPanelHeight(clampFloatingPanelHeight(nextHeight));
		},
		[clampFloatingPanelHeight, floatingPanelHeight, getFloatingPanelMaxHeight],
	);
	const {
		handleResizeKeyDown: handleFloatingPanelResizeKeyDownInternal,
		handleResizeStart: handleFloatingPanelResizeStart,
		isResizing: isFloatingPanelResizing,
	} = useResizeHandle({
		cursor: "row-resize",
		onResizeStart: (event) => {
			floatingPanelResizeStartYRef.current = event.clientY;
			floatingPanelResizeStartHeightRef.current = floatingPanelHeight;
		},
		onResizeMove: (event) => {
			const nextHeight =
				floatingPanelResizeStartHeightRef.current +
				(floatingPanelResizeStartYRef.current - event.clientY);
			setFloatingPanelHeight(clampFloatingPanelHeight(nextHeight));
		},
		onKeyDown: handleFloatingPanelResizeKeyDown,
	});

	const isChatOpen = panelMode === "chat";
	const isTranscriptOpen = panelMode === "transcript";
	const isRightSidebarOpen = isMobile ? rightOpenMobile : rightOpen;
	const resolvedPresentationMode = presentationMode;
	const shouldShowInlinePanel =
		resolvedPresentationMode === "inline" || isTranscriptOpen;
	const isFloatingPresentation =
		isChatOpen &&
		resolvedPresentationMode === "floating" &&
		isRightSidebarOpen &&
		rightMode === "floating";
	const isSidebarPresentation =
		isChatOpen &&
		resolvedPresentationMode === "sidebar" &&
		isRightSidebarOpen &&
		rightMode === "sidebar";
	const floatingPanelRightOffset =
		!isMobile && rightInsetPanelWidth
			? `calc(${rightInsetPanelWidth} + 18px)`
			: "18px";
	const hasAdjacentInsetPanel =
		isSidebarPresentation && !isMobile && Boolean(rightInsetPanelWidth);
	const sidebarPanelWidthCss = `${sidebarPanelWidth}px`;
	const activeSidebarWidthOverride = isSidebarPresentation
		? sidebarPanelWidthCss
		: null;
	React.useEffect(() => {
		if (isMobile) {
			return;
		}

		setRightSidebarWidthOverride(activeSidebarWidthOverride);
	}, [activeSidebarWidthOverride, isMobile, setRightSidebarWidthOverride]);
	React.useEffect(() => {
		if (!isMobile) {
			return;
		}

		setRightSidebarWidthMobileOverride(activeSidebarWidthOverride);
	}, [
		activeSidebarWidthOverride,
		isMobile,
		setRightSidebarWidthMobileOverride,
	]);
	React.useEffect(
		() => () => {
			setRightSidebarWidthOverride(null);
		},
		[setRightSidebarWidthOverride],
	);
	React.useEffect(
		() => () => {
			setRightSidebarWidthMobileOverride(null);
		},
		[setRightSidebarWidthMobileOverride],
	);
	const isChatLoading =
		chatStatus === "submitted" ||
		chatStatus === "streaming" ||
		isPreparingRequest;
	const hasMessage = message.trim().length > 0;
	const canGenerateNotes =
		transcriptSession.isTranscriptSessionReady &&
		transcriptSession.hasPendingGenerateTranscript &&
		!transcriptSession.hasGeneratedLatestTranscript &&
		noteContext.templateSlug !== ENHANCED_NOTE_TEMPLATE_SLUG &&
		!isCurrentNoteSpeechListening &&
		!isChatOpen &&
		!isTranscriptOpen;
	const chatTitle =
		selectedNoteChat?.title?.trim() ||
		currentChatSession?.title?.trim() ||
		"New chat";
	const groupedNoteChats = React.useMemo(
		() => groupChatsForSelector(noteChats ?? []),
		[noteChats],
	);
	const latestNoteChat = noteChats?.[0] ?? null;
	const isNoteChatsLoading = Boolean(
		noteId && activeWorkspaceId && noteChats === undefined,
	);
	const hasKnownNoteChat = Boolean(
		latestNoteChat || selectedNoteChat || currentChatSession,
	);
	const composerPlaceholder = isNoteChatsLoading
		? "Continue chat"
		: hasKnownNoteChat
			? "Continue chat"
			: "Ask anything";
	const recipes = React.useMemo(
		() =>
			(recipeData ?? []).map((recipe) => ({
				slug: recipe.slug as RecipeSlug,
				name: recipe.name,
				prompt: recipe.prompt,
			})),
		[recipeData],
	);
	const selectedRecipe =
		recipes.find((recipe) => recipe.slug === selectedRecipeSlug) ?? null;
	const canSendMessage =
		hasMessage || selectedRecipe !== null || attachedFiles.length > 0;

	const setRightSidebarOpen = React.useCallback(
		(open: boolean) => {
			if (isMobile) {
				setRightOpenMobile(open);
				return;
			}

			setRightOpen(open);
		},
		[isMobile, setRightOpen, setRightOpenMobile],
	);

	const setPanelMode = React.useCallback(
		(nextValue: React.SetStateAction<"chat" | "transcript" | null>) => {
			const resolvedValue = resolveStateUpdate(nextValue, panelModeRef.current);
			panelModeRef.current = resolvedValue;
			setPanelModeState(resolvedValue);
			setHasRightSidebar(
				resolvedValue === "chat" && presentationModeRef.current !== "inline",
			);
		},
		[setHasRightSidebar],
	);

	const setPresentationMode = React.useCallback(
		(nextValue: React.SetStateAction<NoteChatPresentation>) => {
			const resolvedValue = resolveStateUpdate(
				nextValue,
				presentationModeRef.current,
			);
			presentationModeRef.current = resolvedValue;
			setPresentationModeState(resolvedValue);
			setHasRightSidebar(
				panelModeRef.current === "chat" && resolvedValue !== "inline",
			);
		},
		[setHasRightSidebar],
	);

	const openRightSidebar = React.useCallback(
		(mode: Exclude<NoteChatPresentation, "inline">) => {
			setPresentationMode(mode);
			setRightMode(mode);
			setRightSidebarOpen(true);
			setPanelMode("chat");
		},
		[setPanelMode, setPresentationMode, setRightMode, setRightSidebarOpen],
	);

	const closeRightSidebar = React.useCallback(() => {
		setRightSidebarOpen(false);
	}, [setRightSidebarOpen]);
	const toggleTranscriptPanel = React.useCallback(() => {
		closeRightSidebar();
		startTranscriptPanelTransition(() => {
			setPanelMode((currentValue) =>
				currentValue === "transcript" ? null : "transcript",
			);
		});
	}, [closeRightSidebar, setPanelMode]);

	const resetComposerForNoteChange = React.useCallback(() => {
		setCurrentChatId(createDraftChatId());
		setMessages([]);
		setEditingMessageId(null);
		setMessage("");
		setAttachedFiles([]);
		setIsExpanded(false);
		setPanelMode(null);
		setSelectedRecipeSlug(null);
		setRecipePopoverOpen(false);
		resetTextareaHeight();
		closeRightSidebar();
	}, [closeRightSidebar, resetTextareaHeight, setMessages, setPanelMode]);

	React.useEffect(() => {
		if (previousNoteIdRef.current === noteId) {
			return;
		}

		previousNoteIdRef.current = noteId;
		previousSpeechListeningRef.current = false;

		if (isChatLoading) {
			stop();
		}

		resetComposerForNoteChange();
	}, [isChatLoading, noteId, resetComposerForNoteChange, stop]);

	React.useEffect(() => {
		if (
			selectedRecipeSlug &&
			!recipes.some((recipe) => recipe.slug === selectedRecipeSlug)
		) {
			setSelectedRecipeSlug(null);
		}
	}, [recipes, selectedRecipeSlug]);

	React.useEffect(
		() => () => {
			setHasRightSidebar(false);
		},
		[setHasRightSidebar],
	);

	React.useEffect(() => {
		if (isCurrentNoteSpeechListening && !previousSpeechListeningRef.current) {
			closeRightSidebar();
		}

		if (!isCurrentNoteSpeechListening && previousSpeechListeningRef.current) {
			closeRightSidebar();
			setPanelMode(null);
		}

		previousSpeechListeningRef.current = isCurrentNoteSpeechListening;
	}, [closeRightSidebar, isCurrentNoteSpeechListening, setPanelMode]);

	React.useEffect(() => {
		if (presentationMode === "inline") {
			return;
		}

		if (!isRightSidebarOpen && panelMode === "chat") {
			setPanelMode(null);
		}
	}, [isRightSidebarOpen, panelMode, presentationMode, setPanelMode]);

	React.useEffect(() => {
		if (
			panelMode !== "chat" ||
			!shouldShowInlinePanel ||
			!shouldFocusInlineChatRef.current
		) {
			return;
		}

		const focusTextarea = () => {
			if (!textareaRef.current) {
				return;
			}

			textareaRef.current.focus({ preventScroll: true });
			const cursorPosition = textareaRef.current.value.length;
			textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
		};

		const immediateTimeoutId = window.setTimeout(focusTextarea, 0);
		const delayedTimeoutId = window.setTimeout(() => {
			focusTextarea();
			shouldFocusInlineChatRef.current = false;
		}, 50);

		return () => {
			window.clearTimeout(immediateTimeoutId);
			window.clearTimeout(delayedTimeoutId);
		};
	}, [panelMode, shouldShowInlinePanel]);

	React.useEffect(() => {
		if (!panelMode || !shouldShowInlinePanel) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			const composedPath = event.composedPath();
			const isInsidePortaledDropdown = composedPath.some((entry) => {
				if (!(entry instanceof HTMLElement)) {
					return false;
				}

				return (
					entry.dataset.slot === "dropdown-menu-content" ||
					entry.dataset.slot === "dropdown-menu-sub-content" ||
					entry.hasAttribute("data-radix-popper-content-wrapper")
				);
			});

			if (rootRef.current?.contains(target)) {
				return;
			}

			if (inlinePanelRef.current?.contains(target)) {
				return;
			}

			if (isInsidePortaledDropdown) {
				return;
			}

			setPanelMode(null);
		};

		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [panelMode, setPanelMode, shouldShowInlinePanel]);

	const openDraftChat = React.useCallback(() => {
		if (isChatLoading) {
			stop();
		}

		const nextChatId = createDraftChatId();
		setCurrentChatId(nextChatId);
		setMessages([]);
		setEditingMessageId(null);

		if (presentationMode === "inline") {
			setPanelMode("chat");
			return;
		}

		openRightSidebar(presentationMode);
	}, [
		isChatLoading,
		openRightSidebar,
		presentationMode,
		setMessages,
		setPanelMode,
		stop,
	]);

	const handleSend = React.useCallback(async () => {
		const nextMessage = message.trim();

		if (
			(!nextMessage && !selectedRecipe && attachedFiles.length === 0) ||
			hasUploadingAttachments(attachedFiles) ||
			isChatLoading
		) {
			return;
		}

		setIsPreparingRequest(true);
		if (presentationMode === "inline") {
			setPanelMode("chat");
		} else {
			openRightSidebar(presentationMode);
		}

		try {
			const currentNoteContext = readNoteContext();
			const convexToken = await getCachedConvexToken();
			const requestBody = {
				model: selectedModel.model,
				convexToken,
				noteContext: {
					noteId: currentNoteContext.noteId,
					title: currentNoteContext.title,
					text: currentNoteContext.text,
				},
				recipeSlug: selectedRecipe?.slug ?? null,
			};
			const recipeMetadata: UIMessage["metadata"] | undefined = selectedRecipe
				? {
						recipe: {
							slug: selectedRecipe.slug,
							name: selectedRecipe.name,
						},
						recipeOnly: nextMessage.length === 0,
					}
				: undefined;
			const outgoingText = nextMessage || selectedRecipe?.name || "";
			const readyFiles = getReadyFileParts(attachedFiles);
			const filePayload = readyFiles.length > 0 ? { files: readyFiles } : {};
			const nextOutgoingMessage = editingMessageId
				? {
						messageId: editingMessageId,
						text: outgoingText,
						metadata: recipeMetadata,
						...filePayload,
					}
				: { text: outgoingText, metadata: recipeMetadata, ...filePayload };

			const request = sendMessage(nextOutgoingMessage, {
				body: requestBody,
			});
			void request.finally(() => {
				setIsPreparingRequest(false);
			});
			setEditingMessageId(null);
			setMessage("");
			setAttachedFiles([]);
			setSelectedRecipeSlug(null);
			setIsExpanded(false);
			resetTextareaHeight();
		} catch (error) {
			console.error("Failed to prepare note chat request", error);
			setIsPreparingRequest(false);
		}
	}, [
		isChatLoading,
		attachedFiles,
		message,
		openRightSidebar,
		presentationMode,
		readNoteContext,
		resetTextareaHeight,
		selectedRecipe,
		editingMessageId,
		selectedModel.model,
		sendMessage,
		setPanelMode,
	]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		await handleSend();
	};

	const handleTextareaChange = (
		event: React.ChangeEvent<HTMLTextAreaElement>,
	) => {
		const nextValue = event.target.value;
		setMessage(nextValue);
		resizeTextarea();
		setIsExpanded(nextValue.length > 100 || nextValue.includes("\n"));
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "@" || (event.shiftKey && event.code === "Digit2")) {
			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}

			const selectionStart = event.currentTarget.selectionStart;
			const selectionEnd = event.currentTarget.selectionEnd;
			const nextValue = `${event.currentTarget.value.slice(0, selectionStart)}@${event.currentTarget.value.slice(selectionEnd)}`;
			const triggerRange = findRecipeTriggerRange(
				nextValue,
				selectionStart + 1,
			);

			if (!triggerRange) {
				return;
			}

			event.preventDefault();
			setRecipePopoverOpen(true);
			return;
		}

		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.nativeEvent.isComposing
		) {
			return;
		}

		event.preventDefault();
		void handleSend();
	};

	const focusComposerInput = React.useCallback(() => {
		window.setTimeout(() => {
			const element = textareaRef.current;
			if (!element) {
				return;
			}

			element.focus({ preventScroll: true });
			const cursorPosition = element.value.length;
			element.setSelectionRange(cursorPosition, cursorPosition);
		}, 0);
	}, []);

	const handleEditMessage = React.useCallback(
		(messageId: string, text: string) => {
			if (isChatLoading) {
				stop();
			}

			setEditingMessageId(messageId);
			setMessage(text);
			setAttachedFiles([]);
			setIsExpanded(text.length > 100 || text.includes("\n"));
			resizeTextarea();
			focusComposerInput();
		},
		[focusComposerInput, isChatLoading, resizeTextarea, stop],
	);

	const handleCancelEdit = React.useCallback(() => {
		setEditingMessageId(null);
		setMessage("");
		setAttachedFiles([]);
		setIsExpanded(false);
		resetTextareaHeight();
		focusComposerInput();
	}, [focusComposerInput, resetTextareaHeight]);

	const buildRequestBody = React.useCallback(async () => {
		const currentNoteContext = readNoteContext();
		const convexToken = await getCachedConvexToken();

		return {
			model: selectedModel.model,
			convexToken,
			noteContext: {
				noteId: currentNoteContext.noteId,
				title: currentNoteContext.title,
				text: currentNoteContext.text,
			},
			recipeSlug: selectedRecipe?.slug ?? null,
		};
	}, [readNoteContext, selectedModel.model, selectedRecipe?.slug]);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			if (isChatLoading) {
				stop();
			}

			setMessages((currentMessages) =>
				getMessagesBefore(currentMessages, messageId),
			);
			setEditingMessageId(null);
			setMessage("");
			setAttachedFiles([]);
			setIsExpanded(false);
			resetTextareaHeight();

			if (!activeWorkspaceId) {
				return;
			}

			void truncateFromMessage({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				messageId,
			}).catch((error) => {
				console.error("Failed to delete note chat message", error);
				toast.error("Failed to delete message");
			});
		},
		[
			activeWorkspaceId,
			currentChatId,
			isChatLoading,
			resetTextareaHeight,
			setMessages,
			stop,
			truncateFromMessage,
		],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (isChatLoading) {
				stop();
			}

			setIsPreparingRequest(true);
			if (presentationMode === "inline") {
				setPanelMode("chat");
			} else {
				openRightSidebar(presentationMode);
			}

			try {
				const requestBody = await buildRequestBody();

				setEditingMessageId(null);
				setMessage("");
				setIsExpanded(false);
				resetTextareaHeight();
				const request = regenerate({
					messageId: assistantMessageId,
					body: requestBody,
				});
				void request.finally(() => {
					setIsPreparingRequest(false);
				});
			} catch (error) {
				console.error("Failed to prepare note chat regeneration", error);
				setIsPreparingRequest(false);
			}
		},
		[
			buildRequestBody,
			isChatLoading,
			openRightSidebar,
			presentationMode,
			regenerate,
			resetTextareaHeight,
			setPanelMode,
			stop,
		],
	);

	const handleSelectChat = (chatId: string) => {
		if (currentChatId === chatId) {
			return;
		}

		if (isChatLoading) {
			stop();
		}

		handlePrefetchNoteChat(chatId);
		setCurrentChatId(chatId);
		setEditingMessageId(null);
		if (presentationMode === "inline") {
			setPanelMode("chat");
			return;
		}

		openRightSidebar(presentationMode);
	};

	const handleSelectInlinePresentation = () => {
		setPresentationMode("inline");
		closeRightSidebar();
		shouldFocusInlineChatRef.current = true;
		setPanelMode("chat");
	};

	const handleSelectRightPresentation = (
		mode: Exclude<NoteChatPresentation, "inline">,
	) => {
		openRightSidebar(mode);
	};

	const handleHideChat = () => {
		closeRightSidebar();
		setPanelMode(null);
	};

	const handleComposerPointerDown = React.useCallback(() => {}, []);

	React.useEffect(() => {
		if (!editingMessageId) {
			return;
		}

		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			handleCancelEdit();
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
		};
	}, [editingMessageId, handleCancelEdit]);

	const handleComposerFocus = React.useCallback(() => {
		if (!latestNoteChat) {
			return;
		}

		if (isChatLoading) {
			stop();
		}

		handlePrefetchNoteChat(latestNoteChat.chatId);
		closeRightSidebar();
		setPresentationMode("inline");
		setCurrentChatId(latestNoteChat.chatId);
		setEditingMessageId(null);
		shouldFocusInlineChatRef.current = true;
		setPanelMode("chat");
	}, [
		closeRightSidebar,
		handlePrefetchNoteChat,
		isChatLoading,
		latestNoteChat,
		setPanelMode,
		setPresentationMode,
		stop,
	]);

	return {
		autoStartKey: transcriptSession.autoStartKey,
		currentNoteScopeKey: transcriptSession.currentNoteScopeKey,
		canGenerateNotes,
		chatError,
		chatMessages,
		chatTitle,
		chatViewportRef,
		isChatViewportAtBottom,
		closeRightSidebar,
		composerPlaceholder,
		currentChatId,
		editingMessageId,
		exportTranscript: transcriptSession.exportTranscript,
		fullTranscript: transcriptSession.fullTranscript,
		groupedNoteChats,
		handleCancelEdit,
		handleComposerFocus,
		handleComposerPointerDown,
		handleDeleteMessage,
		handleEditMessage,
		handleGenerateNotes: transcriptSession.handleGenerateNotes,
		handleHideChat,
		handleKeyDown,
		getFloatingPanelMaxHeight,
		getInlinePanelMaxHeight,
		handleFloatingPanelResizeKeyDown: handleFloatingPanelResizeKeyDownInternal,
		handleFloatingPanelResizeStart,
		handleSelectChat,
		handleSelectInlinePresentation,
		handleSelectRightPresentation,
		handleRegenerateMessage,
		handleSidebarResizeKeyDown,
		handleSidebarResizeStart,
		handleSubmit,
		handleTextareaChange,
		hasMessage,
		canSendMessage,
		attachedFiles,
		setAttachedFiles,
		isTranscriptViewportAtBottom:
			transcriptSession.isTranscriptViewportAtBottom,
		systemAudioStatus: transcriptSession.systemAudioStatus,
		recoveryStatus: transcriptSession.recoveryStatus,
		inlinePanelRef,
		inlinePanelHeight,
		isChatLoading,
		isChatOpen,
		isFloatingPanelResizing,
		isFloatingPresentation,
		isSidebarResizing,
		displayTranscriptEntries: transcriptSession.displayTranscriptEntries,
		isGeneratingNotes: transcriptSession.isGeneratingNotes,
		isMobile,
		isSidebarPresentation,
		hasAdjacentInsetPanel,
		isSpeechListening: isCurrentNoteSpeechListening,
		isStoredTranscriptLoading: transcriptSession.isStoredTranscriptLoading,
		isRecipeLoading: recipeData === undefined,
		isTranscriptOpen,
		liveTranscriptEntries: transcriptSession.liveTranscriptEntries,
		message,
		modelPopoverOpen,
		noteChats,
		handlePrefetchNoteChat,
		orderedTranscriptUtterances: transcriptSession.orderedTranscriptUtterances,
		openDraftChat,
		panelMode,
		presentationMode: resolvedPresentationMode,
		floatingPanelHeight,
		floatingPanelRightOffset,
		transcriptViewportRef: transcriptSession.transcriptViewportRef,
		rootRef,
		recipePopoverOpen,
		recipes,
		scrollChatToBottom,
		scrollTranscriptToBottom: transcriptSession.scrollTranscriptToBottom,
		selectedRecipe,
		sidebarPanelWidth,
		sidebarPanelWidthCss,
		setPanelMode,
		setModelPopoverOpen,
		setSelectedModel: handleSelectedModelChange,
		setRecipePopoverOpen,
		setSelectedRecipeSlug,
		selectedModel,
		stop,
		shouldShowInlinePanel,
		textareaRef,
		toggleTranscriptPanel,
		handleTranscriptionLanguageChange,
		isSavingTranscriptionLanguage,
		canOpenTranscriptSoundSettings: canOpenDesktopSoundSettings(),
		handleOpenTranscriptSoundSettings: async () => {
			if (!canOpenDesktopSoundSettings()) {
				return;
			}

			try {
				await openDesktopSoundSettings();
			} catch (error) {
				console.error("Failed to open sound settings", error);
				toast.error("Failed to open sound settings");
			}
		},
		transcriptionLanguageSelectValue,
		transcriptStartedAt: transcriptSession.transcriptStartedAt,
		transcriptionLanguageReady: isTranscriptionLanguageReady,
		transcriptionLanguage,
		handleInlinePanelResizeKeyDown: handleInlinePanelResizeKeyDownInternal,
		handleInlinePanelResizeStart,
		isInlinePanelResizing,
	};
};

function NoteSpeechControls({
	autoStartKey,
	currentNoteScopeKey,
	isTranscriptOpen,
	onToggleTranscript,
	transcriptionLanguageReady,
	transcriptionLanguage,
}: {
	autoStartKey?: string | number | null;
	currentNoteScopeKey: string;
	isTranscriptOpen: boolean;
	onToggleTranscript: () => void;
	transcriptionLanguageReady: boolean;
	transcriptionLanguage?: string | null;
}) {
	const speechLanguage =
		typeof transcriptionLanguage === "string"
			? transcriptionLanguage
			: undefined;

	return (
		<div className="group/speech-controls flex items-center gap-1">
			<SpeechInput
				variant="ghost"
				size="icon-sm"
				autoStartKey={autoStartKey}
				disabled={!transcriptionLanguageReady}
				lang={speechLanguage}
				scopeKey={currentNoteScopeKey}
				className="shrink-0 rounded-full bg-transparent !text-muted-foreground shadow-none hover:bg-muted hover:!text-foreground"
			/>

			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className={cn(
					"shrink-0 rounded-full bg-transparent text-muted-foreground opacity-0 shadow-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/speech-controls:opacity-100 group-focus-within/speech-controls:opacity-100",
					isTranscriptOpen && "opacity-100",
				)}
				aria-label="Expand speech controls"
				onClick={onToggleTranscript}
			>
				<ChevronUp
					className={cn(
						"size-4 transition-transform duration-200",
						isTranscriptOpen && "rotate-180",
					)}
				/>
			</Button>
		</div>
	);
}

function TranscriptLanguageSelector({
	className,
	controller,
}: {
	className?: string;
	controller: NoteComposerController;
}) {
	return (
		<Select
			value={controller.transcriptionLanguageSelectValue}
			onValueChange={(value) => {
				void controller.handleTranscriptionLanguageChange(value);
			}}
		>
			<SelectTrigger
				size="sm"
				className={cn(
					"h-7 w-fit min-w-0 cursor-pointer gap-1 rounded-full border-transparent !bg-transparent pr-2 text-xs text-muted-foreground shadow-none hover:!bg-muted",
					className,
				)}
				aria-label="Select transcription language"
				disabled={
					!controller.transcriptionLanguageReady ||
					controller.isSavingTranscriptionLanguage
				}
			>
				<SelectValue>
					{getTranscriptionLanguageSelectValue(
						controller.transcriptionLanguage,
					) === controller.transcriptionLanguageSelectValue
						? ([
								...PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
								...OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
							].find(
								(option) =>
									option.value === controller.transcriptionLanguageSelectValue,
							)?.label ?? "Auto-detect")
						: "Auto-detect"}
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="end" className="max-h-80" showScrollButtons={false}>
				<SelectGroup>
					<SelectLabel>Suggested</SelectLabel>
					{PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS.map(({ value, label }) => (
						<SelectItem key={value} value={value} className="cursor-pointer">
							<span>{label}</span>
						</SelectItem>
					))}
				</SelectGroup>
				<SelectGroup>
					<SelectLabel>More languages</SelectLabel>
					{OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS.map(({ value, label }) => (
						<SelectItem key={value} value={value} className="cursor-pointer">
							<span>{label}</span>
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function NoteChatMessages({
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
}: {
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
}) {
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

export function NoteChatHeader({
	chatTitle,
	currentChatId,
	groupedNoteChats,
	handlePrefetchNoteChat,
	noteChats,
	onHideChat,
	onNewChat,
	onSelectChat,
	onSelectInlinePresentation,
	onSelectRightPresentation,
	presentationMode,
	isMobile,
	desktopSafeTop,
	sidebarCompact,
}: {
	chatTitle: string;
	currentChatId: string;
	groupedNoteChats: ReturnType<typeof groupChatsForSelector>;
	handlePrefetchNoteChat: (chatId: string) => void;
	noteChats: NoteChatSummary[] | undefined;
	onHideChat: () => void;
	onNewChat: () => void;
	onSelectChat: (chatId: string) => void;
	onSelectInlinePresentation: () => void;
	onSelectRightPresentation: (
		mode: Exclude<NoteChatPresentation, "inline">,
	) => void;
	presentationMode: NoteChatPresentation;
	isMobile: boolean;
	desktopSafeTop: boolean;
	sidebarCompact: boolean;
}) {
	const chatModeIcon =
		presentationMode === "inline" ? (
			<PanelBottom className="size-4" />
		) : presentationMode === "floating" ? (
			<PanelRightDashed className="size-4" />
		) : (
			<PanelRight className="size-4" />
		);
	const isDesktopSidebarHeader = sidebarCompact && !isMobile;
	const isMobileSidebarHeader = sidebarCompact && isMobile;

	return (
		<CardHeader
			data-app-region={isDesktopSidebarHeader ? "no-drag" : undefined}
			className={cn(
				"flex items-center justify-between gap-3",
				isDesktopSidebarHeader
					? desktopSafeTop
						? "h-10 px-2 py-0"
						: "h-16 px-4 py-0"
					: sidebarCompact
						? "p-2"
						: "px-4 py-4",
			)}
		>
			<div
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2",
					(isDesktopSidebarHeader || isMobileSidebarHeader) &&
						desktopSafeTop && [
							DESKTOP_MAIN_HEADER_CONTENT_CLASS,
							isMobileSidebarHeader && "mt-1",
						],
				)}
			>
				<Select value={currentChatId} onValueChange={onSelectChat}>
					<SelectTrigger
						size="sm"
						title={chatTitle}
						aria-label="Select note chat"
						className={cn(
							"min-w-0 max-w-full cursor-pointer justify-start gap-0.5 border-0 !bg-transparent text-left shadow-none hover:!bg-accent/50 focus-visible:!bg-accent/50 focus-visible:ring-0 data-[state=open]:!bg-accent/50 dark:!bg-transparent dark:hover:!bg-accent/50 dark:data-[state=open]:!bg-accent/50",
							isDesktopSidebarHeader
								? "h-9 px-2.5 pr-1.5 text-sm"
								: "h-8 px-2 pr-1.5 text-sm",
							sidebarCompact
								? "max-w-[min(100%,18rem)]"
								: "max-w-[min(100%,36rem)]",
							sidebarCompact ? "-ml-1" : "-ml-2",
						)}
					>
						<span className="min-w-0 truncate text-sm text-foreground">
							{chatTitle}
						</span>
					</SelectTrigger>
					<SelectContent align="start" className="w-72 max-w-[90vw] p-1">
						{(noteChats?.length ?? 0) === 0 ? (
							<div className="px-2 py-3 text-sm text-muted-foreground">
								Send a message to start a note chat.
							</div>
						) : (
							<>
								{groupedNoteChats.today.length > 0 ? (
									<SelectGroup>
										<SelectLabel>Today</SelectLabel>
										{groupedNoteChats.today.map((chat) => (
											<SelectItem
												key={chat._id}
												value={chat.chatId}
												className="min-w-0"
												onFocus={() => handlePrefetchNoteChat(chat.chatId)}
												onMouseEnter={() => handlePrefetchNoteChat(chat.chatId)}
												onPointerDown={() =>
													handlePrefetchNoteChat(chat.chatId)
												}
											>
												<span className="block min-w-0 truncate">
													{chat.title}
												</span>
											</SelectItem>
										))}
									</SelectGroup>
								) : null}
								{groupedNoteChats.previous.length > 0 ? (
									<SelectGroup>
										<SelectLabel>Previous</SelectLabel>
										{groupedNoteChats.previous.map((chat) => (
											<SelectItem
												key={chat._id}
												value={chat.chatId}
												className="min-w-0"
												onFocus={() => handlePrefetchNoteChat(chat.chatId)}
												onMouseEnter={() => handlePrefetchNoteChat(chat.chatId)}
												onPointerDown={() =>
													handlePrefetchNoteChat(chat.chatId)
												}
											>
												<span className="block min-w-0 truncate">
													{chat.title}
												</span>
											</SelectItem>
										))}
									</SelectGroup>
								) : null}
							</>
						)}
					</SelectContent>
				</Select>
			</div>

			<div
				className={cn(
					"flex items-center gap-1",
					sidebarCompact ? "-mr-1" : "-mr-2",
					(isDesktopSidebarHeader || isMobileSidebarHeader) &&
						desktopSafeTop && [
							DESKTOP_MAIN_HEADER_CONTENT_CLASS,
							isMobileSidebarHeader && "mt-1",
						],
				)}
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onNewChat}
							aria-label="New chat"
						>
							<Plus className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent align="end">New chat</TooltipContent>
				</Tooltip>

				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Switch chat mode"
								>
									{chatModeIcon}
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent align="end">Switch chat mode</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onSelect={onSelectInlinePresentation}
							className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
						>
							<PanelBottom className="size-4 text-muted-foreground" />
							<span>Inline</span>
							{presentationMode === "inline" ? (
								<Check className="size-4 text-muted-foreground" />
							) : null}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => onSelectRightPresentation("floating")}
							className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
						>
							<PanelRightDashed className="size-4 text-muted-foreground" />
							<span>Floating</span>
							{presentationMode === "floating" ? (
								<Check className="size-4 text-muted-foreground" />
							) : null}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => onSelectRightPresentation("sidebar")}
							className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
						>
							<PanelRight className="size-4 text-muted-foreground" />
							<span>Sidebar</span>
							{presentationMode === "sidebar" ? (
								<Check className="size-4 text-muted-foreground" />
							) : null}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				{presentationMode !== "inline" ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={onHideChat}
								aria-label="Hide chat"
							>
								<Minus className="size-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent align="end">Hide chat</TooltipContent>
					</Tooltip>
				) : null}
			</div>
		</CardHeader>
	);
}

function InlinePopoverFooterContainer({
	className,
	children,
	ref,
}: {
	className?: string;
	children: React.ReactNode;
	ref?: React.Ref<HTMLDivElement>;
}) {
	return (
		<div
			ref={ref}
			data-slot="note-composer-inline-footer"
			className={cn(INLINE_POPOVER_FOOTER_CONTAINER_CLASS, className)}
		>
			{children}
		</div>
	);
}

function useInlineFooterHeight() {
	const footerRef = React.useRef<HTMLDivElement>(null);
	const [footerHeight, setFooterHeight] = React.useState(
		INLINE_POPOVER_FOOTER_DEFAULT_HEIGHT,
	);

	React.useLayoutEffect(() => {
		const footerElement = footerRef.current;

		if (!footerElement) {
			return;
		}

		const measureFooterHeight = () => {
			const nextHeight = Math.ceil(
				footerElement.getBoundingClientRect().height,
			);

			if (nextHeight > 0) {
				setFooterHeight(nextHeight);
			}
		};

		measureFooterHeight();

		const resizeObserver = new ResizeObserver(() => {
			measureFooterHeight();
		});

		resizeObserver.observe(footerElement);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	return {
		footerHeight,
		footerRef,
	};
}

function ChatInlinePopoverFooter({
	composerPlaceholder,
	handleComposerFocus,
	handleComposerPointerDown,
	handleKeyDown,
	handleTextareaChange,
	onStop,
	status,
	message,
	attachedFiles,
	onAttachedFilesChange,
	onRecipePopoverOpenChange,
	onRecipeRemove,
	onRecipeSelect,
	onModelPopoverOpenChange,
	onSelectedModelChange,
	recipePopoverOpen,
	recipes,
	selectedRecipe,
	modelPopoverOpen,
	selectedModel,
	speechControls,
	textareaRef,
}: {
	composerPlaceholder: string;
	handleComposerFocus: () => void;
	handleComposerPointerDown: () => void;
	handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	handleTextareaChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
	onStop: () => void;
	status: {
		activateInlineOnFocus: boolean;
		isRecipeLoading: boolean;
		canSendMessage: boolean;
		isChatLoading: boolean;
		isSidebarCompact: boolean;
		showModelPicker: boolean;
	};
	message: string;
	attachedFiles: ChatAttachment[];
	onAttachedFilesChange: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
	onRecipePopoverOpenChange: (open: boolean) => void;
	onRecipeRemove: () => void;
	onRecipeSelect: (recipeSlug: RecipeSlug) => void;
	onModelPopoverOpenChange: (open: boolean) => void;
	onSelectedModelChange: (model: ChatModel) => void;
	recipePopoverOpen: boolean;
	recipes: RecipePrompt[];
	selectedRecipe: RecipePrompt | null;
	modelPopoverOpen: boolean;
	selectedModel: ChatModel;
	speechControls: React.ReactNode;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
	const {
		activateInlineOnFocus,
		isRecipeLoading,
		canSendMessage,
		isChatLoading,
		isSidebarCompact,
		showModelPicker,
	} = status;
	const shouldShowRecipeControls = !activateInlineOnFocus;
	const shouldShowSelectedRecipe = shouldShowRecipeControls && selectedRecipe;
	const handleAttachmentUploadFailed = React.useCallback(
		(id: string) => {
			onAttachedFilesChange((files) => files.filter((file) => file.id !== id));
		},
		[onAttachedFilesChange],
	);
	const handleAttachmentUploaded = React.useCallback(
		(id: string, uploadedFile: FileUIPart) => {
			onAttachedFilesChange((files) =>
				files.map((file) =>
					file.id === id
						? {
								...file,
								localUrl: undefined,
								uploadStatus: "ready",
								url: uploadedFile.url,
							}
						: file,
				),
			);
		},
		[onAttachedFilesChange],
	);
	const handleAttachmentsAdded = React.useCallback(
		(files: ChatAttachment[]) => {
			onAttachedFilesChange((currentFiles) => [...currentFiles, ...files]);
		},
		[onAttachedFilesChange],
	);
	const attachmentDropzone = useFileAttachmentDropzone({
		disabled: isChatLoading || !shouldShowRecipeControls,
		onFileUploadFailed: handleAttachmentUploadFailed,
		onFileUploaded: handleAttachmentUploaded,
		onFilesAdded: handleAttachmentsAdded,
	});
	const recipePickerPlaceholder = (
		<InputGroupButton
			aria-hidden="true"
			tabIndex={-1}
			variant="ghost"
			size="icon-sm"
			className="pointer-events-none invisible rounded-full"
		>
			<AtSign className="size-3.5" />
		</InputGroupButton>
	);
	const recipePicker = (
		<Popover open={recipePopoverOpen} onOpenChange={onRecipePopoverOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<InputGroupButton
							variant="ghost"
							size="icon-sm"
							className="rounded-full bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
							disabled={isRecipeLoading}
						>
							<AtSign className="size-3.5" />
						</InputGroupButton>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>
					{isRecipeLoading ? "Loading recipes" : "Choose a recipe"}
				</TooltipContent>
			</Tooltip>

			<PopoverContent className="w-80 p-0" align="start">
				<Command>
					<CommandInput placeholder="Search recipes..." />
					<CommandList>
						<CommandEmpty>
							{isRecipeLoading ? "Loading recipes..." : "No recipes found."}
						</CommandEmpty>
						{recipes.length > 0 ? (
							<CommandGroup heading="Recipes">
								{recipes.map((recipe) => {
									const Icon = getRecipeIcon(recipe.slug);

									return (
										<CommandItem
											key={recipe.slug}
											value={`${recipe.slug} ${recipe.name}`}
											className="cursor-pointer"
											onSelect={() => onRecipeSelect(recipe.slug)}
										>
											<Icon />
											<span className="cursor-pointer truncate">
												{recipe.name}
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);

	return (
		<InputGroup
			data-drag-over={attachmentDropzone.isDragOver ? "true" : undefined}
			className={NOTE_COMPOSER_FOOTER_SURFACE_CLASS}
			{...attachmentDropzone.dropzoneProps}
		>
			<InputGroupAddon
				align="block-start"
				className={cn(
					NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS,
					isSidebarCompact && "px-3.5",
				)}
			>
				{shouldShowRecipeControls ? recipePicker : recipePickerPlaceholder}
				{shouldShowSelectedRecipe ? (
					<InputGroupButton
						size="sm"
						variant="secondary"
						className="group/recipe-chip rounded-full pl-2!"
						onClick={onRecipeRemove}
					>
						{(() => {
							const Icon = getRecipeIcon(selectedRecipe.slug);
							return <Icon />;
						})()}
						{selectedRecipe.name}
						<X className="opacity-0 transition-opacity group-hover/recipe-chip:opacity-100 group-focus-visible/recipe-chip:opacity-100" />
					</InputGroupButton>
				) : null}
				{shouldShowRecipeControls ? (
					<FileAttachmentChips
						files={attachedFiles}
						onRemove={(index) =>
							onAttachedFilesChange(
								attachedFiles.filter((_, fileIndex) => fileIndex !== index),
							)
						}
					/>
				) : null}
			</InputGroupAddon>
			<InputGroupTextarea
				data-slot="input-group-control"
				ref={textareaRef}
				value={message}
				onChange={handleTextareaChange}
				onPointerDown={
					activateInlineOnFocus ? handleComposerPointerDown : undefined
				}
				onFocus={activateInlineOnFocus ? handleComposerFocus : undefined}
				onKeyDown={handleKeyDown}
				placeholder={composerPlaceholder}
				className={cn(
					NOTE_COMPOSER_FOOTER_BODY_CLASS,
					isSidebarCompact ? "px-3.5" : "px-4",
				)}
				rows={1}
			/>
			<InputGroupAddon
				align="block-end"
				className={cn(
					NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS,
					isSidebarCompact ? "pl-3.5 pr-2.5" : "px-4",
				)}
			>
				{shouldShowRecipeControls ? (
					<FileAttachmentButton
						disabled={isChatLoading}
						onFileUploadFailed={handleAttachmentUploadFailed}
						onFileUploaded={handleAttachmentUploaded}
						onFilesAdded={handleAttachmentsAdded}
					/>
				) : null}
				{speechControls}
				{showModelPicker ? (
					<div className="ml-auto flex min-w-0 items-center gap-1">
						<ChatModelPicker
							open={modelPopoverOpen}
							onOpenChange={onModelPopoverOpenChange}
							selectedModel={selectedModel}
							onSelectedModelChange={onSelectedModelChange}
							triggerClassName="text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
							triggerIconClassName="text-current"
							modelNameClassName="max-w-[120px] truncate"
						/>
					</div>
				) : null}
				<InputGroupButton
					type={isChatLoading ? "button" : "submit"}
					variant="default"
					size="icon-sm"
					className={cn("rounded-full", !showModelPicker && "ml-auto")}
					aria-label={isChatLoading ? "Stop streaming" : "Send message"}
					disabled={
						!isChatLoading &&
						(!canSendMessage || hasUploadingAttachments(attachedFiles))
					}
					onClick={isChatLoading ? onStop : undefined}
				>
					{isChatLoading ? (
						<Square className="size-3.5 fill-current" />
					) : (
						<ArrowUp className="size-4" />
					)}
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}

function TranscriptInlinePopoverFooter({
	containerRef,
	controller,
	isSpeechListening,
	speechControls,
	topAccessory,
}: {
	containerRef?: React.Ref<HTMLDivElement>;
	controller: NoteComposerController;
	isSpeechListening: boolean;
	speechControls: React.ReactNode;
	topAccessory?: React.ReactNode;
}) {
	return (
		<InlinePopoverFooterContainer
			ref={containerRef}
			className={NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS}
		>
			<div className="relative">
				{isSpeechListening || topAccessory ? (
					<div className="pointer-events-none absolute inset-x-4 bottom-full z-10 mb-3 flex flex-col items-center gap-2">
						{isSpeechListening ? (
							<div className="w-full rounded-lg bg-muted px-4 py-1 text-center text-[11px] leading-4 text-muted-foreground">
								Always get consent when transcribing others.
							</div>
						) : null}
						{topAccessory ? (
							<div className="pointer-events-auto">{topAccessory}</div>
						) : null}
					</div>
				) : null}

				<InputGroup className={NOTE_COMPOSER_FOOTER_SURFACE_CLASS}>
					<InputGroupAddon
						align="block-start"
						className={NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS}
					>
						<InputGroupButton
							aria-hidden="true"
							tabIndex={-1}
							variant="ghost"
							size="sm"
							className="pointer-events-none rounded-full border-0 bg-transparent px-2.5 text-xs text-transparent opacity-0 shadow-none"
						>
							<AtSign className="size-3.5" />
						</InputGroupButton>
					</InputGroupAddon>
					<div
						aria-hidden="true"
						className={NOTE_COMPOSER_FOOTER_BODY_SPACER_CLASS}
					/>
					<InputGroupAddon
						align="block-end"
						className={NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS}
					>
						{speechControls}
						<TranscriptLanguageSelector
							className="ml-auto"
							controller={controller}
						/>
					</InputGroupAddon>
				</InputGroup>
			</div>
		</InlinePopoverFooterContainer>
	);
}

export const NoteComposer = React.memo(function NoteComposer(
	props: NoteComposerProps,
) {
	const controller = useNoteComposerController(props);
	return (
		<div ref={controller.rootRef} className="relative w-full">
			{controller.canGenerateNotes ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-3 flex justify-center">
					<Button
						type="button"
						size="sm"
						className="pointer-events-auto px-4 shadow-lg"
						onClick={controller.handleGenerateNotes}
						disabled={controller.isGeneratingNotes}
					>
						{controller.isGeneratingNotes ? (
							<LoaderCircle className="size-4 animate-spin" />
						) : (
							<WandSparkles className="size-4" />
						)}
						{controller.isGeneratingNotes ? "Generating..." : "Generate notes"}
					</Button>
				</div>
			) : null}
			<NoteComposerPanels
				controller={controller}
				onAddMessageToNote={props.onAddMessageToNote}
				desktopSafeTop={props.desktopSafeTop ?? false}
			/>
			<NoteComposerDock controller={controller} />
		</div>
	);
});

type NoteComposerController = ReturnType<typeof useNoteComposerController>;

function NoteComposerSpeechControls({
	controller,
}: {
	controller: NoteComposerController;
}) {
	return (
		<NoteSpeechControls
			autoStartKey={controller.autoStartKey}
			currentNoteScopeKey={controller.currentNoteScopeKey}
			isTranscriptOpen={controller.isTranscriptOpen}
			onToggleTranscript={controller.toggleTranscriptPanel}
			transcriptionLanguageReady={controller.transcriptionLanguageReady}
			transcriptionLanguage={controller.transcriptionLanguage}
		/>
	);
}

function ChatComposerForm({
	activateInlineOnFocus = false,
	controller,
	formClassName,
	speechControls,
	topAccessory,
}: {
	activateInlineOnFocus?: boolean;
	controller: NoteComposerController;
	formClassName?: string;
	speechControls: React.ReactNode;
	topAccessory?: React.ReactNode;
}) {
	return (
		<form
			onSubmit={controller.handleSubmit}
			className={cn("relative", formClassName)}
		>
			{controller.editingMessageId ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
					<Button
						type="button"
						variant="ghost"
						className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/80 px-4 py-1.5 text-sm text-secondary-foreground shadow-sm hover:bg-secondary"
						aria-label="Cancel edit"
						onClick={controller.handleCancelEdit}
					>
						<span>Cancel edit</span>
						<Kbd className="rounded-full border border-border/60 bg-muted px-2">
							Esc
						</Kbd>
					</Button>
				</div>
			) : topAccessory ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
					<div className="pointer-events-auto">{topAccessory}</div>
				</div>
			) : null}
			<ChatInlinePopoverFooter
				composerPlaceholder={controller.composerPlaceholder}
				handleComposerFocus={controller.handleComposerFocus}
				handleComposerPointerDown={controller.handleComposerPointerDown}
				handleKeyDown={controller.handleKeyDown}
				handleTextareaChange={controller.handleTextareaChange}
				onStop={controller.stop}
				status={{
					activateInlineOnFocus,
					isRecipeLoading: controller.isRecipeLoading,
					canSendMessage: controller.canSendMessage,
					isChatLoading: controller.isChatLoading,
					isSidebarCompact: controller.isSidebarPresentation,
					showModelPicker: controller.isChatOpen && !activateInlineOnFocus,
				}}
				message={controller.message}
				attachedFiles={controller.attachedFiles}
				onAttachedFilesChange={controller.setAttachedFiles}
				onRecipePopoverOpenChange={controller.setRecipePopoverOpen}
				onRecipeRemove={() => controller.setSelectedRecipeSlug(null)}
				onRecipeSelect={(recipeSlug) => {
					controller.setSelectedRecipeSlug(recipeSlug);
					controller.setRecipePopoverOpen(false);
				}}
				onModelPopoverOpenChange={controller.setModelPopoverOpen}
				onSelectedModelChange={controller.setSelectedModel}
				recipePopoverOpen={controller.recipePopoverOpen}
				recipes={controller.recipes}
				selectedRecipe={controller.selectedRecipe}
				modelPopoverOpen={controller.modelPopoverOpen}
				selectedModel={controller.selectedModel}
				speechControls={speechControls}
				textareaRef={controller.textareaRef}
			/>
		</form>
	);
}

function TranscriptPanelHeader({
	controller,
}: {
	controller: NoteComposerController;
}) {
	const [isTranscriptCopied, setIsTranscriptCopied] = React.useState(false);
	const transcriptCopiedTimeoutRef = React.useRef<ReturnType<
		typeof globalThis.setTimeout
	> | null>(null);

	React.useEffect(() => {
		return () => {
			if (transcriptCopiedTimeoutRef.current !== null) {
				globalThis.clearTimeout(transcriptCopiedTimeoutRef.current);
			}
		};
	}, []);

	return (
		<CardHeader
			className={cn(
				"flex items-center justify-between",
				controller.isSidebarPresentation ? "p-2" : "px-4 py-4",
			)}
		>
			<div className="text-sm font-medium text-foreground">Live transcript</div>
			<div className="flex items-center gap-1">
				{controller.canOpenTranscriptSoundSettings ? (
					<Tooltip>
						<DropdownMenu>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className={cn(
											controller.isSidebarPresentation ? "-mr-1" : "-mr-1.5",
										)}
										aria-label="Transcript settings"
									>
										<SlidersHorizontal className="size-4" />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuItem
									onClick={() => {
										void controller.handleOpenTranscriptSoundSettings();
									}}
								>
									<AudioWaveform className="size-4" />
									Sound settings
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<TooltipContent align="end">Transcript settings</TooltipContent>
					</Tooltip>
				) : null}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn(
								controller.isSidebarPresentation ? "-mr-1" : "-mr-1.5",
							)}
							aria-label="Copy transcript"
							onClick={async () => {
								if (!controller.exportTranscript) {
									return;
								}

								try {
									await navigator.clipboard.writeText(
										controller.exportTranscript,
									);
									if (transcriptCopiedTimeoutRef.current !== null) {
										globalThis.clearTimeout(transcriptCopiedTimeoutRef.current);
									}
									setIsTranscriptCopied(true);
									transcriptCopiedTimeoutRef.current = globalThis.setTimeout(
										() => {
											setIsTranscriptCopied(false);
											transcriptCopiedTimeoutRef.current = null;
										},
										2000,
									);
									toast.success("Transcript copied");
								} catch (error) {
									console.error("Failed to copy transcript", error);
									toast.error("Failed to copy transcript");
								}
							}}
						>
							{isTranscriptCopied ? (
								<Check className="size-4" />
							) : (
								<Copy className="size-4" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent align="end">
						{isTranscriptCopied ? "Copied" : "Copy transcript"}
					</TooltipContent>
				</Tooltip>
			</div>
		</CardHeader>
	);
}

function TranscriptPanelNoticeStack({
	controller,
	shouldRenderInlineComposer,
}: {
	controller: NoteComposerController;
	shouldRenderInlineComposer: boolean;
}) {
	if (shouldRenderInlineComposer || !controller.isSpeechListening) {
		return null;
	}

	return (
		<div
			className={cn(
				controller.isSidebarPresentation
					? "px-2 pb-2"
					: shouldRenderInlineComposer
						? "pb-4"
						: "px-4 pb-4",
			)}
		>
			<div className="rounded-md bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground">
				Always get consent when transcribing others.
			</div>
		</div>
	);
}

function NoteComposerChatPanelContent({
	controller,
	chatPanelBody,
	chatPanelHeader,
}: {
	controller: NoteComposerController;
	chatPanelBody: React.ReactNode;
	chatPanelHeader: React.ReactNode;
}) {
	const shouldRenderInlineComposer = controller.shouldShowInlinePanel;
	const isFloatingComposer =
		controller.presentationMode === "floating" && !shouldRenderInlineComposer;
	const isOverlayComposer = shouldRenderInlineComposer || isFloatingComposer;
	const floatingFooterContainerClassName =
		NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS;
	const inlineFooterContainerClassName =
		NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS;
	const { footerHeight: overlayFooterHeight, footerRef: overlayFooterRef } =
		useInlineFooterHeight();
	const chatFooter = (
		<ChatComposerForm
			controller={controller}
			formClassName={
				controller.isSidebarPresentation
					? controller.isMobile
						? "w-full max-w-full min-w-0"
						: "-mx-[2px] w-[calc(100%+4px)]"
					: undefined
			}
			speechControls={null}
			topAccessory={
				controller.chatMessages.length > 0 &&
				!controller.isChatViewportAtBottom ? (
					<Button
						type="button"
						variant="secondary"
						size="icon"
						className="size-9 rounded-full border border-border/60 shadow-md"
						onClick={() => controller.scrollChatToBottom()}
						aria-label="Scroll to latest messages"
					>
						<ArrowDown className="size-4" />
					</Button>
				) : undefined
			}
		/>
	);

	return (
		<>
			{chatPanelHeader}

			<CardContent
				className={cn(
					"flex flex-1 overflow-hidden",
					controller.isSidebarPresentation
						? "px-2 pt-2 pb-2"
						: isOverlayComposer
							? "px-4"
							: "px-4 pb-4",
				)}
				style={
					!controller.isSidebarPresentation && isOverlayComposer
						? { paddingBottom: overlayFooterHeight }
						: undefined
				}
			>
				{chatPanelBody}
			</CardContent>

			{isOverlayComposer ? (
				<InlinePopoverFooterContainer
					ref={overlayFooterRef}
					className={
						isFloatingComposer
							? floatingFooterContainerClassName
							: inlineFooterContainerClassName
					}
				>
					{chatFooter}
				</InlinePopoverFooterContainer>
			) : (
				<div
					className={cn(
						controller.isSidebarPresentation ? "px-2 pb-[6px]" : "px-4 pb-4",
					)}
				>
					{chatFooter}
				</div>
			)}
		</>
	);
}

function NoteComposerTranscriptPanelContent({
	controller,
}: {
	controller: NoteComposerController;
}) {
	const shouldRenderInlineComposer = controller.shouldShowInlinePanel;
	const { footerHeight: overlayFooterHeight, footerRef: overlayFooterRef } =
		useInlineFooterHeight();

	return (
		<>
			<TranscriptPanelHeader controller={controller} />

			<CardContent
				className={cn(
					"flex flex-1 overflow-hidden",
					controller.isSidebarPresentation
						? "px-2 pt-2 pb-2"
						: shouldRenderInlineComposer
							? "px-4"
							: "px-4 pb-4",
				)}
				style={
					!controller.isSidebarPresentation && shouldRenderInlineComposer
						? { paddingBottom: overlayFooterHeight }
						: undefined
				}
			>
				<NoteTranscriptPanel
					controller={controller}
					showFloatingScrollButton={!shouldRenderInlineComposer}
				/>
			</CardContent>

			<TranscriptPanelNoticeStack
				controller={controller}
				shouldRenderInlineComposer={shouldRenderInlineComposer}
			/>

			{shouldRenderInlineComposer ? (
				<TranscriptInlinePopoverFooter
					containerRef={overlayFooterRef}
					controller={controller}
					isSpeechListening={controller.isSpeechListening}
					speechControls={
						<NoteComposerSpeechControls controller={controller} />
					}
					topAccessory={
						!controller.isTranscriptViewportAtBottom &&
						controller.displayTranscriptEntries.length > 0 ? (
							<Button
								type="button"
								variant="secondary"
								size="icon"
								className="size-9 rounded-full border border-border/60 shadow-md"
								onClick={() => controller.scrollTranscriptToBottom()}
								aria-label="Scroll to latest transcript"
							>
								<ArrowDown className="size-4" />
							</Button>
						) : undefined
					}
				/>
			) : null}

			{!shouldRenderInlineComposer ? (
				<div
					className={cn(
						"flex items-center justify-end",
						controller.isSidebarPresentation ? "px-2 pb-2" : "px-4 pb-4",
					)}
				>
					<TranscriptLanguageSelector controller={controller} />
				</div>
			) : null}
		</>
	);
}

function NoteComposerPanels({
	controller,
	onAddMessageToNote,
	desktopSafeTop,
}: {
	controller: NoteComposerController;
	onAddMessageToNote?: NoteComposerProps["onAddMessageToNote"];
	desktopSafeTop: boolean;
}) {
	const chatPanelHeader = (
		<NoteChatHeader
			chatTitle={controller.chatTitle}
			currentChatId={controller.currentChatId}
			groupedNoteChats={controller.groupedNoteChats}
			handlePrefetchNoteChat={controller.handlePrefetchNoteChat}
			noteChats={controller.noteChats}
			onHideChat={controller.handleHideChat}
			onNewChat={controller.openDraftChat}
			onSelectChat={controller.handleSelectChat}
			onSelectInlinePresentation={controller.handleSelectInlinePresentation}
			onSelectRightPresentation={controller.handleSelectRightPresentation}
			presentationMode={controller.presentationMode}
			isMobile={controller.isMobile}
			desktopSafeTop={desktopSafeTop}
			sidebarCompact={controller.isSidebarPresentation}
		/>
	);
	const chatPanelBody = (
		<NoteChatMessages
			chatError={controller.chatError}
			chatMessages={controller.chatMessages}
			chatViewportRef={controller.chatViewportRef}
			disableAddToNote={!onAddMessageToNote}
			disablePadding={controller.isSidebarPresentation}
			isChatLoading={controller.isChatLoading}
			onAddMessageToNote={onAddMessageToNote}
			onDeleteMessage={controller.handleDeleteMessage}
			onEditMessage={controller.handleEditMessage}
			onRegenerateMessage={controller.handleRegenerateMessage}
		/>
	);
	const panelContent = (
		<NoteComposerPanelContent
			controller={controller}
			chatPanelBody={chatPanelBody}
			chatPanelHeader={chatPanelHeader}
		/>
	);

	if (!controller.panelMode) {
		return null;
	}

	if (controller.shouldShowInlinePanel) {
		return (
			<div
				ref={controller.inlinePanelRef}
				className="absolute inset-x-0 z-20"
				style={{ bottom: -NOTE_CHAT_INLINE_PANEL_DOCK_OFFSET }}
			>
				<div className="relative flex items-end gap-3">
					<Card
						className="group/note-chat-panel pointer-events-auto relative -mx-[6px] max-h-[calc(100dvh-6rem)] min-h-[20rem] w-[calc(100%+12px)] gap-0 overflow-hidden bg-sidebar py-0 text-sidebar-foreground ring-sidebar-border"
						style={{
							height: controller.inlinePanelHeight,
							maxHeight: controller.getInlinePanelMaxHeight(),
							minHeight: NOTE_CHAT_PANEL_MIN_HEIGHT,
						}}
					>
						<ResizableTopPanelHandle
							label="Resize note panel"
							title={`Note panel height: ${Math.round(controller.inlinePanelHeight)}px`}
							isResizing={controller.isInlinePanelResizing}
							className="opacity-0 transition-opacity duration-150 group-hover/note-chat-panel:opacity-100 group-focus-within/note-chat-panel:opacity-100"
							onPointerDown={controller.handleInlinePanelResizeStart}
							onKeyDown={controller.handleInlinePanelResizeKeyDown}
						/>
						{panelContent}
					</Card>
				</div>
			</div>
		);
	}

	if (!controller.isChatOpen || controller.presentationMode === "inline") {
		return null;
	}

	return (
		<Sidebar
			side="right"
			variant={
				controller.presentationMode === "floating" ? "floating" : "sidebar"
			}
			collapsible="offcanvas"
			style={
				controller.isFloatingPresentation && !controller.isMobile
					? ({
							"--sidebar-width": `calc(${NOTE_CHAT_FLOATING_WIDTH} - 20px)`,
							bottom: NOTE_CHAT_PANEL_DOCK_OFFSET,
							height: controller.floatingPanelHeight,
							maxHeight: controller.getFloatingPanelMaxHeight(),
							minHeight: NOTE_CHAT_PANEL_MIN_HEIGHT,
							right: controller.floatingPanelRightOffset,
						} as React.CSSProperties)
					: undefined
			}
			className={cn(
				"group/note-chat-panel flex flex-col",
				controller.presentationMode === "floating" ? "md:top-auto" : "border-l",
			)}
		>
			<div
				className={cn(
					"flex h-full flex-col",
					(controller.presentationMode === "floating" ||
						controller.isSidebarPresentation) &&
						"relative",
				)}
			>
				{controller.isFloatingPresentation && !controller.isMobile ? (
					<ResizableTopPanelHandle
						label="Resize floating note chat"
						title={`Floating note chat height: ${Math.round(controller.floatingPanelHeight)}px`}
						isResizing={controller.isFloatingPanelResizing}
						className="opacity-0 transition-opacity duration-150 group-hover/note-chat-panel:opacity-100 group-focus-within/note-chat-panel:opacity-100"
						onPointerDown={controller.handleFloatingPanelResizeStart}
						onKeyDown={controller.handleFloatingPanelResizeKeyDown}
					/>
				) : null}
				{controller.isSidebarPresentation ? (
					<ResizableSidePanelHandle
						side="right"
						label="Resize note chat sidebar"
						panelWidth={controller.sidebarPanelWidth}
						isResizing={controller.isSidebarResizing}
						className={cn(
							"opacity-0 transition-opacity duration-150 group-hover/note-chat-panel:opacity-100 group-focus-within/note-chat-panel:opacity-100",
							controller.hasAdjacentInsetPanel && "opacity-100",
						)}
						onPointerDown={controller.handleSidebarResizeStart}
						onKeyDown={controller.handleSidebarResizeKeyDown}
					/>
				) : null}
				{panelContent}
			</div>
		</Sidebar>
	);
}

function NoteComposerPanelContent({
	controller,
	chatPanelBody,
	chatPanelHeader,
}: {
	controller: NoteComposerController;
	chatPanelBody: React.ReactNode;
	chatPanelHeader: React.ReactNode;
}) {
	return controller.isTranscriptOpen ? (
		<NoteComposerTranscriptPanelContent controller={controller} />
	) : (
		<NoteComposerChatPanelContent
			controller={controller}
			chatPanelBody={chatPanelBody}
			chatPanelHeader={chatPanelHeader}
		/>
	);
}

function NoteTranscriptPanel({
	controller,
	showFloatingScrollButton = true,
}: {
	controller: NoteComposerController;
	showFloatingScrollButton?: boolean;
}) {
	const deferredDisplayTranscriptEntries = React.useDeferredValue(
		controller.displayTranscriptEntries,
	);
	const isDeferringTranscriptEntries =
		deferredDisplayTranscriptEntries !== controller.displayTranscriptEntries;
	const transcriptEntryCount = deferredDisplayTranscriptEntries.length;
	const [
		fullyRenderedTranscriptEntryCount,
		setFullyRenderedTranscriptEntryCount,
	] = React.useReducer(
		(current: number, next: number | ((current: number) => number)) =>
			typeof next === "function" ? next(current) : next,
		transcriptEntryCount > TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD
			? Math.min(transcriptEntryCount, TRANSCRIPT_INITIAL_WINDOW_SIZE)
			: transcriptEntryCount,
	);

	React.useEffect(() => {
		if (transcriptEntryCount <= TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD) {
			setFullyRenderedTranscriptEntryCount(transcriptEntryCount);
			return;
		}

		const promoteFullTranscriptEntries = () => {
			React.startTransition(() => {
				setFullyRenderedTranscriptEntryCount(transcriptEntryCount);
			});
		};

		if ("requestIdleCallback" in globalThis) {
			const idleCallbackId = globalThis.requestIdleCallback(
				promoteFullTranscriptEntries,
				{
					timeout: 250,
				},
			);

			return () => {
				globalThis.cancelIdleCallback(idleCallbackId);
			};
		}

		const timeoutId = globalThis.setTimeout(promoteFullTranscriptEntries, 32);
		return () => {
			globalThis.clearTimeout(timeoutId);
		};
	}, [transcriptEntryCount]);
	const renderFullTranscriptEntries =
		transcriptEntryCount <= TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD ||
		fullyRenderedTranscriptEntryCount === transcriptEntryCount;
	const renderedTranscriptEntries = renderFullTranscriptEntries
		? deferredDisplayTranscriptEntries
		: deferredDisplayTranscriptEntries.slice(
				-fullyRenderedTranscriptEntryCount,
			);
	const isProgressivelyRenderingTranscript =
		!renderFullTranscriptEntries &&
		deferredDisplayTranscriptEntries.length > renderedTranscriptEntries.length;

	if (
		controller.isStoredTranscriptLoading &&
		!controller.fullTranscript &&
		!controller.isSpeechListening
	) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-center text-sm font-medium tracking-tight text-muted-foreground">
					Loading transcript…
				</p>
			</div>
		);
	}

	if (!controller.fullTranscript) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-center text-sm font-medium tracking-tight">
					{controller.isSpeechListening ? "Listening…" : "Transcript paused"}
				</p>
			</div>
		);
	}

	return (
		<div className="relative flex min-h-0 w-full flex-1 flex-col">
			<ScrollArea
				className="min-h-0 w-full flex-1"
				viewportClassName="flex flex-col gap-4 pr-4"
				viewportRef={controller.transcriptViewportRef}
			>
				<div className={cn("flex flex-col gap-4")}>
					{isDeferringTranscriptEntries &&
					deferredDisplayTranscriptEntries.length === 0 ? (
						<div className="flex flex-1 items-center justify-center py-12">
							<p className="text-center text-sm font-medium tracking-tight text-muted-foreground">
								Loading transcript…
							</p>
						</div>
					) : null}
					{isProgressivelyRenderingTranscript ? (
						<div className="flex justify-center">
							<p className="text-[11px] font-medium tracking-tight text-muted-foreground">
								Loading earlier transcript…
							</p>
						</div>
					) : null}
					{renderedTranscriptEntries.map((utterance) => (
						<div key={utterance.id} className="flex flex-col gap-2">
							{controller.transcriptStartedAt != null ? (
								<div className="flex justify-center">
									<p className="text-[11px] font-medium tabular-nums text-muted-foreground">
										{formatTranscriptElapsed(
											utterance.startedAt - controller.transcriptStartedAt,
										)}
									</p>
								</div>
							) : null}
							<div
								className={cn(
									"flex w-full transition-colors",
									utterance.speaker === "you" ? "justify-end" : "justify-start",
								)}
							>
								<div
									className={cn(
										"max-w-[85%] text-sm leading-6",
										utterance.speaker === "you"
											? utterance.isLive
												? "rounded-lg bg-secondary/70 px-4 py-3 text-left text-muted-foreground"
												: "rounded-lg bg-secondary px-4 py-3 text-left text-secondary-foreground"
											: utterance.isLive
												? "text-muted-foreground"
												: "text-foreground",
									)}
									style={{
										containIntrinsicSize: "120px",
										contentVisibility: "auto",
									}}
								>
									<p className="whitespace-pre-wrap">{utterance.text}</p>
								</div>
							</div>
						</div>
					))}
				</div>
			</ScrollArea>
			{showFloatingScrollButton &&
			!controller.isTranscriptViewportAtBottom &&
			renderedTranscriptEntries.length > 0 ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
					<Button
						type="button"
						variant="secondary"
						size="icon"
						className="pointer-events-auto size-9 rounded-full border border-border/60 shadow-md"
						onClick={() => controller.scrollTranscriptToBottom()}
					>
						<ArrowDown className="size-4" />
					</Button>
				</div>
			) : null}
		</div>
	);
}

function NoteComposerDock({
	controller,
}: {
	controller: NoteComposerController;
}) {
	if (controller.panelMode) {
		return null;
	}

	return (
		<div className="flex items-center gap-3 pt-2">
			<ChatComposerForm
				activateInlineOnFocus
				controller={controller}
				formClassName="group/composer mx-auto w-[calc(100%-2rem)] max-w-full min-w-0 md:w-full"
				speechControls={<NoteComposerSpeechControls controller={controller} />}
			/>
		</div>
	);
}
