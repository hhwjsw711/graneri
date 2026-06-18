export type NoteChatPanelPlatform = "desktop" | "mobile";

export const NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX =
	"graneri.noteComposer.floatingHeight";
export const NOTE_CHAT_FLOATING_DEFAULT_HEIGHT = 512;
export const NOTE_CHAT_PANEL_MIN_HEIGHT = 320;
export const NOTE_CHAT_PANEL_MAX_HEIGHT = 680;
export const NOTE_CHAT_OVERLAY_VIEWPORT_INSET = 112;
export const INLINE_POPOVER_DEFAULT_HEIGHT = 384;
export const INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX =
	"graneri.noteComposer.inlinePopoverHeight";
export const INLINE_POPOVER_HEIGHT_LEGACY_STORAGE_KEY =
	"graneri.noteComposer.inlinePopoverHeight";
export const NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX =
	"graneri.noteComposer.sidebarWidth";

export const getNoteStorageScopeKey = (noteId: string | null) =>
	noteId ? `note:${noteId}` : "note:draft";

export const getNoteScopedStorageKey = ({
	noteScopeKey,
	platform,
	prefix,
}: {
	prefix: string;
	noteScopeKey: string;
	platform: NoteChatPanelPlatform;
}) => `${prefix}.${noteScopeKey}.${platform}`;

export const getNoteScopedStorageKeyForViewport = ({
	isMobileViewport,
	noteScopeKey,
	prefix,
}: {
	prefix: string;
	noteScopeKey: string;
	isMobileViewport: boolean;
}) =>
	getNoteScopedStorageKey({
		prefix,
		noteScopeKey,
		platform: isMobileViewport ? "mobile" : "desktop",
	});

export const isMobilePanelViewport = ({ innerWidth }: { innerWidth: number }) =>
	innerWidth < 768;

export const getCurrentPanelViewportPlatform = (): NoteChatPanelPlatform =>
	typeof window !== "undefined" &&
	isMobilePanelViewport({ innerWidth: window.innerWidth })
		? "mobile"
		: "desktop";

export const getPanelMaxHeight = ({
	innerHeight,
}: {
	innerHeight?: number;
}) => {
	if (innerHeight === undefined) {
		return NOTE_CHAT_PANEL_MAX_HEIGHT;
	}

	return Math.max(
		NOTE_CHAT_PANEL_MIN_HEIGHT,
		Math.min(
			NOTE_CHAT_PANEL_MAX_HEIGHT,
			innerHeight - NOTE_CHAT_OVERLAY_VIEWPORT_INSET,
		),
	);
};

export const getCurrentPanelMaxHeight = () =>
	getPanelMaxHeight({
		innerHeight: typeof window === "undefined" ? undefined : window.innerHeight,
	});

export const clampPanelHeight = ({
	maxHeight,
	nextHeight,
}: {
	nextHeight: number;
	maxHeight: number;
}) => Math.min(maxHeight, Math.max(NOTE_CHAT_PANEL_MIN_HEIGHT, nextHeight));

export const readStoredPanelHeight = (
	storageKeys: string | string[],
	fallback: number,
) => {
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const candidateKeys = Array.isArray(storageKeys)
			? storageKeys
			: [storageKeys];

		for (const storageKey of candidateKeys) {
			const storedValue = window.localStorage.getItem(storageKey);

			if (!storedValue) {
				continue;
			}

			const parsedValue = Number(storedValue);

			if (Number.isFinite(parsedValue)) {
				return parsedValue;
			}
		}

		return fallback;
	} catch {
		return fallback;
	}
};

export const storePanelHeight = (
	storageKeys: string | string[],
	height: number,
) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const candidateKeys = Array.isArray(storageKeys)
			? storageKeys
			: [storageKeys];

		for (const storageKey of candidateKeys) {
			window.localStorage.setItem(storageKey, String(height));
		}
	} catch {
		// Ignore storage failures and keep the in-memory size.
	}
};
