import { useChat } from "@ai-sdk/react";
import type { Editor, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Tiptap, useEditor } from "@tiptap/react";
import {
	canOpenDesktopSoundSettings,
	openDesktopSoundSettings,
} from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
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
} from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
	useMessageScrollerScrollable,
} from "@workspace/ui/components/message-scroller";
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
import type { ChatAddToolOutputFunction, FileUIPart, UIMessage } from "ai";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
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
	Plus,
	SlidersHorizontal,
	Square,
	WandSparkles,
} from "lucide-react";
import * as React from "react";
// react-doctor-disable-next-line react-doctor/no-flush-sync
import { createPortal, flushSync } from "react-dom";
import { toast } from "sonner";
import {
	type ChatAttachment,
	FileAttachmentButton,
	FileAttachmentChips,
	useFileAttachmentDropzone,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/file-attachment-controls";
import { hasUploadingAttachments } from "@/components/ai-elements/file-attachment-utils";
import { ChatAutomationConfirmationBar } from "@/components/chat/chat-automation-confirmation-bar";
import { ChatQueuedFollowUpBar } from "@/components/chat/chat-queued-follow-up-bar";
import {
	ASSISTANT_CHAT_CONTENT_CLASS,
	CHAT_MESSAGE_MAX_WIDTH_CLASS,
	USER_CHAT_BUBBLE_CLASS,
} from "@/components/chat/message-layout";
import {
	type ChatModel,
	ChatModelPicker,
	type ReasoningEffort,
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
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { useNoteTranscriptSession } from "@/hooks/use-note-transcript-session";
import { useQueuedChatDrain } from "@/hooks/use-queued-chat-drain";
import { useQueuedFollowUpControls } from "@/hooks/use-queued-follow-up-controls";
import { useResumeActiveChatRun } from "@/hooks/use-resume-active-chat-run";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";
import { useWorkspaceChatTransport } from "@/hooks/use-workspace-chat-transport";
import {
	getStoredChatModel as getStoredLocalChatModel,
	storeChatModel,
} from "@/lib/ai/chat-model";
import { findChatModel, findReasoningEffort } from "@/lib/ai/models";
import {
	getStoredChatReasoningEffort,
	getStoredReasoningEffort,
	getStoredReasoningEffortOverride,
	resolveReasoningEffortPreference,
	storeChatReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import { waitForBrowserPaint } from "@/lib/browser-paint";
import { stopActiveChatStream } from "@/lib/chat-active-stream";
import { getPendingAutomationDeleteConfirmation } from "@/lib/chat-automation-confirmation";
import { submitAutomationConfirmationChatTurn } from "@/lib/chat-automation-confirmation-submit";
import {
	appendLocalOptimisticChatMessages,
	hasRenderableChatMessageText,
	mergePersistedChatMessagesWithController,
	normalizeChatMessages,
} from "@/lib/chat-message-state";
import { toQueuedUserMessageInput } from "@/lib/chat-queue";
import {
	buildNoteChatRequestBody,
	buildNoteChatRequestBodyFromLocalFolders,
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
import { getNoteComposerDraftScope } from "@/lib/composer-draft";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";
import {
	loadStoredSharedLocalFolders,
	rehydrateSharedLocalFolders,
} from "@/lib/local-folder-sharing";
import { logError } from "@/lib/logger";
import { resolveCanGenerateNotes } from "@/lib/note-generate-action";
import { ENHANCED_NOTE_TEMPLATE_SLUG } from "@/lib/note-templates";
import { createPlainTextEditorExtensions } from "@/lib/plain-text-editor";
import {
	getRecipeIcon,
	type RecipePrompt,
	type RecipeSlug,
} from "@/lib/recipes";
import {
	getMentionAnchorRect,
	getMentionPickerPosition,
	INLINE_MENTION_CLASS,
	type MentionPickerPosition,
	renderInlineMentionHTML,
	TypedMention,
} from "@/lib/tiptap-mention";
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
import { NoteChatMessagesEntry } from "./note-chat-messages-entry";
import {
	clampPanelHeight,
	getCurrentPanelMaxHeight,
	getCurrentPanelViewportPlatform,
	getNoteScopedStorageKey,
	getNoteScopedStorageKeyForViewport,
	getNoteStorageScopeKey,
	INLINE_POPOVER_DEFAULT_HEIGHT,
	INLINE_POPOVER_HEIGHT_LEGACY_STORAGE_KEY,
	INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
	NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
	NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
	NOTE_CHAT_PANEL_MIN_HEIGHT,
	NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX,
	readStoredPanelHeight,
	storePanelHeight,
} from "./note-composer-panel-storage";
import {
	getComposerContentFromMessage,
	getMessageTextWithoutRecipeMention,
	getRecipeSlugFromComposerContent,
} from "./note-composer-recipe-mentions";
import { NOTE_POPOVER_SCROLLER_BUTTON_CLASS } from "./note-popover-scroll";

type NoteChatPresentation = "inline" | "floating" | "sidebar";
type ScopedLocalOptimisticMessages = {
	chatId: string;
	messages: UIMessage[];
};
const EMPTY_STEER_HANDOFF_STREAMING_MESSAGE_IDS = new Set<string>();
const noteRecipePickerListboxProps = {
	role: "listbox" as const,
	"aria-label": "Recipe suggestions",
};
const NOTE_CHAT_FLOATING_WIDTH = "min(28rem, calc(100vw - 2rem))";
const NOTE_CHAT_PANEL_DOCK_OFFSET =
	COMPOSER_DOCK_BOTTOM_OFFSET - COMPOSER_OVERLAY_FOOTER_PADDING;
const NOTE_CHAT_INLINE_PANEL_DOCK_OFFSET = COMPOSER_OVERLAY_FOOTER_PADDING;
const INLINE_POPOVER_FOOTER_CONTAINER_CLASS = "px-6 pt-2 pb-4";
const NOTE_COMPOSER_FOOTER_SURFACE_CLASS =
	"min-h-[132px] max-w-full overflow-hidden rounded-lg border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 data-[drag-over=true]:border-ring data-[drag-over=true]:ring-3 data-[drag-over=true]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/30";
const NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-0 pt-2.5";
const NOTE_COMPOSER_FOOTER_BODY_CLASS =
	"min-h-[44px] max-h-[24rem] overflow-y-auto pb-0 text-[14px] leading-[1.6] font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0";
const NOTE_COMPOSER_FOOTER_BODY_SPACER_CLASS =
	"min-h-[40px] w-full shrink-0 px-4 pt-2 pb-0";
const NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-2.5";
const INLINE_POPOVER_FOOTER_DEFAULT_HEIGHT = 120;
const TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD = 32;
const TRANSCRIPT_INITIAL_WINDOW_SIZE = 32;

const getStoredChatModel = (model: string | undefined): ChatModel | null =>
	model ? (findChatModel(model) ?? null) : null;

const getPersistedChatReasoningEffort = (
	reasoningEffort: string | undefined,
): ReasoningEffort | null =>
	reasoningEffort ? (findReasoningEffort(reasoningEffort)?.id ?? null) : null;

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
	noteCaptureRequestId?: string | null;
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

type ComposerKeyboardEvent = Pick<
	KeyboardEvent,
	"key" | "shiftKey" | "preventDefault" | "isComposing"
> & {
	nativeEvent?: Pick<KeyboardEvent, "isComposing">;
};

const createDraftChatId = (): string => crypto.randomUUID();

type NoteComposerDraftMetadata = {
	selectedRecipeSlug: RecipeSlug;
};

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
	noteCaptureRequestId,
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
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const noteId = (noteContext.noteId as Id<"notes"> | null) ?? null;
	const noteStorageScopeKey = getNoteStorageScopeKey(noteId);
	const draftStorageScope = noteId ? getNoteComposerDraftScope(noteId) : null;
	const {
		clear: clearDraft,
		getSnapshot: getDraftSnapshot,
		metadata: draftMetadata,
		setMetadata: setDraftMetadata,
		setText: setMessage,
		text: message,
	} = useComposerDraft<NoteComposerDraftMetadata>(draftStorageScope);
	const [panelModeState, setPanelModeState] = React.useState<
		"chat" | "transcript" | null
	>(null);
	const [presentationModeState, setPresentationModeState] =
		React.useState<NoteChatPresentation>("inline");
	const [currentChatId, setCurrentChatId] = React.useState<string>(() =>
		createDraftChatId(),
	);
	const [isPreparingRequest, setIsPreparingRequest] = React.useState(false);
	const [
		isAutomationConfirmationSubmitting,
		setIsAutomationConfirmationSubmitting,
	] = React.useState(false);
	const [sharedLocalFolders, setSharedLocalFolders] = React.useState<
		DesktopLocalFolder[]
	>([]);
	const localFolderStorageScope = `note-chat:${currentChatId}`;
	const [, startTranscriptPanelTransition] = React.useTransition();
	const inlinePopoverHeightStorageKey = getNoteScopedStorageKeyForViewport({
		prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
		noteScopeKey: noteStorageScopeKey,
		isMobileViewport: isMobile,
	});
	const floatingPanelHeightStorageKey = getNoteScopedStorageKeyForViewport({
		prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
		noteScopeKey: noteStorageScopeKey,
		isMobileViewport: isMobile,
	});
	const [inlinePanelHeight, setInlinePanelHeight] = React.useState(() =>
		readStoredPanelHeight(
			getNoteScopedStorageKey({
				prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
				noteScopeKey: noteStorageScopeKey,
				platform: getCurrentPanelViewportPlatform(),
			}),
			INLINE_POPOVER_DEFAULT_HEIGHT,
		),
	);
	const [floatingPanelHeight, setFloatingPanelHeight] = React.useState(() =>
		readStoredPanelHeight(
			getNoteScopedStorageKey({
				prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
				noteScopeKey: noteStorageScopeKey,
				platform: getCurrentPanelViewportPlatform(),
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
	const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
		getStoredReasoningEffort,
	);
	const selectedRecipeSlug = draftMetadata?.selectedRecipeSlug ?? null;
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	useRevokeAttachmentObjectUrls(attachedFiles);
	const setSelectedRecipeSlug = React.useCallback(
		(value: React.SetStateAction<RecipeSlug | null>) => {
			const nextValue =
				typeof value === "function" ? value(selectedRecipeSlug) : value;
			setDraftMetadata(nextValue ? { selectedRecipeSlug: nextValue } : null);
		},
		[selectedRecipeSlug, setDraftMetadata],
	);
	const rootRef = React.useRef<HTMLDivElement>(null);
	const inlinePanelRef = React.useRef<HTMLDivElement>(null);
	const composerEditorRef = React.useRef<HTMLDivElement>(null);
	const pendingComposerFocusRef = React.useRef(false);
	const composerFocusFrameRef = React.useRef<number | null>(null);
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
	const previousSpeechListeningRef = React.useRef(false);
	const panelModeRef = React.useRef(panelModeState);
	const presentationModeRef = React.useRef(presentationModeState);
	const shouldFocusInlineChatRef = React.useRef(false);
	const shouldIgnoreNextOutsidePointerDownRef = React.useRef(false);
	const suppressRecipePickerUntilUserActionRef = React.useRef(false);
	// react-doctor-disable-next-line react-doctor/no-event-handler
	const panelMode = panelModeState;
	const presentationMode = presentationModeState;

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
	const activeRun = useQuery(
		api.assistantRuns.getAttachableRun,
		activeWorkspaceId && hasStoredCurrentChat
			? { workspaceId: activeWorkspaceId, chatId: currentChatId }
			: "skip",
	);
	const attachableActiveRun =
		activeRun && activeRun.status !== "stopping" ? activeRun : null;
	const currentChatSession = useQuery(
		api.chats.getSession,
		activeWorkspaceId && hasStoredCurrentChat
			? {
					workspaceId: activeWorkspaceId,
					chatId: currentChatId,
				}
			: "skip",
	);
	const userPreferences = useQuery(api.userPreferences.get, {});
	const selectedNoteChat =
		(noteChats ?? []).find((chat) => chat.chatId === currentChatId) ?? null;
	const selectedModel =
		(selectedModelOverride?.chatId === currentChatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(selectedNoteChat?.model ?? currentChatSession?.model) ??
		getStoredLocalChatModel();
	const selectedReasoningEffort = resolveReasoningEffortPreference({
		persistedChatReasoningEffort: getPersistedChatReasoningEffort(
			selectedNoteChat?.reasoningEffort ?? currentChatSession?.reasoningEffort,
		),
		chatReasoningEffortOverride: getStoredChatReasoningEffort(currentChatId),
		globalReasoningEffortOverride: getStoredReasoningEffortOverride(),
		userPreferenceReasoningEffort: userPreferences?.reasoningEffort,
		fallbackReasoningEffort: reasoningEffort,
	});
	const updateUserPreferences = useMutation(api.userPreferences.update);
	const truncateFromMessage = useMutation(api.chats.truncateFromMessage);
	const persistChatSettings = useMutation(api.chats.setChatSettings);
	const enqueueQueuedMessage = useMutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
	);
	const updateQueuedMessage = useMutation(
		api.assistantQueuedMessages.updateQueued,
	);
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			setSelectedModelOverride({ chatId: currentChatId, model });
			storeChatModel(model);

			if (!activeWorkspaceId || currentChatSession?.model === model.model) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				model: model.model,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist note chat model",
				});
				toast.error("Failed to save model");
			});
		},
		[
			activeWorkspaceId,
			currentChatId,
			currentChatSession?.model,
			persistChatSettings,
		],
	);
	const handleReasoningEffortChange = React.useCallback(
		(value: ReasoningEffort) => {
			setReasoningEffort(value);
			storeReasoningEffort(value);
			storeChatReasoningEffort(currentChatId, value);

			void updateUserPreferences({ reasoningEffort: value }).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist default reasoning effort",
				});
			});

			if (!activeWorkspaceId || currentChatSession?.reasoningEffort === value) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				reasoningEffort: value,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist note chat reasoning effort",
				});
				toast.error("Failed to save reasoning");
			});
		},
		[
			activeWorkspaceId,
			currentChatId,
			currentChatSession?.reasoningEffort,
			persistChatSettings,
			updateUserPreferences,
		],
	);
	const recipeData = useQuery(
		api.recipes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
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
				logError({
					event: "client.error",
					error: error,
					message: "Failed to update transcription language",
				});
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
		autoStartTranscriptionRequestId: noteCaptureRequestId,
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
				logError({
					event: "client.error",
					error: error,
					message: "Failed to prefetch note chat snapshot",
				});
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

	const transport = useWorkspaceChatTransport(activeWorkspaceId);

	const initialMessages = React.useMemo(
		() => toStoredChatMessages(storedMessages ?? []),
		[storedMessages],
	);
	const [pendingTruncateMessageId, setPendingTruncateMessageId] =
		React.useState<string | null>(null);
	const activePendingTruncateMessageId =
		pendingTruncateMessageId &&
		initialMessages.some((message) => message.id === pendingTruncateMessageId)
			? pendingTruncateMessageId
			: null;
	const visibleInitialMessages = React.useMemo(
		() =>
			applyPendingMessageTruncation(
				initialMessages,
				activePendingTruncateMessageId,
			),
		[activePendingTruncateMessageId, initialMessages],
	);
	const latestRequestBodyRef = React.useRef<Record<string, unknown> | null>(
		null,
	);
	const addToolOutputRef =
		React.useRef<ChatAddToolOutputFunction<UIMessage> | null>(null);
	const [localOptimisticMessages, setLocalOptimisticMessages] =
		React.useState<ScopedLocalOptimisticMessages | null>(null);
	const [
		activeSteerHandoffStreamingMessageIds,
		setActiveSteerHandoffStreamingMessageIds,
	] = React.useState<ReadonlySet<string>>(() => new Set());
	const handleToolCall = React.useMemo(
		() =>
			createDesktopLocalToolCallHandler({
				addToolOutputRef,
				latestRequestBodyRef,
			}),
		[],
	);
	const {
		messages: chatMessages,
		setMessages,
		sendMessage,
		regenerate,
		error: chatError,
		status: chatStatus,
		stop,
		resumeStream,
		addToolOutput,
	} = useChat({
		// react-doctor-disable-next-line react-doctor/no-event-handler
		id: currentChatId,
		experimental_throttle: CHAT_STREAM_UI_THROTTLE_MS,
		messages: initialMessages,
		transport,
		onToolCall: handleToolCall,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
	});
	addToolOutputRef.current = addToolOutput;
	const controllerMessages = React.useMemo(
		() => normalizeChatMessages(chatMessages),
		[chatMessages],
	);
	const isAiRequestPending =
		chatStatus === "submitted" || chatStatus === "streaming";
	const isChatRequestPending =
		isAiRequestPending ||
		// react-doctor-disable-next-line react-doctor/no-event-handler
		isPreparingRequest;
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
			controllerMessages.findLastIndex(
				(currentMessage) => currentMessage.role === "user",
			) + 1,
		);
		const snapshotMessagesAfterLatestUser = visibleInitialMessages.slice(
			visibleInitialMessages.findLastIndex(
				(currentMessage) => currentMessage.role === "user",
			) + 1,
		);
		const activeControllerAssistantMessage = [
			...controllerMessagesAfterLatestUser,
		]
			.reverse()
			.find((currentMessage) => currentMessage.role === "assistant");
		const activeSnapshotAssistantMessage = [...snapshotMessagesAfterLatestUser]
			.reverse()
			.find((currentMessage) => currentMessage.role === "assistant");

		return (
			activeControllerAssistantMessage?.id ??
			activeSnapshotAssistantMessage?.id ??
			displayActiveRun.assistantMessageId
		);
	}, [controllerMessages, displayActiveRun, visibleInitialMessages]);
	const steerHandoffStreamingMessageIds =
		displayActiveRun || isAiRequestPending || isPreparingRequest
			? activeSteerHandoffStreamingMessageIds
			: EMPTY_STEER_HANDOFF_STREAMING_MESSAGE_IDS;
	const mergedDisplayChatMessages = React.useMemo(() => {
		if (!activeAssistantMessageId || !displayActiveRun) {
			return controllerMessages.length > 0
				? controllerMessages
				: visibleInitialMessages;
		}

		const activeControllerMessage = controllerMessages.find(
			(message) =>
				message.id === activeAssistantMessageId && message.role === "assistant",
		);
		const activeSnapshotMessage = visibleInitialMessages.find(
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
			persistedMessages: visibleInitialMessages,
		});
	}, [
		activeAssistantMessageId,
		controllerMessages,
		displayActiveRun,
		visibleInitialMessages,
	]);
	const displayChatMessages = React.useMemo(
		() =>
			appendLocalOptimisticChatMessages({
				displayMessages: mergedDisplayChatMessages,
				localOptimisticMessages:
					localOptimisticMessages?.chatId === currentChatId
						? localOptimisticMessages.messages
						: [],
				resolvedMessages: visibleInitialMessages,
			}),
		[
			currentChatId,
			localOptimisticMessages,
			mergedDisplayChatMessages,
			visibleInitialMessages,
		],
	);
	const automationDeleteConfirmation = React.useMemo(
		() => getPendingAutomationDeleteConfirmation(displayChatMessages),
		[displayChatMessages],
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

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);

	useResumeActiveChatRun({
		activeRun: displayActiveRun,
		chatId: currentChatId,
		enabled: hasStoredCurrentChat && !isChatRequestPending,
		resumeStream,
		workspaceId: activeWorkspaceId,
	});

	const initialMessagesSeedKey = React.useMemo(
		() => getUIMessageSeedKey(visibleInitialMessages),
		[visibleInitialMessages],
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
			// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
			setMessages(visibleInitialMessages);
			return;
		}

		if (isLocalRequestRunning) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);
			const nextInitialMessages = activeAssistantMessageId
				? removeChatMessageById(
						visibleInitialMessages,
						activeAssistantMessageId,
					)
				: visibleInitialMessages;

			if (
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedInitialMessagesSeedKeyRef.current ||
				(!activeRun && nextInitialMessages.length > 0)
			) {
				appliedInitialMessagesSeedKeyRef.current = initialMessagesSeedKey;
				return nextInitialMessages;
			}

			return normalizeChatMessages(currentMessages);
		});
	}, [
		activeRun,
		activeAssistantMessageId,
		chatStatus,
		currentChatId,
		initialMessagesSeedKey,
		isPreparingRequest,
		setMessages,
		visibleInitialMessages,
	]);

	const resetTextareaHeight = React.useCallback(() => {}, []);
	const resizeTextarea = React.useCallback(() => {}, []);

	const getInlinePanelMaxHeight = React.useCallback(
		() => getCurrentPanelMaxHeight(),
		[],
	);
	const getFloatingPanelMaxHeight = React.useCallback(
		() => getCurrentPanelMaxHeight(),
		[],
	);

	const clampInlinePanelHeight = React.useCallback(
		(nextHeight: number) =>
			clampPanelHeight({
				nextHeight,
				maxHeight: getInlinePanelMaxHeight(),
			}),
		[getInlinePanelMaxHeight],
	);
	const clampFloatingPanelHeight = React.useCallback(
		(nextHeight: number) =>
			clampPanelHeight({
				nextHeight,
				maxHeight: getFloatingPanelMaxHeight(),
			}),
		[getFloatingPanelMaxHeight],
	);

	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setInlinePanelHeight((currentHeight) =>
			clampInlinePanelHeight(currentHeight),
		);
	}, [clampInlinePanelHeight]);
	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-derived-state
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
		// react-doctor-disable-next-line react-doctor/no-derived-state
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
		// react-doctor-disable-next-line react-doctor/no-derived-state
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
	const isPersistedChatStreaming = Boolean(displayActiveRun);
	const isChatUiPending =
		// react-doctor-disable-next-line react-doctor/no-event-handler
		isChatRequestPending || isPersistedChatStreaming;
	const canStop = isChatRequestPending || isPersistedChatStreaming;
	const localMessageIds = React.useMemo(
		() =>
			new Set([
				...controllerMessages.map((message) => message.id),
				...(localOptimisticMessages?.chatId === currentChatId
					? localOptimisticMessages.messages.map((message) => message.id)
					: []),
			]),
		[controllerMessages, currentChatId, localOptimisticMessages],
	);
	const { queuedMessages, setQueuedMessages } = useQueuedChatDrain({
		activeRun: displayActiveRun,
		chatId: currentChatId,
		contextLabel: "note chat",
		isBlocked: isChatRequestPending,
		latestRequestBodyRef,
		localMessageIds,
		sendMessage,
		workspaceId: activeWorkspaceId,
	});
	const hasMessage = message.trim().length > 0;
	const canGenerateNotes = resolveCanGenerateNotes({
		hasGeneratedLatestTranscript:
			transcriptSession.hasGeneratedLatestTranscript,
		hasPendingGenerateTranscript:
			transcriptSession.hasPendingGenerateTranscript,
		isChatOpen,
		isGeneratingTemplateNote:
			noteContext.templateSlug === ENHANCED_NOTE_TEMPLATE_SLUG,
		isSpeechListening: isCurrentNoteSpeechListening,
		isTranscriptOpen,
		isTranscriptSessionReady: transcriptSession.isTranscriptSessionReady,
	});
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
		? "Ask for follow-up"
		: hasKnownNoteChat
			? "Ask for follow-up"
			: "Ask anything. @ to mention recipes";
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
	const closeComposerPopovers = React.useCallback(() => {
		if (recipePopoverOpen) {
			suppressRecipePickerUntilUserActionRef.current = true;
		}
		setModelPopoverOpen(false);
		setRecipePopoverOpen(false);
	}, [recipePopoverOpen]);
	const stopCurrentStream = React.useCallback(
		async ({ interruptActiveRun = false } = {}) => {
			stop();

			if (!displayActiveRun) {
				return;
			}

			if (!activeWorkspaceId) {
				throw new Error(
					"Cannot stop note chat stream without an active workspace.",
				);
			}
			await stopActiveChatStream({
				chatId: currentChatId,
				interruptActiveRun,
				workspaceId: activeWorkspaceId,
			});
		},
		[activeWorkspaceId, currentChatId, displayActiveRun, stop],
	);
	const {
		editDraft: queuedMessageEditDraft,
		finishQueuedMessageEdit,
		onQueuedFollowUpsReorder,
		queuedFollowUps,
		restoreEditedQueuedMessage,
		sendQueuedFollowUpNow,
	} = useQueuedFollowUpControls({
		activeRun: displayActiveRun,
		chatId: currentChatId,
		contextLabel: "note chat",
		latestRequestBodyRef,
		localMessageIds,
		onEditMessage: (queuedMessage) => {
			setEditingMessageId(queuedMessage._id);
			setMessage(queuedMessage.text);
			setDraftMetadata(null);
			setAttachedFiles([]);
			resetTextareaHeight();
			pendingComposerFocusRef.current = true;
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
	const handleStop = React.useCallback(() => {
		const stopPromise = queuedFollowUp
			? sendQueuedFollowUpNow()
			: stopCurrentStream();

		void stopPromise.catch((error) => {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to stop note chat stream",
			});
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to stop note chat stream",
			);
		});
	}, [queuedFollowUp, sendQueuedFollowUpNow, stopCurrentStream]);
	const toggleTranscriptPanel = React.useCallback(() => {
		closeComposerPopovers();
		closeRightSidebar();
		startTranscriptPanelTransition(() => {
			setPanelMode((currentValue) =>
				currentValue === "transcript" ? null : "transcript",
			);
		});
	}, [closeComposerPopovers, closeRightSidebar, setPanelMode]);

	const resetComposerForNoteChange = React.useCallback(() => {
		setCurrentChatId(createDraftChatId());
		setMessages([]);
		setEditingMessageId(null);
		setAttachedFiles([]);
		setPanelMode(null);
		setRecipePopoverOpen(false);
		resetTextareaHeight();
		closeRightSidebar();
	}, [closeRightSidebar, resetTextareaHeight, setMessages, setPanelMode]);

	React.useEffect(() => {
		if (previousNoteIdRef.current === noteId) {
			return;
		}

		previousNoteIdRef.current = noteId;

		if (canStop) {
			// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
			handleStop();
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
		resetComposerForNoteChange();
	}, [canStop, handleStop, noteId, resetComposerForNoteChange]);

	React.useEffect(() => {
		if (
			selectedRecipeSlug &&
			!recipes.some((recipe) => recipe.slug === selectedRecipeSlug)
		) {
			// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
			setSelectedRecipeSlug(null);
		}
	}, [recipes, selectedRecipeSlug, setSelectedRecipeSlug]);

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
			// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state
			setPanelMode(null);
		}

		previousSpeechListeningRef.current = isCurrentNoteSpeechListening;
	}, [closeRightSidebar, isCurrentNoteSpeechListening, setPanelMode]);

	React.useEffect(() => {
		if (presentationMode === "inline") {
			return;
		}

		if (!isRightSidebarOpen && panelMode === "chat") {
			// react-doctor-disable-next-line react-doctor/no-derived-state
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
			composerEditorRef.current
				?.querySelector<HTMLElement>(".ProseMirror")
				?.focus({ preventScroll: true });
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
			if (shouldIgnoreNextOutsidePointerDownRef.current) {
				shouldIgnoreNextOutsidePointerDownRef.current = false;
				return;
			}

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

			if (composerEditorRef.current?.contains(target)) {
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

	React.useEffect(() => {
		if (panelMode === "chat" && presentationMode === "inline") {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		closeComposerPopovers();
	}, [closeComposerPopovers, panelMode, presentationMode]);

	const openDraftChat = React.useCallback(() => {
		if (canStop) {
			handleStop();
		}

		closeComposerPopovers();
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
		closeComposerPopovers,
		canStop,
		handleStop,
		openRightSidebar,
		presentationMode,
		setMessages,
		setPanelMode,
	]);

	const focusComposerInput = React.useCallback(() => {
		const editorElement =
			composerEditorRef.current?.querySelector<HTMLElement>(".ProseMirror");
		if (!editorElement) {
			return false;
		}

		editorElement.focus({ preventScroll: true });
		return document.activeElement === editorElement;
	}, []);
	const schedulePendingComposerFocus = React.useCallback(() => {
		if (composerFocusFrameRef.current !== null) {
			return;
		}

		const focusAfterFrame = () => {
			composerFocusFrameRef.current = null;
			if (!rootRef.current) {
				return;
			}

			if (!pendingComposerFocusRef.current) {
				return;
			}

			if (focusComposerInput()) {
				pendingComposerFocusRef.current = false;
				return;
			}

			composerFocusFrameRef.current =
				window.requestAnimationFrame(focusAfterFrame);
		};

		composerFocusFrameRef.current =
			window.requestAnimationFrame(focusAfterFrame);
	}, [focusComposerInput]);
	const requestComposerFocus = React.useCallback(() => {
		pendingComposerFocusRef.current = true;
		if (focusComposerInput()) {
			return;
		}

		schedulePendingComposerFocus();
	}, [focusComposerInput, schedulePendingComposerFocus]);

	React.useLayoutEffect(() => {
		if (!pendingComposerFocusRef.current) {
			return;
		}

		if (focusComposerInput()) {
			pendingComposerFocusRef.current = false;
			return;
		}

		schedulePendingComposerFocus();
	});

	const handleSend = React.useCallback(async () => {
		const submittedDraftText = getDraftSnapshot().text;
		const nextMessage = getMessageTextWithoutRecipeMention(
			submittedDraftText,
			selectedRecipe,
		);

		if (
			(!nextMessage && !selectedRecipe && attachedFiles.length === 0) ||
			hasUploadingAttachments(attachedFiles) ||
			((chatStatus === "submitted" || chatStatus === "streaming") &&
				!displayActiveRun &&
				!activeRun) ||
			(isPreparingRequest && !displayActiveRun && !activeRun) ||
			(displayActiveRun && attachedFiles.length > 0)
		) {
			return;
		}

		let optimisticMessageId: string | null = null;

		try {
			const outgoingText = nextMessage || selectedRecipe?.name || "";
			const recipeMetadata: UIMessage["metadata"] | undefined = selectedRecipe
				? {
						recipe: {
							slug: selectedRecipe.slug,
							name: selectedRecipe.name,
						},
						recipeOnly: nextMessage.length === 0,
					}
				: undefined;
			setIsPreparingRequest(true);
			if (queuedMessageEditDraft) {
				if (!activeWorkspaceId) {
					throw new Error("Cannot edit queued message without a workspace.");
				}

				const currentNoteContext = readNoteContext();
				const requestBody = await buildNoteChatRequestBody({
					localFolderStorageScope,
					model: selectedModel.model,
					noteContext: {
						noteId: currentNoteContext.noteId,
						title: currentNoteContext.title,
						text: currentNoteContext.text,
					},
					reasoningEffort: selectedReasoningEffort,
					recipeSlug: selectedRecipe?.slug ?? null,
					resolveConvexToken: getCachedConvexToken,
					text: outgoingText,
				});
				const updatedQueuedMessage = await updateQueuedMessage({
					workspaceId: activeWorkspaceId,
					chatId: currentChatId,
					queuedMessageId: queuedMessageEditDraft.message._id,
					message: toQueuedUserMessageInput({
						messageId: queuedMessageEditDraft.message.messageId,
						metadata: recipeMetadata,
						requestBody,
						text: outgoingText,
					}),
				});

				latestRequestBodyRef.current = requestBody;
				finishQueuedMessageEdit(updatedQueuedMessage);
				setEditingMessageId(null);
				clearDraft();
				setAttachedFiles([]);
				resetTextareaHeight();
				setIsPreparingRequest(false);
				requestComposerFocus();
				return;
			}

			if (presentationMode === "inline") {
				setPanelMode("chat");
			} else {
				openRightSidebar(presentationMode);
			}

			const currentNoteContext = readNoteContext();
			clearDraft();
			setAttachedFiles([]);
			resetTextareaHeight();
			const result = await submitChatTurn({
				attachedFiles,
				buildRequestBody: () =>
					buildNoteChatRequestBody({
						localFolderStorageScope,
						model: selectedModel.model,
						noteContext: {
							noteId: currentNoteContext.noteId,
							title: currentNoteContext.title,
							text: currentNoteContext.text,
						},
						reasoningEffort: selectedReasoningEffort,
						recipeSlug: selectedRecipe?.slug ?? null,
						resolveConvexToken: getCachedConvexToken,
						text: outgoingText,
					}),
				chatId: currentChatId,
				displayActiveRun,
				editingMessageId,
				enqueueQueuedMessage,
				metadata: recipeMetadata,
				onOptimisticMessage: (message) => {
					optimisticMessageId = message.id;
					// react-doctor-disable-next-line react-doctor/no-flush-sync
					flushSync(() => {
						setEditingMessageId(null);
						clearDraft();
						setAttachedFiles([]);
						resetTextareaHeight();
						setLocalOptimisticMessages((currentState) => ({
							chatId: currentChatId,
							messages: normalizeChatMessages([
								...(currentState?.chatId === currentChatId
									? currentState.messages
									: []),
								message,
							]),
						}));
						setMessages((currentMessages) =>
							normalizeChatMessages([...currentMessages, message]),
						);
					});
					requestComposerFocus();
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
				text: outgoingText,
				workspaceId: activeWorkspaceId,
			});

			if (result.status === "queued") {
				setEditingMessageId(null);
				clearDraft();
				setAttachedFiles([]);
				resetTextareaHeight();
				await waitForBrowserPaint();
				setIsPreparingRequest(false);
				requestComposerFocus();
				return;
			}
			setIsPreparingRequest(false);
			requestComposerFocus();
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to prepare note chat request",
			});
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to prepare note chat request",
			);
			if (optimisticMessageId) {
				const failedOptimisticMessageId = optimisticMessageId;
				setLocalOptimisticMessages((currentState) =>
					currentState?.chatId === currentChatId
						? {
								chatId: currentChatId,
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
			setMessage(submittedDraftText);
			setAttachedFiles(attachedFiles);
			resetTextareaHeight();
			setIsPreparingRequest(false);
			requestComposerFocus();
		}
	}, [
		activeRun,
		activeWorkspaceId,
		attachedFiles,
		chatStatus,
		clearDraft,
		currentChatId,
		displayActiveRun,
		enqueueQueuedMessage,
		finishQueuedMessageEdit,
		isAiRequestPending,
		isPreparingRequest,
		getDraftSnapshot,
		localFolderStorageScope,
		openRightSidebar,
		presentationMode,
		queuedMessageEditDraft,
		readNoteContext,
		resetTextareaHeight,
		selectedRecipe,
		selectedReasoningEffort,
		editingMessageId,
		selectedModel.model,
		sendMessage,
		setPanelMode,
		setMessages,
		setMessage,
		setQueuedMessages,
		updateQueuedMessage,
		requestComposerFocus,
	]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		await handleSend();
	};

	const submitAutomationConfirmationResponse = React.useCallback(
		async (text: string) => {
			const outgoingText = text.trim();
			if (!outgoingText || isAutomationConfirmationSubmitting) {
				return;
			}

			setIsAutomationConfirmationSubmitting(true);
			setIsPreparingRequest(true);
			if (presentationMode === "inline") {
				setPanelMode("chat");
			} else {
				openRightSidebar(presentationMode);
			}

			const currentNoteContext = readNoteContext();
			await submitAutomationConfirmationChatTurn({
				activeRun,
				activeWorkspaceId,
				buildRequestBody: (confirmationText) =>
					buildNoteChatRequestBody({
						localFolderStorageScope,
						model: selectedModel.model,
						noteContext: {
							noteId: currentNoteContext.noteId,
							title: currentNoteContext.title,
							text: currentNoteContext.text,
						},
						reasoningEffort: selectedReasoningEffort,
						recipeSlug: null,
						resolveConvexToken: getCachedConvexToken,
						text: confirmationText,
					}),
				chatId: currentChatId,
				displayActiveRun,
				enqueueQueuedMessage,
				isAiRequestPending,
				onFinally: () => {
					setIsAutomationConfirmationSubmitting(false);
					setIsPreparingRequest(false);
					requestComposerFocus();
				},
				onOptimisticMessage: requestComposerFocus,
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
			activeRun,
			activeWorkspaceId,
			currentChatId,
			displayActiveRun,
			enqueueQueuedMessage,
			isAiRequestPending,
			isAutomationConfirmationSubmitting,
			localFolderStorageScope,
			openRightSidebar,
			presentationMode,
			readNoteContext,
			requestComposerFocus,
			selectedModel.model,
			selectedReasoningEffort,
			sendMessage,
			setMessages,
			setPanelMode,
			setQueuedMessages,
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
			void submitAutomationConfirmationResponse(answer);
		},
		[submitAutomationConfirmationResponse],
	);

	const handleComposerValueChange = (nextValue: string) => {
		setMessage(nextValue);
	};

	const handleComposerKeyDown = (event: ComposerKeyboardEvent) => {
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			(event.nativeEvent?.isComposing ?? event.isComposing)
		) {
			return;
		}

		event.preventDefault();
		void handleSend();
	};

	const handleEditMessage = React.useCallback(
		(messageId: string, text: string) => {
			if (canStop) {
				handleStop();
			}

			setEditingMessageId(messageId);
			setMessage(text);
			setAttachedFiles([]);
			resizeTextarea();
			requestComposerFocus();
		},
		[canStop, handleStop, requestComposerFocus, resizeTextarea, setMessage],
	);

	const handleCancelEdit = React.useCallback(() => {
		restoreEditedQueuedMessage();
		setEditingMessageId(null);
		clearDraft();
		setAttachedFiles([]);
		resetTextareaHeight();
		requestComposerFocus();
	}, [
		clearDraft,
		requestComposerFocus,
		resetTextareaHeight,
		restoreEditedQueuedMessage,
	]);

	const buildRequestBody = React.useCallback(async () => {
		const currentNoteContext = readNoteContext();

		return await buildNoteChatRequestBodyFromLocalFolders({
			localFolders: sharedLocalFolders,
			model: selectedModel.model,
			noteContext: {
				noteId: currentNoteContext.noteId,
				title: currentNoteContext.title,
				text: currentNoteContext.text,
			},
			reasoningEffort: selectedReasoningEffort,
			recipeSlug: selectedRecipe?.slug ?? null,
			resolveConvexToken: getCachedConvexToken,
		});
	}, [
		readNoteContext,
		selectedReasoningEffort,
		selectedModel.model,
		selectedRecipe?.slug,
		sharedLocalFolders,
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
				currentMessages?.chatId === currentChatId
					? {
							chatId: currentChatId,
							messages: normalizeChatMessages(
								getMessagesBefore(currentMessages.messages, messageId),
							),
						}
					: currentMessages,
			);
			setEditingMessageId(null);
			clearDraft();
			setAttachedFiles([]);
			resetTextareaHeight();

			if (!activeWorkspaceId) {
				return;
			}

			void truncateFromMessage({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				messageId,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete note chat message",
				});
				toast.error("Failed to delete message");
				setPendingTruncateMessageId(null);
			});
		},
		[
			activeWorkspaceId,
			canStop,
			currentChatId,
			resetTextareaHeight,
			setMessages,
			clearDraft,
			handleStop,
			truncateFromMessage,
		],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (canStop) {
				await stopCurrentStream();
			}

			setIsPreparingRequest(true);
			if (presentationMode === "inline") {
				setPanelMode("chat");
			} else {
				openRightSidebar(presentationMode);
			}

			try {
				const requestBody = await buildRequestBody();
				latestRequestBodyRef.current = requestBody;

				setEditingMessageId(null);
				clearDraft();
				resetTextareaHeight();
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
					message: "Failed to prepare note chat regeneration",
				});
				setIsPreparingRequest(false);
			}
		},
		[
			buildRequestBody,
			canStop,
			clearDraft,
			openRightSidebar,
			presentationMode,
			regenerate,
			resetTextareaHeight,
			setPanelMode,
			stopCurrentStream,
		],
	);

	const handleSelectChat = (chatId: string) => {
		if (currentChatId === chatId) {
			return;
		}

		if (canStop) {
			handleStop();
		}

		closeComposerPopovers();
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
		closeComposerPopovers();
		flushSync(() => {
			setPresentationMode("inline");
			closeRightSidebar();
			shouldFocusInlineChatRef.current = true;
			setPanelMode("chat");
		});
		focusComposerInput();
	};

	const handleSelectRightPresentation = (
		mode: Exclude<NoteChatPresentation, "inline">,
	) => {
		closeComposerPopovers();
		flushSync(() => {
			openRightSidebar(mode);
		});
		focusComposerInput();
	};

	const handleHideChat = () => {
		closeComposerPopovers();
		closeRightSidebar();
		setPanelMode(null);
	};

	const openInlineChatFromComposer = React.useCallback(() => {
		closeComposerPopovers();
		if (latestNoteChat) {
			handlePrefetchNoteChat(latestNoteChat.chatId);
			setCurrentChatId(latestNoteChat.chatId);
		}

		closeRightSidebar();
		setPresentationMode("inline");
		setEditingMessageId(null);
		shouldIgnoreNextOutsidePointerDownRef.current = true;
		shouldFocusInlineChatRef.current = true;
		setPanelMode("chat");
	}, [
		closeComposerPopovers,
		closeRightSidebar,
		handlePrefetchNoteChat,
		latestNoteChat,
		setPanelMode,
		setPresentationMode,
	]);

	const handleComposerPointerDown = React.useCallback(() => {
		openInlineChatFromComposer();
	}, [openInlineChatFromComposer]);

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
		openInlineChatFromComposer();
	}, [openInlineChatFromComposer]);

	return {
		autoStartKey: transcriptSession.autoStartKey,
		currentNoteScopeKey: transcriptSession.currentNoteScopeKey,
		canGenerateNotes,
		chatError,
		chatMessages: displayChatMessages,
		chatTitle,
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
		composerEditorRef,
		handleComposerKeyDown,
		handleComposerValueChange,
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
		hasMessage,
		canSendMessage,
		attachedFiles,
		setAttachedFiles,
		streamingMessageIds,
		systemAudioStatus: transcriptSession.systemAudioStatus,
		recoveryStatus: transcriptSession.recoveryStatus,
		inlinePanelRef,
		inlinePanelHeight,
		canStop,
		isChatLoading: isChatUiPending,
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
		rootRef,
		recipePopoverOpen,
		recipes,
		selectedRecipe,
		sidebarPanelWidth,
		sidebarPanelWidthCss,
		setPanelMode,
		canActivateInlineFromComposer: true,
		setModelPopoverOpen,
		setReasoningEffort: handleReasoningEffortChange,
		setSelectedModel: handleSelectedModelChange,
		setRecipePopoverOpen,
		setSelectedRecipeSlug,
		reasoningEffort: selectedReasoningEffort,
		selectedModel,
		automationDeleteConfirmation,
		isAutomationConfirmationSubmitting,
		onAutomationConfirmationCancel: handleAutomationConfirmationCancel,
		onAutomationConfirmationConfirm: handleAutomationConfirmationConfirm,
		onAutomationConfirmationTextAnswer: handleAutomationConfirmationTextAnswer,
		queuedFollowUps,
		onQueuedFollowUpsReorder,
		suppressRecipePickerUntilUserActionRef,
		handleStop,
		shouldShowInlinePanel,
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
				logError({
					event: "client.error",
					error: error,
					message: "Failed to open sound settings",
				});
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
					"w-fit min-w-0 cursor-pointer gap-1 rounded-full border-transparent !bg-transparent pr-2 text-sm text-muted-foreground shadow-none hover:!bg-muted",
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

function NoteChatHeader({
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
	const hasNoteChats = (noteChats?.length ?? 0) > 0;
	const chatTitleClassName = cn(
		"min-w-0 max-w-full justify-start gap-0.5 border-0 !bg-transparent text-left shadow-none",
		isDesktopSidebarHeader
			? "h-9 px-2.5 pr-1.5 text-sm"
			: "h-8 px-2 pr-1.5 text-sm",
		sidebarCompact ? "max-w-[min(100%,18rem)]" : "max-w-[min(100%,36rem)]",
		sidebarCompact ? "-ml-1" : "-ml-2",
	);

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
				{hasNoteChats ? (
					<Select value={currentChatId} onValueChange={onSelectChat}>
						<SelectTrigger
							size="sm"
							title={chatTitle}
							aria-label="Select note chat"
							className={cn(
								chatTitleClassName,
								"cursor-pointer hover:!bg-accent/50 focus-visible:!bg-accent/50 focus-visible:ring-0 data-[state=open]:!bg-accent/50 dark:!bg-transparent dark:hover:!bg-accent/50 dark:data-[state=open]:!bg-accent/50",
							)}
						>
							<span className="min-w-0 truncate text-sm text-foreground">
								{chatTitle}
							</span>
						</SelectTrigger>
						<SelectContent
							align="start"
							className="min-w-[var(--radix-select-trigger-width)] max-w-[90vw]"
						>
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
											onPointerDown={() => handlePrefetchNoteChat(chat.chatId)}
										>
											<span className="block min-w-0 max-w-full truncate">
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
											onPointerDown={() => handlePrefetchNoteChat(chat.chatId)}
										>
											<span className="block min-w-0 max-w-full truncate">
												{chat.title}
											</span>
										</SelectItem>
									))}
								</SelectGroup>
							) : null}
						</SelectContent>
					</Select>
				) : (
					<div className={cn(chatTitleClassName, "flex items-center")}>
						<span className="min-w-0 truncate text-sm text-foreground">
							New chat
						</span>
					</div>
				)}
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
					<DropdownMenuContent
						align="end"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
						}}
					>
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

