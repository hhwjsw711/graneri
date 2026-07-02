export const escapeChatMessageSelectorValue = (value: string) =>
	typeof CSS !== "undefined" && typeof CSS.escape === "function"
		? CSS.escape(value)
		: value.replace(/"/g, '\\"');

export const getChatMessageElement = (messageId: string) =>
	document.querySelector<HTMLElement>(
		`[data-chat-message-id="${escapeChatMessageSelectorValue(messageId)}"]`,
	);
