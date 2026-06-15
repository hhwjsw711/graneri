import type { ReasoningEffort } from "@/components/chat/model-picker";
import { DEFAULT_REASONING_EFFORT, findReasoningEffort } from "@/lib/ai/models";

const REASONING_EFFORT_STORAGE_KEY = "graneri:chat-reasoning-effort";
const CHAT_REASONING_EFFORT_STORAGE_KEY_PREFIX =
	"graneri:chat-reasoning-effort:";

const getChatReasoningEffortStorageKey = (chatId: string) => {
	const normalizedChatId = chatId.trim();

	if (!normalizedChatId) {
		return null;
	}

	return `${CHAT_REASONING_EFFORT_STORAGE_KEY_PREFIX}${normalizedChatId}`;
};

export const getStoredReasoningEffort = (): ReasoningEffort => {
	if (typeof window === "undefined") {
		return DEFAULT_REASONING_EFFORT;
	}

	return (
		findReasoningEffort(
			window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY),
		)?.id ?? DEFAULT_REASONING_EFFORT
	);
};

export const storeReasoningEffort = (value: ReasoningEffort) => {
	window.localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, value);
};

export const getStoredChatReasoningEffort = (
	chatId: string,
): ReasoningEffort | null => {
	if (typeof window === "undefined") {
		return null;
	}

	const storageKey = getChatReasoningEffortStorageKey(chatId);

	if (!storageKey) {
		return null;
	}

	return (
		findReasoningEffort(window.localStorage.getItem(storageKey))?.id ?? null
	);
};

export const storeChatReasoningEffort = (
	chatId: string,
	value: ReasoningEffort,
) => {
	const storageKey = getChatReasoningEffortStorageKey(chatId);

	if (!storageKey) {
		return;
	}

	window.localStorage.setItem(storageKey, value);
};
