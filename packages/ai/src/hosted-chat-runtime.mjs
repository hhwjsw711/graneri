import { openai } from "@ai-sdk/openai";
import { createIdGenerator, generateText } from "ai";
import {
	buildChatTitlePrompt,
	deriveFallbackChatTitle,
	finalizeGeneratedChatTitle,
} from "./chat-titles.mjs";
import { aiLogger, serializeError } from "./logger.mjs";
import { CHAT_TITLE_MODEL_ID } from "./models.mjs";
import { buildChatSystemPrompt, CHAT_TITLE_SYSTEM_PROMPT } from "./prompts.mjs";

const MAX_CHAT_PREVIEW_LENGTH = 180;
const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_NOTE_CONTEXT_LENGTH = 16_000;
export const MAX_HOSTED_CHAT_INPUT_TEXT_CHARS = 1_048_576;
export const HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE = "input_too_large";
export const HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE = "input_empty";

export const hostedChatSteerAcceptedHeader = "X-Graneri-Steer-Accepted";
export const hostedChatReplayAcceptedHeader = "X-Graneri-Replay-Accepted";
export const hostedChatSteerTurnIdHeader = "X-Graneri-Turn-Id";
export const hostedChatSteerQueuedMessageIdHeader =
	"X-Graneri-Queued-Message-Id";
export const hostedChatSteerQueuedMessageIdsHeader =
	"X-Graneri-Queued-Message-Ids";
export const hostedChatReplayQueuedMessageIdHeader =
	"X-Graneri-Replay-Queued-Message-Id";

export const getHostedChatSteerAcceptanceHeaders = ({
	queuedMessageId,
	queuedMessageIds,
	turnId,
}) => ({
	[hostedChatSteerAcceptedHeader]: "true",
	[hostedChatSteerTurnIdHeader]: turnId,
	[hostedChatSteerQueuedMessageIdHeader]: queuedMessageId,
	...(Array.isArray(queuedMessageIds) && queuedMessageIds.length > 0
		? { [hostedChatSteerQueuedMessageIdsHeader]: queuedMessageIds.join(",") }
		: {}),
});

export const getHostedChatReplayAcceptanceHeaders = ({ queuedMessageId }) => ({
	[hostedChatReplayAcceptedHeader]: "true",
	[hostedChatReplayQueuedMessageIdHeader]: queuedMessageId,
});

const hostedChatSteerRejectionReasonsByErrorCode = new Map([
	["active_run_interrupt_failed", "active_run_interrupt_failed"],
	["ASSISTANT_RUN_INVARIANT_VIOLATION", "assistant_run_invariant_violation"],
	["active_run_mismatch", "expected_turn_mismatch"],
	["continue_run_id_invalid", "expected_turn_invalid"],
	["input_empty", "empty_input"],
	["input_too_large", "input_too_large"],
	["message_missing", "empty_input"],
	["queued_message_body_conflict", "invalid_request"],
	["queued_message_mode_conflict", "invalid_request"],
	["queued_message_unavailable", "queued_message_unavailable"],
	["steer_context_missing", "no_active_turn"],
	["steer_preparation_failed", "steer_preparation_failed"],
	["steer_queue_cleanup_failed", "steer_queue_cleanup_failed"],
	["steer_queued_message_id_invalid", "queued_message_invalid"],
	["steer_route_required", "invalid_request"],
	["stream_create_failed", "stream_create_failed"],
	["stream_finalize_failed", "stream_finalize_failed"],
	["stream_start_failed", "stream_start_failed"],
	["user_message_persist_failed", "user_message_persist_failed"],
]);

const parseConvexErrorData = (value) => {
	if (!value) {
		return null;
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return null;
	}
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: null;
	} catch {
		return null;
	}
};

export const getHostedChatConvexErrorData = (error) => {
	if (!error || typeof error !== "object") {
		return null;
	}

	const directData = parseConvexErrorData(error.data);
	if (directData) {
		return directData;
	}

	const message = typeof error.message === "string" ? error.message : "";
	const match = message.match(/(?:Uncaught\s+)?ConvexError:\s*(\{.*?\})(?:\s+at|$)/su);
	return match ? parseConvexErrorData(match[1]) : null;
};

