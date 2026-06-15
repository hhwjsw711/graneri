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
	message,
	messageId,
	messages = [],
	storedMessages = [],
	trigger,
}) => {
	const editedMessageId = messageId ?? message?.id;
	const editedMessageIndex = editedMessageId
		? storedMessages.findIndex(
				(storedMessage) => storedMessage.id === editedMessageId,
			)
		: -1;
	const baseStoredMessages =
		editedMessageIndex >= 0
			? storedMessages.slice(0, editedMessageIndex)
			: storedMessages;
	const incomingMessages = message
		? [...fromHostedStoredMessages(baseStoredMessages), message]
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
			? "\n\nLocal folder priority: if the user's request is about a local path, shared folder, local file, local audio, local video, local transcript, or local recording, use the local folder tools first and do not use connected app tools unless the user explicitly asks for connected app data."
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
