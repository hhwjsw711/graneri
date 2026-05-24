const STORAGE_PREFIX = "opengran:composer-draft:";
const STORAGE_VERSION = 1;

type StoredComposerDraft<TMetadata> = {
	version: typeof STORAGE_VERSION;
	scopeKey: string;
	text: string;
	metadata: TMetadata | null;
	updatedAt: number;
};

const getStorageKey = (scopeKey: string) => `${STORAGE_PREFIX}${scopeKey}`;

export const getChatComposerDraftScope = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: string;
}) => `chat:${workspaceId}:${chatId}`;

export const getNoteComposerDraftScope = (noteId: string) =>
	`note-chat:note:${noteId}`;

export const loadComposerDraft = <TMetadata>(
	scopeKey: string,
): { text: string; metadata: TMetadata | null } | null => {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(getStorageKey(scopeKey));
		if (!rawValue) {
			return null;
		}

		const draft = JSON.parse(rawValue) as Partial<
			StoredComposerDraft<TMetadata>
		>;
		if (
			draft.version !== STORAGE_VERSION ||
			draft.scopeKey !== scopeKey ||
			typeof draft.text !== "string"
		) {
			return null;
		}

		return {
			text: draft.text,
			metadata: draft.metadata ?? null,
		};
	} catch {
		return null;
	}
};

export const storeComposerDraft = <TMetadata>(
	scopeKey: string,
	text: string,
	metadata: TMetadata | null = null,
) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const trimmedText = text.trim();
		if (!trimmedText && metadata === null) {
			window.localStorage.removeItem(getStorageKey(scopeKey));
			return;
		}

		const draft: StoredComposerDraft<TMetadata> = {
			version: STORAGE_VERSION,
			scopeKey,
			text,
			metadata,
			updatedAt: Date.now(),
		};
		window.localStorage.setItem(getStorageKey(scopeKey), JSON.stringify(draft));
	} catch {
		// Draft persistence is best-effort; losing localStorage must not block chat.
	}
};

export const clearComposerDraft = (scopeKey: string) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.removeItem(getStorageKey(scopeKey));
	} catch {
		// Draft persistence is best-effort; losing localStorage must not block chat.
	}
};