const hostedChatConvexRouteErrorMessages = new Map([
	[
		"ASSISTANT_RUN_INVARIANT_VIOLATION",
		"Chat has multiple active assistant runs.",
	],
	["ASSISTANT_RUN_NOT_ACTIVE", "Assistant run is not active."],
	["ASSISTANT_RUN_NOT_FOUND", "Assistant run not found."],
	["CHAT_NOT_FOUND", "Chat not found."],
	["QUEUED_MESSAGE_NOT_FOUND", "Queued message is no longer available."],
	["QUEUED_MESSAGE_NOT_EDITABLE", "Queued message cannot be edited."],
]);

export const getHostedChatConvexRouteError = (error) => {
	const data = getHostedChatConvexErrorData(error);
	const code = typeof data?.code === "string" ? data.code : null;
	if (!code) {
		return null;
	}

	const isAssistantRunLifecycleError =
		code === "ASSISTANT_RUN_INVARIANT_VIOLATION" ||
		code === "ASSISTANT_RUN_NOT_ACTIVE" ||
		code === "ASSISTANT_RUN_NOT_FOUND";
	const isChatLifecycleError = code === "CHAT_NOT_FOUND";
	const isQueuedMessageError = code.startsWith("QUEUED_MESSAGE_");
	if (
		!isAssistantRunLifecycleError &&
		!isChatLifecycleError &&
		!isQueuedMessageError
	) {
		return null;
	}

	return {
		error:
			hostedChatConvexRouteErrorMessages.get(code) ??
			(typeof data.message === "string"
				? data.message
				: "Queued chat request failed validation."),
		errorCode: code,
		statusCode:
			isAssistantRunLifecycleError ||
			isChatLifecycleError ||
			code === "QUEUED_MESSAGE_NOT_FOUND"
				? 409
				: 400,
	};
};

export const getHostedChatSteerTelemetry = ({
	acceptedTurnId,
	errorCode,
	expectedTurnId,
	isSteerRoute,
	outcome,
	queuedMessageId,
}) => {
	const isSteerAttempt = isSteerRoute || Boolean(queuedMessageId);
	if (!isSteerAttempt) {
		return null;
	}

	const accepted = Boolean(acceptedTurnId);
	const rejectionReason =
		!accepted && outcome === "error"
			? (hostedChatSteerRejectionReasonsByErrorCode.get(errorCode) ??
				errorCode ??
				"unknown")
			: null;

	return {
		turn_steer_accepted_turn_id: accepted ? acceptedTurnId : null,
		turn_steer_expected_turn_id: expectedTurnId ?? null,
		turn_steer_num_input_images: 0,
		turn_steer_queued_message_id: queuedMessageId ?? null,
		turn_steer_rejection_reason: rejectionReason,
		turn_steer_result: accepted ? "accepted" : "rejected",
	};
};

export const validateHostedChatSteerRoute = ({
	continueRunId,
	hasMessage = false,
	isSteerRoute,
	replayQueuedMessageId,
	steerQueuedMessageId,
}) => {
	const validateOptionalId = (value, error, errorCode) => {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value !== "string" || value.length === 0) {
			return {
				error,
				errorCode,
				statusCode: 400,
			};
		}
		return null;
	};
	const invalidContinueRunId = validateOptionalId(
		continueRunId,
		"continueRunId must be a non-empty string.",
		"continue_run_id_invalid",
	);
	if (invalidContinueRunId) {
		return invalidContinueRunId;
	}
	const invalidReplayQueuedMessageId = validateOptionalId(
		replayQueuedMessageId,
		"replayQueuedMessageId must be a non-empty string.",
		"replay_queued_message_id_invalid",
	);
	if (invalidReplayQueuedMessageId) {
		return invalidReplayQueuedMessageId;
	}
	const invalidSteerQueuedMessageId = validateOptionalId(
		steerQueuedMessageId,
		"steerQueuedMessageId must be a non-empty string.",
		"steer_queued_message_id_invalid",
	);
	if (invalidSteerQueuedMessageId) {
		return invalidSteerQueuedMessageId;
	}

	if (steerQueuedMessageId && replayQueuedMessageId) {
		return {
			error:
				"Queued message replay and steering cannot be requested together.",
			errorCode: "queued_message_mode_conflict",
			statusCode: 400,
		};
	}

	if (replayQueuedMessageId && continueRunId) {
		return {
			error: "Queued message replay cannot continue an active assistant run.",
			errorCode: "queued_replay_active_run_conflict",
			statusCode: 400,
		};
	}

	if (hasMessage && (steerQueuedMessageId || replayQueuedMessageId)) {
		return {
			error:
				"Queued message replay and steering must not include a client message body.",
			errorCode: "queued_message_body_conflict",
			statusCode: 400,
		};
	}

	if (isSteerRoute) {
		if (!steerQueuedMessageId || !continueRunId) {
			return {
				error:
					"steerQueuedMessageId and continueRunId are required for chat steering.",
				errorCode: "steer_context_missing",
				statusCode: 400,
			};
		}

		return null;
	}

	if (steerQueuedMessageId) {
		return {
			error: "Queued message steering must use /api/chat/steer.",
			errorCode: "steer_route_required",
			statusCode: 400,
		};
	}

	return null;
};

