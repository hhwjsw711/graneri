import type { ReasoningEffort } from "@/components/chat/model-picker";
import { DEFAULT_REASONING_EFFORT, findReasoningEffort } from "@/lib/ai/models";

const REASONING_EFFORT_STORAGE_KEY = "graneri:chat-reasoning-effort";

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
