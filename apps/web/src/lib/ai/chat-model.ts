import type { chatModels } from "@/lib/ai/models";
import { defaultChatModel, findChatModel } from "@/lib/ai/models";

type ChatModel = (typeof chatModels)[number];

const CHAT_MODEL_STORAGE_KEY = "graneri:chat-model";

export const getStoredChatModel = (): ChatModel => {
	if (typeof window === "undefined") {
		return defaultChatModel;
	}

	return (
		findChatModel(window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)) ??
		defaultChatModel
	);
};

export const storeChatModel = (value: ChatModel) => {
	window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, value.model);
};
