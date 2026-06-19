import type { UIMessage } from "ai";

export declare const hostedChatSteerAcceptedHeader: "X-Graneri-Steer-Accepted";
export declare const hostedChatReplayAcceptedHeader: "X-Graneri-Replay-Accepted";
export declare const hostedChatSteerTurnIdHeader: "X-Graneri-Turn-Id";
export declare const hostedChatSteerQueuedMessageIdHeader: "X-Graneri-Queued-Message-Id";
export declare const hostedChatSteerQueuedMessageIdsHeader: "X-Graneri-Queued-Message-Ids";
export declare const hostedChatReplayQueuedMessageIdHeader: "X-Graneri-Replay-Queued-Message-Id";
export declare const MAX_HOSTED_CHAT_INPUT_TEXT_CHARS: 1048576;
export declare const HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE: "input_too_large";
export declare const HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE: "input_empty";
export declare const HOSTED_CHAT_CONVEX_DEPLOYMENT_OUT_OF_SYNC_ERROR_CODE: "convex_deployment_out_of_sync";
export declare const getHostedChatSteerAcceptanceHeaders: (args: {
	queuedMessageId: string;
	queuedMessageIds?: string[];
	turnId: string;
}) => Record<string, string>;
export declare const getHostedChatReplayAcceptanceHeaders: (args: {
	queuedMessageId: string;
}) => Record<string, string>;
export declare const getHostedChatConvexErrorData: (
	error: unknown,
) => Record<string, unknown> | null;
export declare const isHostedChatConvexErrorCode: (
	error: unknown,
	code: string,
) => boolean;
export declare const isHostedChatQueuedMessageNotFoundError: (
	error: unknown,
) => boolean;
export declare const getHostedChatConvexRouteError: (
	error: unknown,
) => null | {
	error: string;
	errorCode: string;
	statusCode: 400 | 409 | 500;
};
export declare const getHostedChatSteerTelemetry: (args: {
	acceptedTurnId?: string | null;
	errorCode?: string | null;
	expectedTurnId?: string | null;
	isSteerRoute: boolean;
	outcome?: "error" | "success" | null;
	queuedMessageId?: string | null;
}) => null | {
	turn_steer_accepted_turn_id: string | null;
	turn_steer_expected_turn_id: string | null;
	turn_steer_num_input_images: 0;
	turn_steer_queued_message_id: string | null;
	turn_steer_rejection_reason: string | null;
	turn_steer_result: "accepted" | "rejected";
};
export declare const validateHostedChatSteerRoute: (args: {
	continueRunId?: string | null;
	hasMessage?: boolean;
	isSteerRoute: boolean;
	replayQueuedMessageId?: string | null;
	steerQueuedMessageId?: string | null;
}) => null | {
	error: string;
	errorCode:
		| "continue_run_id_invalid"
		| "queued_message_body_conflict"
		| "queued_message_mode_conflict"
		| "queued_replay_active_run_conflict"
		| "replay_queued_message_id_invalid"
		| "steer_context_missing"
		| "steer_queued_message_id_invalid"
		| "steer_route_required";
	statusCode: 400;
};
export declare const getHostedChatMessageTextCharCount: (
	message: UIMessage,
) => number;
export declare const createHostedChatInputTooLargeError: (
	actualChars: number,
) => Error & {
	code: typeof HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE;
	maxChars: typeof MAX_HOSTED_CHAT_INPUT_TEXT_CHARS;
	actualChars: number;
};
export declare const createHostedChatInputEmptyError: () => Error & {
	code: typeof HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE;
};
export declare const validateHostedChatInputTextLimit: (
	message: UIMessage,
) => void;
export declare const validateHostedChatInput: (message: UIMessage) => void;
export declare const clampHostedChatWhitespace: (value: string) => string;
export declare const clampHostedNoteContext: (value: string) => string;
export declare const generateHostedChatMessageId: () => string;
export declare const getHostedChatMessageText: (message: UIMessage) => string;
export declare const getHostedChatPreviewFromMessage: (
	message: UIMessage,
) => string;
export declare const toHostedStoredMessage: (message: UIMessage) => {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson: string | undefined;
	text: string;
	createdAt: number;
};
export declare const toHostedQueuedUserMessage: (queuedMessage: {
	messageId: string;
	metadataJson?: string;
	partsJson: string;
}) => UIMessage;
export declare const buildHostedChatSaveMessageArgs: <
	WorkspaceId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
>(args: {
	chatId: string;
	message: UIMessage;
	model: string;
	noteId?: NoteId | null;
	reasoningEffort: ReasoningEffort;
	title?: string;
	workspaceId: WorkspaceId;
}) => {
	workspaceId: WorkspaceId;
	chatId: string;
	noteId: NoteId | undefined;
	title: string | undefined;
	preview: string;
	model: string;
	reasoningEffort: ReasoningEffort;
	message: ReturnType<typeof toHostedStoredMessage>;
};
export declare const fromHostedStoredMessages: (
	messages: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>,
) => UIMessage[];
export declare const prepareHostedChatBranch: (args: {
	interruptedAssistantMessageIds?: string[];
	message?: UIMessage;
	messageId?: string;
	messages?: UIMessage[];
	storedMessages?: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>;
	trigger?: "submit-message" | "regenerate-message";
}) => {
	editedMessageIndex: number;
	incomingMessages: UIMessage[];
	shouldTruncateChatBranch: boolean;
	truncateMessageId: string | undefined;
};
export declare const getInlineHostedNoteContext: (args: {
	title?: string;
	text?: string;
}) => string;
export declare const getStoredHostedNoteContext: (
	note:
		| {
				title: string;
				searchableText?: string | null;
		  }
		| null
		| undefined,
) => string;
export declare const buildHostedNotesContext: (
	notes: Array<{
		title: string;
		searchableText?: string | null;
	}>,
) => string;
export declare const getHostedChatRecipeContext: (
	selectedRecipe:
		| {
				name: string;
				prompt: string;
		  }
		| null
		| undefined,
) => string;
export declare const buildHostedChatRuntimePrompt: (args: {
	automationInstruction?: string;
	attachedNoteContext?: string;
	coreToolInstruction?: string;
	localFolderContext?: string;
	notesContext?: string;
	recipeContext?: string;
	selectedAppSourceInstructions?: string;
	userProfileContext?: unknown;
	webSearchEnabled?: boolean;
}) => string;
export declare const generateHostedChatTitle: (args: {
	assistantMessage?: UIMessage;
	userMessage: UIMessage;
}) => Promise<string>;