// oxlint-disable-next-line react-doctor/no-giant-component -- Tiptap note-chat composer keeps recipe suggestion lifecycle and submit controls together.
function ChatInlinePopoverFooter({
	composerEditorRef,
	composerPlaceholder,
	handleComposerFocus,
	handleComposerPointerDown,
	handleComposerKeyDown,
	handleComposerValueChange,
	onStop,
	status,
	editingMessageId,
	message,
	selectedRecipe,
	attachedFiles,
	onAttachedFilesChange,
	onRecipePopoverOpenChange,
	onRecipeSelect,
	onModelPopoverOpenChange,
	onSelectedModelChange,
	onReasoningEffortChange,
	suppressRecipePickerUntilUserActionRef,
	recipePopoverOpen,
	recipes,
	modelPopoverOpen,
	selectedModel,
	reasoningEffort,
	speechControls,
}: {
	composerEditorRef: React.RefObject<HTMLDivElement | null>;
	composerPlaceholder: string;
	handleComposerFocus: () => void;
	handleComposerPointerDown: () => void;
	handleComposerKeyDown: (event: ComposerKeyboardEvent) => void;
	handleComposerValueChange: (nextValue: string) => void;
	onStop: () => void;
	status: {
		activateInlineOnFocus: boolean;
		isRecipeLoading: boolean;
		canSendMessage: boolean;
		canStop: boolean;
		isChatLoading: boolean;
		isSidebarCompact: boolean;
		showModelPicker: boolean;
	};
	editingMessageId: string | null;
	message: string;
	selectedRecipe: RecipePrompt | null;
	attachedFiles: ChatAttachment[];
	onAttachedFilesChange: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
	onRecipePopoverOpenChange: (open: boolean) => void;
	onRecipeSelect: (recipeSlug: RecipeSlug | null) => void;
	onModelPopoverOpenChange: (open: boolean) => void;
	onSelectedModelChange: (model: ChatModel) => void;
	onReasoningEffortChange: (value: ReasoningEffort) => void;
	suppressRecipePickerUntilUserActionRef: React.MutableRefObject<boolean>;
	recipePopoverOpen: boolean;
	recipes: RecipePrompt[];
	modelPopoverOpen: boolean;
	selectedModel: ChatModel;
	reasoningEffort: ReasoningEffort;
	speechControls: React.ReactNode;
}) {
	const {
		activateInlineOnFocus,
		isRecipeLoading,
		canSendMessage,
		canStop,
		isChatLoading,
		isSidebarCompact,
		showModelPicker,
	} = status;
	const shouldShowRecipeControls = !activateInlineOnFocus;
	const activeMentionRangeRef = React.useRef<Range | null>(null);
	const filteredRecipesRef = React.useRef<RecipePrompt[]>(recipes);
	const handleRecipeSelectRef = React.useRef<(recipeSlug: RecipeSlug) => void>(
		() => {},
	);
	const recipePopoverOpenRef = React.useRef(recipePopoverOpen);
	const previousRecipePopoverOpenRef = React.useRef(recipePopoverOpen);
	const selectedRecipeIndexRef = React.useRef(0);
	const [activeMentionQuery, setActiveMentionQuery] = React.useState("");
	const [recipePickerPosition, setRecipePickerPosition] =
		React.useState<MentionPickerPosition | null>(null);
	const [selectedRecipeIndex, setSelectedRecipeIndex] = React.useState(0);
	const composerPlaceholderRef = React.useRef(composerPlaceholder);
	const previousComposerPlaceholderRef = React.useRef(composerPlaceholder);
	const selectedRecipeSlugRef = React.useRef<RecipeSlug | null>(
		selectedRecipe?.slug ?? null,
	);
	composerPlaceholderRef.current = composerPlaceholder;
	const filteredRecipes = React.useMemo(() => {
		const normalizedQuery = activeMentionQuery.trim().toLowerCase();

		if (!normalizedQuery) {
			return recipes;
		}

		return recipes.filter((recipe) =>
			`${recipe.name} ${recipe.slug}`.toLowerCase().includes(normalizedQuery),
		);
	}, [activeMentionQuery, recipes]);
	filteredRecipesRef.current = filteredRecipes;
	if (previousRecipePopoverOpenRef.current && !recipePopoverOpen) {
		suppressRecipePickerUntilUserActionRef.current = true;
	}
	previousRecipePopoverOpenRef.current = recipePopoverOpen;
	recipePopoverOpenRef.current = recipePopoverOpen;
	selectedRecipeSlugRef.current = selectedRecipe?.slug ?? null;
	selectedRecipeIndexRef.current = selectedRecipeIndex;

	const selectRecipeIndex = React.useCallback((index: number) => {
		selectedRecipeIndexRef.current = index;
		setSelectedRecipeIndex(index);
	}, []);
	const closeRecipePicker = React.useCallback(() => {
		activeMentionRangeRef.current = null;
		recipePopoverOpenRef.current = false;
		setActiveMentionQuery("");
		setRecipePickerPosition(null);
		selectRecipeIndex(0);
		onRecipePopoverOpenChange(false);
	}, [onRecipePopoverOpenChange, selectRecipeIndex]);
	const composerEditor = useEditor({
		extensions: [
			...createPlainTextEditorExtensions(),
			TypedMention.configure({
				HTMLAttributes: {
					class: INLINE_MENTION_CLASS,
				},
				renderText({ node }) {
					return `@${node.attrs.label ?? node.attrs.id}`;
				},
				renderHTML({ node }) {
					const id = String(node.attrs.id);
					const label = String(node.attrs.label ?? node.attrs.id);
					return renderInlineMentionHTML({
						id,
						label,
						type: "note",
					});
				},
				suggestion: {
					char: "@",
					allowedPrefixes: [" ", "\n"],
					command: ({ editor, range, props }) => {
						editor
							.chain()
							.focus()
							.insertContentAt(range, [
								{
									type: "mention",
									attrs: {
										id: props.id,
										label: props.label,
									},
								},
								{ type: "text", text: " " },
							])
							.run();
					},
					items: ({ query }) => {
						const normalizedQuery = query.trim().toLowerCase();
						return recipes
							.filter((recipe) =>
								`${recipe.name} ${recipe.slug}`
									.toLowerCase()
									.includes(normalizedQuery),
							)
							.slice(0, 8)
							.map((recipe) => ({
								id: recipe.slug,
								label: recipe.name,
							}));
					},
					render: () => {
						const updatePicker = ({
							editor,
							range,
							query,
						}: {
							editor: Editor;
							range: Range;
							query: string;
						}) => {
							if (suppressRecipePickerUntilUserActionRef.current) {
								activeMentionRangeRef.current = null;
								recipePopoverOpenRef.current = false;
								setRecipePickerPosition(null);
								onRecipePopoverOpenChange(false);
								return;
							}

							const rect = getMentionAnchorRect(editor, range);
							const normalizedQuery = query.trim().toLowerCase();
							const nextRecipes = normalizedQuery
								? recipes.filter((recipe) =>
										`${recipe.name} ${recipe.slug}`
											.toLowerCase()
											.includes(normalizedQuery),
									)
								: recipes;
							activeMentionRangeRef.current = range;
							filteredRecipesRef.current = nextRecipes;
							setActiveMentionQuery(query);
							selectRecipeIndex(0);
							setRecipePickerPosition(
								getMentionPickerPosition({
									rect,
									itemCount: nextRecipes.length,
								}),
							);
							recipePopoverOpenRef.current = true;
							onRecipePopoverOpenChange(true);
						};

						return {
							onStart: updatePicker,
							onUpdate: updatePicker,
							onKeyDown: ({ event }) =>
								handleRecipePickerKeyDown({
									event,
									filteredRecipesRef,
									handleRecipeSelect: (recipeSlug) =>
										handleRecipeSelectRef.current(recipeSlug),
									selectRecipeIndex,
									selectedRecipeIndexRef,
								}),
							onExit: closeRecipePicker,
						};
					},
				},
			}),
			Placeholder.configure({
				placeholder: () => composerPlaceholderRef.current,
			}),
		],
		content: "",
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		editorProps: {
			attributes: {
				class:
					"chat-composer-tiptap min-h-full max-h-[24rem] w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent pt-3 pr-3 pb-0 pl-3.5 text-left text-[14px] leading-[1.6] font-normal shadow-none ring-0 outline-none focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
				"data-slot": "input-group-control",
			},
			handleDOMEvents: {
				pointerdown: () => {
					if (activateInlineOnFocus) {
						handleComposerPointerDown();
					} else {
						suppressRecipePickerUntilUserActionRef.current = false;
					}

					return false;
				},
				focus: () => {
					if (activateInlineOnFocus) {
						handleComposerFocus();
					}
					return false;
				},
			},
			handleKeyDown: (_view, event) => {
				suppressRecipePickerUntilUserActionRef.current = false;
				if (recipePopoverOpenRef.current) {
					return handleRecipePickerKeyDown({
						event,
						filteredRecipesRef,
						handleRecipeSelect: (recipeSlug) =>
							handleRecipeSelectRef.current(recipeSlug),
						selectRecipeIndex,
						selectedRecipeIndexRef,
					});
				}

				handleComposerKeyDown(event);
				return event.defaultPrevented;
			},
		},
		onUpdate: ({ editor }) => {
			suppressRecipePickerUntilUserActionRef.current = false;
			const nextValue = editor.getText({ blockSeparator: "\n" });
			handleComposerValueChange(nextValue);
			const nextRecipeSlug = getRecipeSlugFromComposerContent(editor.getJSON());
			if (selectedRecipeSlugRef.current !== nextRecipeSlug) {
				selectedRecipeSlugRef.current = nextRecipeSlug;
				onRecipeSelect(nextRecipeSlug);
			}
		},
	});
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		if (previousComposerPlaceholderRef.current === composerPlaceholder) {
			return;
		}

		previousComposerPlaceholderRef.current = composerPlaceholder;
		// react-doctor-disable-next-line react-doctor/no-derived-state
		composerEditor.view.dispatch(
			// react-doctor-disable-next-line react-doctor/no-derived-state
			composerEditor.state.tr.setMeta("addToHistory", false),
		);
	}, [composerEditor, composerPlaceholder]);
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		const currentText = composerEditor.getText({ blockSeparator: "\n" });
		const currentRecipeSlug = getRecipeSlugFromComposerContent(
			// react-doctor-disable-next-line react-doctor/no-derived-state
			composerEditor.getJSON(),
		);
		if (
			currentText === message &&
			currentRecipeSlug === (selectedRecipe?.slug ?? null)
		) {
			return;
		}

		if (composerEditor.isFocused && message.length > 0 && !editingMessageId) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		composerEditor.commands.setContent(
			getComposerContentFromMessage(message, selectedRecipe),
			{ emitUpdate: false },
		);
	}, [composerEditor, editingMessageId, message, selectedRecipe]);
	const handleRecipeSelect = React.useCallback(
		(recipeSlug: RecipeSlug) => {
			const recipe = recipes.find((item) => item.slug === recipeSlug);
			const activeMentionRange = activeMentionRangeRef.current;
			if (!composerEditor || !recipe || !activeMentionRange) {
				return;
			}

			composerEditor
				.chain()
				.focus()
				.insertContentAt(activeMentionRange, [
					{
						type: "mention",
						attrs: {
							id: recipe.slug,
							label: recipe.name,
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			onRecipeSelect(recipe.slug);
			closeRecipePicker();
			requestAnimationFrame(() => {
				composerEditor.commands.focus();
			});
		},
		[closeRecipePicker, composerEditor, onRecipeSelect, recipes],
	);
	handleRecipeSelectRef.current = handleRecipeSelect;
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
	const handleInputGroupPointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!activateInlineOnFocus) {
				return;
			}

			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest(
					"button, a[href], input, select, textarea, [role='button'], [data-slot='dropdown-menu-content'], [data-slot='select-content']",
				)
			) {
				return;
			}

			handleComposerPointerDown();
		},
		[activateInlineOnFocus, handleComposerPointerDown],
	);
	React.useEffect(() => {
		if (!activateInlineOnFocus) {
			return;
		}

		const composerEditorElement = composerEditorRef.current;
		if (!composerEditorElement) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			event.preventDefault();
			event.stopPropagation();
			handleComposerPointerDown();
		};

		composerEditorElement.addEventListener("pointerdown", handlePointerDown, {
			capture: true,
		});

		return () => {
			composerEditorElement.removeEventListener(
				"pointerdown",
				handlePointerDown,
				{
					capture: true,
				},
			);
		};
	}, [activateInlineOnFocus, composerEditorRef, handleComposerPointerDown]);
	const attachmentDropzone = useFileAttachmentDropzone({
		disabled: isChatLoading,
		onFileUploadFailed: handleAttachmentUploadFailed,
		onFileUploaded: handleAttachmentUploaded,
		onFilesAdded: handleAttachmentsAdded,
	});
	return (
		<>
			<InputGroup
				data-drag-over={attachmentDropzone.isDragOver ? "true" : undefined}
				className={NOTE_COMPOSER_FOOTER_SURFACE_CLASS}
				{...attachmentDropzone.dropzoneProps}
				onPointerDown={handleInputGroupPointerDown}
			>
				{attachedFiles.length > 0 ? (
					<InputGroupAddon
						align="block-start"
						className={cn(
							NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS,
							isSidebarCompact && "px-3.5",
						)}
					>
						<FileAttachmentChips
							files={attachedFiles}
							onRemove={(index) =>
								onAttachedFilesChange(
									attachedFiles.filter((_, fileIndex) => fileIndex !== index),
								)
							}
						/>
					</InputGroupAddon>
				) : null}

				<div
					data-slot="input-group-control"
					ref={composerEditorRef}
					className={cn(
						NOTE_COMPOSER_FOOTER_BODY_CLASS,
						"chat-composer-editor relative flex w-full flex-1 cursor-text",
						isSidebarCompact && "[&_.chat-composer-tiptap]:px-3.5",
					)}
					onFocusCapture={() => {
						if (activateInlineOnFocus) {
							handleComposerFocus();
						}
					}}
					onPointerDownCapture={() => {
						if (activateInlineOnFocus) {
							handleComposerPointerDown();
						}
					}}
				>
					{activateInlineOnFocus ? (
						<button
							type="button"
							className="absolute inset-0 z-10 cursor-text bg-transparent p-0 text-left"
							aria-label="Open follow-up chat"
							onClick={handleComposerPointerDown}
							onPointerDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								handleComposerPointerDown();
							}}
						/>
					) : null}
					{composerEditor ? (
						<Tiptap editor={composerEditor}>
							<Tiptap.Content />
						</Tiptap>
					) : null}
				</div>
				<InputGroupAddon
					align="block-end"
					className={cn(
						NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS,
						isSidebarCompact ? "flex-nowrap pl-3.5 pr-2.5" : "px-2",
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
						<div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
							<ChatModelPicker
								open={modelPopoverOpen}
								onOpenChange={onModelPopoverOpenChange}
								selectedModel={selectedModel}
								onSelectedModelChange={onSelectedModelChange}
								reasoningEffort={reasoningEffort}
								onReasoningEffortChange={onReasoningEffortChange}
								triggerClassName="min-w-0 max-w-full text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
								triggerIconClassName="text-current"
								modelNameClassName="min-w-0 max-w-[120px] truncate"
							/>
						</div>
					) : null}
					<InputGroupButton
						type={canStop && !canSendMessage ? "button" : "submit"}
						variant="default"
						size="icon-sm"
						className={cn("rounded-full", !showModelPicker && "ml-auto")}
						aria-label={
							canStop && !canSendMessage ? "Stop streaming" : "Send message"
						}
						disabled={
							canStop
								? canSendMessage && hasUploadingAttachments(attachedFiles)
								: isChatLoading ||
									!canSendMessage ||
									hasUploadingAttachments(attachedFiles)
						}
						onClick={canStop && !canSendMessage ? onStop : undefined}
					>
						{canStop && !canSendMessage ? (
							<Square className="size-3.5 fill-current" />
						) : (
							<ArrowUp className="size-4" />
						)}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<NoteRecipeMentionPicker
				open={recipePopoverOpen}
				position={recipePickerPosition}
				recipes={filteredRecipes}
				selectedIndex={selectedRecipeIndex}
				onSelectedIndexChange={selectRecipeIndex}
				isRecipeLoading={isRecipeLoading}
				emptyStateMessage={
					activeMentionQuery.trim().length > 0
						? "No recipes found."
						: "Type to search for recipes"
				}
				onSelectRecipe={handleRecipeSelect}
			/>
		</>
	);
}