const generateMessageId = createIdGenerator({
	prefix: "msg",
	size: 16,
});

export const generateHostedChatMessageId = generateMessageId;

export const clampHostedChatWhitespace = (value) =>
	value.replace(/\s+/g, " ").trim();

export const clampHostedNoteContext = (value) =>
	value.replace(/\r/g, "").trim().slice(0, MAX_NOTE_CONTEXT_LENGTH);

const truncate = (value, maxLength) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

export const getHostedChatMessageText = (message) =>
	clampHostedChatWhitespace(
		message.parts
			.filter(
				(part) =>
					part.type === "text" &&
					typeof part.text === "string" &&
					part.text.length > 0,
			)
			.map((part) => part.text)
			.join("\n\n"),
	);

export const getHostedChatMessageTextCharCount = (message) =>
	message.parts
		.filter(
			(part) =>
				part.type === "text" &&
				typeof part.text === "string" &&
				part.text.length > 0,
		)
		.reduce((count, part) => count + Array.from(part.text).length, 0);

export const createHostedChatInputTooLargeError = (actualChars) => {
	const error = new Error(
		`Input exceeds the maximum length of ${MAX_HOSTED_CHAT_INPUT_TEXT_CHARS} characters.`,
	);
	error.code = HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE;
	error.maxChars = MAX_HOSTED_CHAT_INPUT_TEXT_CHARS;
	error.actualChars = actualChars;
	return error;
};

export const createHostedChatInputEmptyError = () => {
	const error = new Error("input must not be empty");
	error.code = HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE;
	return error;
};

export const validateHostedChatInputTextLimit = (message) => {
	const actualChars = getHostedChatMessageTextCharCount(message);
	if (actualChars > MAX_HOSTED_CHAT_INPUT_TEXT_CHARS) {
		throw createHostedChatInputTooLargeError(actualChars);
	}
};

export const validateHostedChatInput = (message) => {
	if (!getHostedChatMessageText(message)) {
		throw createHostedChatInputEmptyError();
	}
	validateHostedChatInputTextLimit(message);
};

export const getHostedChatPreviewFromMessage = (message) =>
	truncate(getHostedChatMessageText(message), MAX_CHAT_PREVIEW_LENGTH);

export const toHostedStoredMessage = (message) => ({
	id: message.id || generateMessageId(),
	role: message.role,
	partsJson: JSON.stringify(message.parts),
	metadataJson:
		message.metadata === undefined
			? undefined
			: JSON.stringify(message.metadata),
	text: getHostedChatMessageText(message),
	createdAt: Date.now(),
});

export const buildHostedChatSaveMessageArgs = ({
	chatId,
	message,
	model,
	noteId,
	reasoningEffort,
	title,
	workspaceId,
}) => ({
	workspaceId,
	chatId,
	noteId: noteId ?? undefined,
	title,
	preview: getHostedChatPreviewFromMessage(message),
	model,
	reasoningEffort,
	message: toHostedStoredMessage(message),
});

