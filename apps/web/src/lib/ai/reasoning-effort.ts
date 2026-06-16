import {
	DEFAULT_REASONING_EFFORT,
	findReasoningEffort,
	type reasoningEfforts,
} from "@/lib/ai/models";

export type ReasoningEffort = (typeof reasoningEfforts)[number]["id"];

type ResolveReasoningEffortPreferenceArgs = {
	persistedChatReasoningEffort?: ReasoningEffort | null;
	chatReasoningEffortOverride?: ReasoningEffort | null;
	globalReasoningEffortOverride?: ReasoningEffort | null;
	userPreferenceReasoningEffort?: ReasoningEffort | null;
	fallbackReasoningEffort: ReasoningEffort;
};

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

	return getStoredReasoningEffortOverride() ?? DEFAULT_REASONING_EFFORT;
};

export const getStoredReasoningEffortOverride = (): ReasoningEffort | null => {
	if (typeof window === "undefined") {
		return null;
	}

	return (
		findReasoningEffort(
			window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY),
		)?.id ?? null
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

export const resolveReasoningEffortPreference = ({
	persistedChatReasoningEffort,
	chatReasoningEffortOverride,
	globalReasoningEffortOverride,
	userPreferenceReasoningEffort,
	fallbackReasoningEffort,
}: ResolveReasoningEffortPreferenceArgs): ReasoningEffort =>
	persistedChatReasoningEffort ??
	chatReasoningEffortOverride ??
	globalReasoningEffortOverride ??
	userPreferenceReasoningEffort ??
	fallbackReasoningEffort;