function handleRecipePickerKeyDown({
	event,
	filteredRecipesRef,
	handleRecipeSelect,
	selectRecipeIndex,
	selectedRecipeIndexRef,
}: {
	event: KeyboardEvent;
	filteredRecipesRef: React.RefObject<RecipePrompt[]>;
	handleRecipeSelect: (recipeSlug: RecipeSlug) => void;
	selectRecipeIndex: (index: number) => void;
	selectedRecipeIndexRef: React.RefObject<number>;
}) {
	if (
		event.key !== "ArrowDown" &&
		event.key !== "ArrowUp" &&
		event.key !== "Enter"
	) {
		return false;
	}

	const recipes = filteredRecipesRef.current;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectRecipeIndex(
			recipes.length === 0
				? 0
				: (selectedRecipeIndexRef.current + 1) % recipes.length,
		);
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectRecipeIndex(
			recipes.length === 0
				? 0
				: (selectedRecipeIndexRef.current - 1 + recipes.length) %
						recipes.length,
		);
		return true;
	}

	const selectedRecipe = recipes[selectedRecipeIndexRef.current] ?? recipes[0];
	if (!selectedRecipe) {
		return false;
	}

	event.preventDefault();
	handleRecipeSelect(selectedRecipe.slug);
	return true;
}

