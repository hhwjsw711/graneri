"use client";

export const INBOX_PANEL_STORAGE_KEY_DESKTOP =
	"graneri.inbox-panel-width.desktop";
export const INBOX_PANEL_STORAGE_KEY_MOBILE =
	"graneri.inbox-panel-width.mobile";
export const INBOX_PANEL_PINNED_STORAGE_KEY =
	"graneri.inbox-panel-pinned.desktop";

export const readDesktopInboxPanelPinnedState = () => {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		return (
			window.localStorage.getItem(INBOX_PANEL_PINNED_STORAGE_KEY) === "true"
		);
	} catch {
		return false;
	}
};