const parseStoredMessagePartsForModelInput = (partsJson) => {
	try {
		const parts = JSON.parse(partsJson);
		if (!Array.isArray(parts)) {
			return [];
		}

		return parts.flatMap((part) =>
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0
				? [{ type: "text", text: part.text }]
				: [],
		);
	} catch {
		return [];
	}
};

const parseStoredMessageMetadata = (metadataJson) => {
	if (metadataJson === undefined) {
		return undefined;
	}

	try {
		return JSON.parse(metadataJson);
	} catch {
		return undefined;
	}
};

const parseHostedQueuedMessageParts = (partsJson) => {
	const parts = JSON.parse(partsJson);
	if (!Array.isArray(parts)) {
		throw new Error("Queued chat message parts are invalid.");
	}

	const textParts = parts.flatMap((part) =>
		part &&
		typeof part === "object" &&
		part.type === "text" &&
		typeof part.text === "string" &&
		part.text.trim().length > 0
			? [{ type: "text", text: part.text }]
			: [],
	);

	if (textParts.length === 0) {
		throw new Error("Queued chat message cannot be empty.");
	}

	return textParts;
};

export const toHostedQueuedUserMessage = (queuedMessage) => ({
	id: queuedMessage.messageId,
	role: "user",
	metadata: parseStoredMessageMetadata(queuedMessage.metadataJson),
	parts: parseHostedQueuedMessageParts(queuedMessage.partsJson),
});

export const fromHostedStoredMessages = (messages) =>
	messages.flatMap((message) => {
		const parts = parseStoredMessagePartsForModelInput(message.partsJson);

		if (parts.length === 0) {
			return [];
		}

		return [
			{
				id: message.id,
				role: message.role,
				metadata: parseStoredMessageMetadata(message.metadataJson),
				parts,
			},
		];
	});

export const prepareHostedChatBranch = ({
	interruptedAssistantMessageIds = [],
	message,
	messageId,
	messages = [],
	pendingMessages = [],
	storedMessages = [],
	trigger,
}) => {
	const interruptedAssistantMessageIdSet = new Set(
		interruptedAssistantMessageIds,
	);
	const branchStoredMessages =
		interruptedAssistantMessageIdSet.size > 0
			? storedMessages.filter(
					(storedMessage) =>
						!interruptedAssistantMessageIdSet.has(storedMessage.id),
				)
			: storedMessages;
	const editedMessageId = messageId ?? message?.id;
	const editedMessageIndex = editedMessageId
		? branchStoredMessages.findIndex(
				(storedMessage) => storedMessage.id === editedMessageId,
			)
		: -1;
	const baseStoredMessages =
		editedMessageIndex >= 0
			? branchStoredMessages.slice(0, editedMessageIndex)
			: branchStoredMessages;
	const baseMessages = fromHostedStoredMessages(baseStoredMessages);
	const baseMessageIds = new Set(baseMessages.map((baseMessage) => baseMessage.id));
	const pendingIncomingMessages = [];
	for (const pendingMessage of pendingMessages) {
		if (!pendingMessage || baseMessageIds.has(pendingMessage.id)) {
			continue;
		}
		pendingIncomingMessages.push(pendingMessage);
		baseMessageIds.add(pendingMessage.id);
	}
	if (message && !baseMessageIds.has(message.id)) {
		pendingIncomingMessages.push(message);
	}
	const incomingMessages = message
		? [...baseMessages, ...pendingIncomingMessages]
		: messages;
	const truncateMessageId =
		messageId &&
		((trigger === "submit-message" && editedMessageIndex >= 0) ||
			trigger === "regenerate-message")
			? messageId
			: undefined;

	return {
		editedMessageIndex,
		incomingMessages,
		shouldTruncateChatBranch: Boolean(truncateMessageId),
		truncateMessageId,
	};
};

export const getInlineHostedNoteContext = ({ title, text }) => {
	const noteTitle = title?.trim() ?? "";
	const noteText = clampHostedNoteContext(text ?? "");

	if (!noteTitle && !noteText) {
		return "";
	}

	return [
		"The current note is attached below. Use it as the primary context for this chat.",
		noteTitle ? `Current note title: ${noteTitle}` : "",
		noteText
			? `Current note content:\n${noteText}`
			: "Current note content: (empty note)",
	]
		.filter(Boolean)
		.join("\n\n");
};