function NoteRecipeMentionPicker({
	open,
	position,
	recipes,
	selectedIndex,
	onSelectedIndexChange,
	isRecipeLoading,
	emptyStateMessage,
	onSelectRecipe,
}: {
	open: boolean;
	position: MentionPickerPosition | null;
	recipes: RecipePrompt[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	isRecipeLoading: boolean;
	emptyStateMessage: string;
	onSelectRecipe: (recipeSlug: RecipeSlug) => void;
}) {
	if (!open || !position) {
		return null;
	}

	return createPortal(
		<div
			{...noteRecipePickerListboxProps}
			className="fixed z-[70] flex w-72 flex-col rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 pointer-events-auto"
			style={{
				top: position.top,
				left: position.left,
			}}
			onPointerDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<div className="max-h-72 overflow-y-auto p-1">
				{isRecipeLoading ? <div className="py-6" aria-hidden="true" /> : null}
				{!isRecipeLoading && recipes.length === 0 ? (
					<div className="py-6 text-center text-sm text-muted-foreground">
						{emptyStateMessage}
					</div>
				) : null}
				{recipes.length > 0 ? (
					<div>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Recipes
						</div>
						<div className="space-y-0.5">
							{recipes.map((recipe, index) => {
								const Icon = getRecipeIcon(recipe.slug);
								const selected = index === selectedIndex;
								return (
									<button
										key={recipe.slug}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(index)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectRecipe(recipe.slug);
										}}
										className={cn(
											"flex h-9 w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-left",
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
											<Icon className="size-4" />
										</div>
										<div
											className="min-w-0 flex-1 truncate"
											title={recipe.name}
										>
											{recipe.name}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
			</div>
		</div>,
		document.body,
	);
}

function TranscriptInlinePopoverFooter({
	containerRef,
	controller,
	hideConsentNotice,
	isSpeechListening,
	speechControls,
	topAccessory,
}: {
	containerRef?: React.Ref<HTMLDivElement>;
	controller: NoteComposerController;
	hideConsentNotice: boolean;
	isSpeechListening: boolean;
	speechControls: React.ReactNode;
	topAccessory?: React.ReactNode;
}) {
	const shouldShowConsentNotice =
		isSpeechListening && !hideConsentNotice && !topAccessory;

	return (
		<InlinePopoverFooterContainer
			ref={containerRef}
			className={NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS}
		>
			<div className="relative">
				{shouldShowConsentNotice || topAccessory ? (
					<div className="pointer-events-none absolute inset-x-4 bottom-full z-10 mb-3 flex flex-col items-center gap-2">
						{shouldShowConsentNotice ? (
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
						className={cn(NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS, "!px-2")}
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
						variant="outline"
						size="sm"
						className="pointer-events-auto px-4"
						onClick={controller.handleGenerateNotes}
						disabled={controller.isGeneratingNotes}
					>
						{controller.isGeneratingNotes ? (
							<LoaderCircle className="size-4 animate-spin" />
						) : (
							<WandSparkles className="size-4" />
						)}
						{controller.isGeneratingNotes ? "Generating…" : "Generate notes"}
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
			{controller.automationDeleteConfirmation ? (
				<ChatAutomationConfirmationBar
					confirmation={controller.automationDeleteConfirmation}
					disabled={controller.isAutomationConfirmationSubmitting}
					onCancel={controller.onAutomationConfirmationCancel}
					onConfirm={controller.onAutomationConfirmationConfirm}
					onTextAnswer={controller.onAutomationConfirmationTextAnswer}
				/>
			) : null}
			{controller.queuedFollowUps.length > 0 ? (
				<ChatQueuedFollowUpBar
					queuedFollowUps={controller.queuedFollowUps}
					onReorder={controller.onQueuedFollowUpsReorder}
				/>
			) : null}
			<ChatInlinePopoverFooter
				composerEditorRef={controller.composerEditorRef}
				composerPlaceholder={controller.composerPlaceholder}
				handleComposerFocus={controller.handleComposerFocus}
				handleComposerPointerDown={controller.handleComposerPointerDown}
				handleComposerKeyDown={controller.handleComposerKeyDown}
				handleComposerValueChange={controller.handleComposerValueChange}
				onStop={controller.handleStop}
				status={{
					activateInlineOnFocus,
					isRecipeLoading: controller.isRecipeLoading,
					canSendMessage: controller.canSendMessage,
					canStop: controller.canStop,
					isChatLoading: controller.isChatLoading,
					isSidebarCompact: controller.isSidebarPresentation,
					showModelPicker: controller.isChatOpen && !activateInlineOnFocus,
				}}
				editingMessageId={controller.editingMessageId}
				message={controller.message}
				selectedRecipe={controller.selectedRecipe}
				attachedFiles={controller.attachedFiles}
				onAttachedFilesChange={controller.setAttachedFiles}
				onRecipePopoverOpenChange={controller.setRecipePopoverOpen}
				onRecipeSelect={(recipeSlug) => {
					controller.setSelectedRecipeSlug(recipeSlug);
				}}
				onModelPopoverOpenChange={controller.setModelPopoverOpen}
				onSelectedModelChange={controller.setSelectedModel}
				onReasoningEffortChange={controller.setReasoningEffort}
				suppressRecipePickerUntilUserActionRef={
					controller.suppressRecipePickerUntilUserActionRef
				}
				recipePopoverOpen={controller.recipePopoverOpen}
				recipes={controller.recipes}
				modelPopoverOpen={controller.modelPopoverOpen}
				selectedModel={controller.selectedModel}
				reasoningEffort={controller.reasoningEffort}
				speechControls={speechControls}
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

	// react-doctor-disable-next-line react-doctor/exhaustive-deps
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
									logError({
										event: "client.error",
										error: error,
										message: "Failed to copy transcript",
									});
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
	isTranscriptScrollButtonVisible,
	shouldRenderInlineComposer,
}: {
	controller: NoteComposerController;
	isTranscriptScrollButtonVisible: boolean;
	shouldRenderInlineComposer: boolean;
}) {
	if (
		shouldRenderInlineComposer ||
		!controller.isSpeechListening ||
		isTranscriptScrollButtonVisible
	) {
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
					? "w-full max-w-full min-w-0"
					: undefined
			}
			speechControls={null}
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
	return (
		<MessageScrollerProvider autoScroll>
			<NoteComposerTranscriptPanelContentBody controller={controller} />
		</MessageScrollerProvider>
	);
}

function NoteComposerTranscriptPanelContentBody({
	controller,
}: {
	controller: NoteComposerController;
}) {
	const shouldRenderInlineComposer = controller.shouldShowInlinePanel;
	const transcriptScrollable = useMessageScrollerScrollable();
	const isTranscriptScrollButtonVisible =
		Boolean(controller.fullTranscript) &&
		controller.displayTranscriptEntries.length > 0 &&
		transcriptScrollable.end;
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
				<NoteTranscriptPanel controller={controller} />
			</CardContent>

			<TranscriptPanelNoticeStack
				controller={controller}
				isTranscriptScrollButtonVisible={isTranscriptScrollButtonVisible}
				shouldRenderInlineComposer={shouldRenderInlineComposer}
			/>

			{shouldRenderInlineComposer ? (
				<TranscriptInlinePopoverFooter
					containerRef={overlayFooterRef}
					controller={controller}
					hideConsentNotice={isTranscriptScrollButtonVisible}
					isSpeechListening={controller.isSpeechListening}
					speechControls={
						<NoteComposerSpeechControls controller={controller} />
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
		<NoteChatMessagesEntry
			chatError={controller.chatError}
			chatMessages={controller.chatMessages}
			disableAddToNote={!onAddMessageToNote}
			disablePadding={controller.isSidebarPresentation}
			isChatLoading={controller.isChatLoading}
			onAddMessageToNote={onAddMessageToNote}
			onDeleteMessage={controller.handleDeleteMessage}
			onEditMessage={controller.handleEditMessage}
			onRegenerateMessage={controller.handleRegenerateMessage}
			streamingMessageIds={controller.streamingMessageIds}
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
}: {
	controller: NoteComposerController;
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
		return <div className="flex flex-1" aria-hidden="true" />;
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
			<MessageScroller className="min-h-0 w-full flex-1">
				<MessageScrollerViewport className="pr-4">
					<MessageScrollerContent className="gap-4">
						{isDeferringTranscriptEntries &&
						deferredDisplayTranscriptEntries.length === 0 ? (
							<div className="flex flex-1 py-12" aria-hidden="true" />
						) : null}
						{isProgressivelyRenderingTranscript ? (
							<div className="h-4" aria-hidden="true" />
						) : null}
						{renderedTranscriptEntries.map((utterance) => {
							const isUserTranscript = utterance.speaker === "you";
							const elapsed =
								controller.transcriptStartedAt != null
									? formatTranscriptElapsed(
											utterance.startedAt - controller.transcriptStartedAt,
										)
									: null;

							return (
								<MessageScrollerItem
									key={utterance.id}
									messageId={utterance.id}
									className={cn(
										"group/message flex w-full flex-col gap-1 transition-colors",
										isUserTranscript ? "items-end" : "items-start",
									)}
								>
									<div
										className={cn(
											CHAT_MESSAGE_MAX_WIDTH_CLASS,
											isUserTranscript
												? utterance.isLive
													? cn(
															USER_CHAT_BUBBLE_CLASS,
															"bg-secondary/70 text-muted-foreground",
														)
													: USER_CHAT_BUBBLE_CLASS
												: utterance.isLive
													? cn(
															ASSISTANT_CHAT_CONTENT_CLASS,
															"text-muted-foreground",
														)
													: ASSISTANT_CHAT_CONTENT_CLASS,
										)}
										style={{
											containIntrinsicSize: "120px",
											contentVisibility: "auto",
										}}
									>
										<p className="whitespace-pre-wrap">{utterance.text}</p>
									</div>
									{elapsed ? (
										<p className="px-1 text-[11px] font-medium tabular-nums text-muted-foreground/65">
											{elapsed}
										</p>
									) : null}
								</MessageScrollerItem>
							);
						})}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				{renderedTranscriptEntries.length > 0 ? (
					<MessageScrollerButton
						aria-label="Scroll to latest transcript"
						className={NOTE_POPOVER_SCROLLER_BUTTON_CLASS}
					/>
				) : null}
			</MessageScroller>
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
				activateInlineOnFocus={controller.canActivateInlineFromComposer}
				controller={controller}
				formClassName="group/composer mx-auto w-full max-w-full min-w-0"
				speechControls={<NoteComposerSpeechControls controller={controller} />}
			/>
		</div>
	);
}
