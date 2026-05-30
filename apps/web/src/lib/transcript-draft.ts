import { getDesktopBridge } from "@workspace/platform/desktop";
import {
	createEmptyLiveTranscriptState,
	type LiveTranscriptState,
	type TranscriptUtterance,
} from "@/lib/transcript";

const STORAGE_PREFIX = "graneri:transcript-draft:";
const STORAGE_VERSION = 1;
const MAX_DRAFT_AGE_MS = 72 * 60 * 60 * 1000;

type StoredTranscriptDraft = {
	version: number;
	noteKey: string;
	updatedAt: number;
	utterances: TranscriptUtterance[];
	liveTranscript: LiveTranscriptState;
	pendingGenerateTranscript: string;
};

type TranscriptDraftPayload = {
	liveTranscript: LiveTranscriptState;
	noteKey: string;
	pendingGenerateTranscript: string;
	utterances: TranscriptUtterance[];
};

const getStorageKey = (noteKey: string) => `${STORAGE_PREFIX}${noteKey}`;

const canUseBrowserStorage = () => typeof window !== "undefined";

const getDesktopDraftStore = () => {
	const desktopBridge = getDesktopBridge();

	if (
		!desktopBridge?.loadTranscriptDraft ||
		!desktopBridge?.saveTranscriptDraft ||
		!desktopBridge?.clearTranscriptDraft
	) {
		return null;
	}

	return desktopBridge;
};

const isFreshDraft = (updatedAt: number) =>
	Date.now() - updatedAt <= MAX_DRAFT_AGE_MS;

const finalizeLiveTranscriptEntries = (
	liveTranscript: LiveTranscriptState,
): TranscriptUtterance[] =>
	Object.values(liveTranscript).flatMap((entry) => {
		const text = entry.text.trim();
		if (!text) {
			return [];
		}

		const startedAt = entry.startedAt ?? Date.now();

		return [
			{
				id: `recovered-live:${entry.speaker}:${startedAt}:${crypto.randomUUID()}`,
				speaker: entry.speaker,
				text,
				startedAt,
				endedAt: startedAt,
			},
		];
	});

const normalizeDraft = (
	noteKey: string,
	draft: StoredTranscriptDraft | null,
) => {
	if (
		!draft ||
		draft.version !== STORAGE_VERSION ||
		draft.noteKey !== noteKey ||
		typeof draft.updatedAt !== "number" ||
		!isFreshDraft(draft.updatedAt)
	) {
		return null;
	}

	const recoveredUtterances = [
		...(Array.isArray(draft.utterances) ? draft.utterances : []),
		...finalizeLiveTranscriptEntries(
			draft.liveTranscript ?? createEmptyLiveTranscriptState(),
		),
	];

	return {
		updatedAt: draft.updatedAt,
		pendingGenerateTranscript:
			typeof draft.pendingGenerateTranscript === "string"
				? draft.pendingGenerateTranscript
				: "",
		utterances: recoveredUtterances,
	};
};

const pruneBrowserTranscriptDrafts = () => {
	if (!canUseBrowserStorage()) {
		return;
	}

	for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
		const { removeItem } = window.localStorage;
		const key = window.localStorage.key(index);

		if (!key?.startsWith(STORAGE_PREFIX)) {
			continue;
		}

		try {
			const rawValue = window.localStorage.getItem(key);
			if (!rawValue) {
				removeItem.call(window.localStorage, key);
				continue;
			}

			const parsed = JSON.parse(rawValue) as StoredTranscriptDraft;
			if (
				parsed.version !== STORAGE_VERSION ||
				typeof parsed.updatedAt !== "number" ||
				!isFreshDraft(parsed.updatedAt)
			) {
				removeItem.call(window.localStorage, key);
			}
		} catch {
			removeItem.call(window.localStorage, key);
		}
	}
};

const loadBrowserTranscriptDraft = (noteKey: string) => {
	if (!canUseBrowserStorage()) {
		return null;
	}

	pruneBrowserTranscriptDrafts();
	const rawValue = window.localStorage.getItem(getStorageKey(noteKey));

	if (!rawValue) {
		return null;
	}

	try {
		return normalizeDraft(
			noteKey,
			JSON.parse(rawValue) as StoredTranscriptDraft,
		);
	} catch {
		window.localStorage.removeItem(getStorageKey(noteKey));
		return null;
	}
};

export const loadTranscriptDraft = async (noteKey: string) => {
	const desktopDraftStore = getDesktopDraftStore();

	if (desktopDraftStore) {
		const payload = await desktopDraftStore.loadTranscriptDraft(noteKey);
		return normalizeDraft(noteKey, payload.draft);
	}

	return loadBrowserTranscriptDraft(noteKey);
};

export const saveTranscriptDraft = async ({
	liveTranscript,
	noteKey,
	pendingGenerateTranscript,
	utterances,
}: TranscriptDraftPayload) => {
	const hasTranscript =
		utterances.length > 0 ||
		Object.values(liveTranscript).some((entry) => entry.text.trim()) ||
		Boolean(pendingGenerateTranscript.trim());

	if (!hasTranscript) {
		await clearTranscriptDraft(noteKey);
		return;
	}

	const payload: StoredTranscriptDraft = {
		version: STORAGE_VERSION,
		noteKey,
		updatedAt: Date.now(),
		utterances,
		liveTranscript,
		pendingGenerateTranscript,
	};

	const desktopDraftStore = getDesktopDraftStore();

	if (desktopDraftStore) {
		await desktopDraftStore.saveTranscriptDraft(noteKey, {
			utterances: payload.utterances,
			liveTranscript: payload.liveTranscript,
			pendingGenerateTranscript: payload.pendingGenerateTranscript,
		});
		return;
	}

	if (!canUseBrowserStorage()) {
		return;
	}

	window.localStorage.setItem(getStorageKey(noteKey), JSON.stringify(payload));
};

export const clearTranscriptDraft = async (noteKey: string) => {
	const desktopDraftStore = getDesktopDraftStore();

	if (desktopDraftStore) {
		await desktopDraftStore.clearTranscriptDraft(noteKey);
		return;
	}

	if (!canUseBrowserStorage()) {
		return;
	}

	window.localStorage.removeItem(getStorageKey(noteKey));
};
