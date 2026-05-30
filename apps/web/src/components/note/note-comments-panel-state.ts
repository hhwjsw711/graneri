"use client";

import type { Id } from "../../../../../convex/_generated/dataModel";

const COMMENTS_PANEL_PINNED_STORAGE_KEY_PREFIX =
	"graneri.note-comments-panel-pinned.desktop";

const getNoteCommentsPanelScopeKey = (noteId: Id<"notes"> | null) =>
	noteId ? `note:${noteId}` : "note:draft";

export const getDesktopCommentsPanelPinnedStorageKey = (
	noteId: Id<"notes"> | null,
) =>
	`${COMMENTS_PANEL_PINNED_STORAGE_KEY_PREFIX}.${getNoteCommentsPanelScopeKey(noteId)}`;

export const readDesktopCommentsPanelPinnedState = (
	noteId: Id<"notes"> | null,
) => {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		return (
			window.localStorage.getItem(
				getDesktopCommentsPanelPinnedStorageKey(noteId),
			) === "true"
		);
	} catch {
		return false;
	}
};
