import type { UIMessage } from "ai";
import { isGeneratedQueuedMessageId } from "@/lib/chat-queue";

const getMessageText = (message: UIMessage) =>
	message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

export const hasRenderableChatMessageText = (message: UIMessage | undefined) =>
	Boolean(message && getMessageText(message).length > 0);

export const createChatUserMessage = ({
	files,
	id,
	metadata,
	text,
}: {
	files: UIMessage["parts"];
	id: string;
	metadata?: UIMessage["metadata"];
	text: string;
}): UIMessage => ({
	id,
	role: "user",
	metadata,
	parts: [
		...files,
		...(text.trim().length > 0 ? [{ type: "text" as const, text }] : []),
	],
});

const getResumeOverlapAssistantMessage = (
	currentMessage: UIMessage,
	nextMessage: UIMessage,
) => {
	const currentText = getMessageText(currentMessage);
	const nextText = getMessageText(nextMessage);

	if (!currentText || !nextText) {
		return null;
	}

	if (nextText.startsWith(currentText)) {
		return nextMessage;
	}

	if (currentText.startsWith(nextText)) {
		return currentMessage;
	}

	return null;
};

export const normalizeChatMessages = (messages: UIMessage[]): UIMessage[] => {
	const latestMessageById = new Map<string, UIMessage>();

	for (const message of messages) {
		latestMessageById.set(message.id, message);
	}

	const dedupedMessages = [...latestMessageById.values()];
	const normalizedMessages: UIMessage[] = [];

	for (const message of dedupedMessages) {
		const previousMessage =
			normalizedMessages[normalizedMessages.length - 1] ?? null;

		if (previousMessage?.role === "assistant" && message.role === "assistant") {
			const overlappedMessage = getResumeOverlapAssistantMessage(
				previousMessage,
				message,
			);

			if (overlappedMessage) {
				normalizedMessages[normalizedMessages.length - 1] = overlappedMessage;
				continue;
			}
		}

		normalizedMessages.push(message);
	}

	if (
		latestMessageById.size === messages.length &&
		normalizedMessages.length === messages.length
	) {
		return messages;
	}

	return normalizedMessages;
};

export const mergePersistedChatMessagesWithController = ({
	activeAssistantMessage,
	activeAssistantMessageId,
	controllerMessages,
	persistedMessages,
}: {
	activeAssistantMessage?: UIMessage;
	activeAssistantMessageId?: string | null;
	controllerMessages: UIMessage[];
	persistedMessages: UIMessage[];
}) => {
	const persistedMessageIds = new Set<string>();
	const persistedUserText = new Set<string>();
	const baseMessages: UIMessage[] = [];
	const persistedQueuedMessagesAfterActive: UIMessage[] = [];

	for (const message of persistedMessages) {
		if (message.id === activeAssistantMessageId) {
			continue;
		}

		persistedMessageIds.add(message.id);
		if (message.role === "user") {
			persistedUserText.add(getMessageText(message));
		}
		if (
			activeAssistantMessage &&
			message.role === "user" &&
			isGeneratedQueuedMessageId(message.id)
		) {
			persistedQueuedMessagesAfterActive.push(message);
			continue;
		}
		baseMessages.push(message);
	}

	const controllerOnlyMessages = controllerMessages.filter(
		(message) =>
			message.id !== activeAssistantMessageId &&
			!persistedMessageIds.has(message.id) &&
			(message.role !== "user" ||
				!persistedUserText.has(getMessageText(message))),
	);
	const activeControllerMessageIndex = controllerMessages.findIndex(
		(message) => message.id === activeAssistantMessageId,
	);

	if (activeControllerMessageIndex >= 0) {
		const controllerMessageIdsBeforeActive = new Set(
			controllerMessages
				.slice(0, activeControllerMessageIndex)
				.map((message) => message.id),
		);
		const controllerOnlyMessagesBeforeActive = controllerOnlyMessages.filter(
			(message) => controllerMessageIdsBeforeActive.has(message.id),
		);
		const controllerOnlyMessagesAfterActive = controllerOnlyMessages.filter(
			(message) => !controllerMessageIdsBeforeActive.has(message.id),
		);

		return normalizeChatMessages([
			...baseMessages,
			...controllerOnlyMessagesBeforeActive,
			...(activeAssistantMessage ? [activeAssistantMessage] : []),
			...persistedQueuedMessagesAfterActive,
			...controllerOnlyMessagesAfterActive,
		]);
	}

	return normalizeChatMessages([
		...baseMessages,
		...controllerOnlyMessages,
		...(activeAssistantMessage ? [activeAssistantMessage] : []),
		...persistedQueuedMessagesAfterActive,
	]);
};

export const appendLocalOptimisticChatMessages = ({
	displayMessages,
	localOptimisticMessages,
	resolvedMessages = [],
}: {
	displayMessages: UIMessage[];
	localOptimisticMessages: UIMessage[];
	resolvedMessages?: UIMessage[];
}) => {
	if (localOptimisticMessages.length === 0) {
		return displayMessages;
	}

	const resolvedMessageIds = new Set(
		resolvedMessages.map((message) => message.id),
	);
	const unresolvedOptimisticMessages = localOptimisticMessages.filter(
		(message) => !resolvedMessageIds.has(message.id),
	);

	if (unresolvedOptimisticMessages.length === 0) {
		return displayMessages;
	}

	const unresolvedOptimisticMessageIds = new Set(
		unresolvedOptimisticMessages.map((message) => message.id),
	);

	return normalizeChatMessages([
		...displayMessages.filter(
			(message) => !unresolvedOptimisticMessageIds.has(message.id),
		),
		...unresolvedOptimisticMessages,
	]);
};
