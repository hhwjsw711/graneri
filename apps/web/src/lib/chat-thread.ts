import type { UIMessage } from "ai";

const getMessageIndex = (messages: UIMessage[], messageId: string) =>
	messages.findIndex((message) => message.id === messageId);

export const getMessagesBefore = (messages: UIMessage[], messageId: string) => {
	const targetIndex = getMessageIndex(messages, messageId);

	return targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
};

export const applyPendingMessageTruncation = (
	messages: UIMessage[],
	messageId: string | null,
) => (messageId ? getMessagesBefore(messages, messageId) : messages);
