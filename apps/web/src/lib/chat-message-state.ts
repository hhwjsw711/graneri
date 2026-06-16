import type { UIMessage } from "ai";

const getMessageText = (message: UIMessage) =>
	message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

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