export const getStoredHostedNoteContext = (note) => {
	if (!note) {
		return "";
	}

	return [
		"The current note is attached below. Use it as the primary context for this chat.",
		`Current note title: ${note.title}`,
		note.searchableText
			? `Current note content:\n${clampHostedNoteContext(note.searchableText)}`
			: "Current note content: (empty note)",
	].join("\n\n");
};

export const buildHostedNotesContext = (notes) => {
	if (notes.length === 0) {
		return "";
	}

	return [
		"Attached notes are available below. Use them when they are relevant to the user's request.",
		...notes.map((note, index) =>
			[
				`Note ${index + 1}: ${note.title}`,
				note.searchableText || "(empty note)",
			].join("\n"),
		),
	].join("\n\n");
};

export const getHostedChatRecipeContext = (selectedRecipe) => {
	if (!selectedRecipe) {
		return "";
	}

	return [
		"A recipe is selected for this note chat.",
		"Treat the selected recipe as the active task framing for the conversation.",
		"Treat the attached note and any other provided note context as the source material to work from.",
		"If the user's request is ambiguous, interpret it through the selected recipe first.",
		"If the user explicitly asks for something else, follow the user's latest instruction instead.",
		"If there is not enough source material to complete the recipe well, ask a focused follow-up question.",
		`Selected recipe: ${selectedRecipe.name}`,
		`Recipe prompt:\n${selectedRecipe.prompt.trim()}`,
	].join("\n\n");
};

export const buildHostedChatRuntimePrompt = ({
	automationInstruction = "",
	attachedNoteContext = "",
	coreToolInstruction = "",
	localFolderContext = "",
	notesContext = "",
	recipeContext = "",
	selectedAppSourceInstructions = "",
	userProfileContext,
	webSearchEnabled = false,
}) =>
	`${buildChatSystemPrompt({
		notesContext,
		attachedNoteContext,
		recipeContext,
		userProfileContext: userProfileContext ?? undefined,
		webSearchEnabled,
	})}${coreToolInstruction ? `\n\n${coreToolInstruction}` : ""}${
		automationInstruction ? `\n\n${automationInstruction}` : ""
	}${localFolderContext ? `\n\n${localFolderContext}` : ""}${
		selectedAppSourceInstructions ? `\n\n${selectedAppSourceInstructions}` : ""
	}${
		localFolderContext
			? "\n\nLocal folder priority: if the user's request is about a local path, shared folder, local file, local text transcript file, screenshot, or image, use the local folder tools first and do not use connected app tools unless the user explicitly asks for connected app data."
			: ""
	}\n\nTool recovery policy: when a tool call fails, returns an unavailable result, or does not provide enough information, inspect the error and continue with another relevant available tool or source if that can still satisfy the request. Do not repeat the same failing tool call with the same arguments. If no reliable path remains, explain the specific blocker and the next action needed.`;

export const generateHostedChatTitle = async ({
	assistantMessage,
	userMessage,
}) => {
	const userText = getHostedChatMessageText(userMessage);
	const assistantText = assistantMessage
		? getHostedChatMessageText(assistantMessage)
		: "";

	if (!userText) {
		return "Quick chat";
	}

	try {
		const { text } = await generateText({
			model: openai(CHAT_TITLE_MODEL_ID),
			system: CHAT_TITLE_SYSTEM_PROMPT,
			prompt: buildChatTitlePrompt({
				userText,
				assistantText,
			}),
		});

		return finalizeGeneratedChatTitle({
			generatedTitle: text,
			userText,
			maxLength: MAX_CHAT_TITLE_LENGTH,
		});
	} catch (error) {
		aiLogger.error({
			event: "chat_title.generate_failed",
			error: serializeError(error),
			model: CHAT_TITLE_MODEL_ID,
		});
		return deriveFallbackChatTitle({
			userText,
			maxLength: MAX_CHAT_TITLE_LENGTH,
		});
	}
};
