import { getDesktopBridge } from "@workspace/platform/desktop";
import type { Id } from "../../../../convex/_generated/dataModel";

const STORAGE_PREFIX = "graneri:note-draft:";
const STORAGE_VERSION = 1;

export type NoteDraftPayload = {
	title: string;
	content: string;
	searchableText: string;
};

type StoredNoteDraft = NoteDraftPayload & {
	version: typeof STORAGE_VERSION;
	workspaceId: Id<"workspaces">;
	noteId: Id<"notes">;
	updatedAt: number;
};

const getStorageKey = (noteId: Id<"notes">) => `${STORAGE_PREFIX}${noteId}`;

const getDesktopNoteDraftStore = () => {
	const desktopBridge = getDesktopBridge();

	if (
		!desktopBridge?.loadNoteDraft ||
		!desktopBridge?.saveNoteDraft ||
		!desktopBridge?.clearNoteDraft
	) {
		return null;
	}

	return desktopBridge;
};

export const loadNoteDraft = async ({
	noteId,
	workspaceId,
}: {
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
}) => {
	const desktopDraftStore = getDesktopNoteDraftStore();

	if (desktopDraftStore) {
		const payload = await desktopDraftStore.loadNoteDraft(noteId);
		const draft = payload.draft as Partial<StoredNoteDraft> | null;

		if (
			!draft ||
			draft.version !== STORAGE_VERSION ||
			draft.noteId !== noteId ||
			draft.workspaceId !== workspaceId ||
			typeof draft.updatedAt !== "number" ||
			typeof draft.title !== "string" ||
			typeof draft.content !== "string" ||
			typeof draft.searchableText !== "string"
		) {
			return null;
		}

		return draft as StoredNoteDraft;
	}

	try {
		const rawValue = window.localStorage.getItem(getStorageKey(noteId));

		if (!rawValue) {
			return null;
		}

		const draft = JSON.parse(rawValue) as Partial<StoredNoteDraft>;

		if (
			draft.version !== STORAGE_VERSION ||
			draft.noteId !== noteId ||
			draft.workspaceId !== workspaceId ||
			typeof draft.updatedAt !== "number" ||
			typeof draft.title !== "string" ||
			typeof draft.content !== "string" ||
			typeof draft.searchableText !== "string"
		) {
			return null;
		}

		return draft as StoredNoteDraft;
	} catch {
		return null;
	}
};

export const saveNoteDraft = async ({
	noteId,
	workspaceId,
	payload,
}: {
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
	payload: NoteDraftPayload;
}) => {
	const desktopDraftStore = getDesktopNoteDraftStore();

	if (desktopDraftStore) {
		await desktopDraftStore.saveNoteDraft(noteId, {
			workspaceId,
			title: payload.title,
			content: payload.content,
			searchableText: payload.searchableText,
		});
		return;
	}

	try {
		window.localStorage.setItem(
			getStorageKey(noteId),
			JSON.stringify({
				version: STORAGE_VERSION,
				workspaceId,
				noteId,
				updatedAt: Date.now(),
				...payload,
			} satisfies StoredNoteDraft),
		);
	} catch {
		// Local draft persistence is best-effort; Convex autosave remains primary.
	}
};

export const removeNoteDraft = async (noteId: Id<"notes">) => {
	const desktopDraftStore = getDesktopNoteDraftStore();

	if (desktopDraftStore) {
		await desktopDraftStore.clearNoteDraft(noteId);
		return;
	}

	try {
		window.localStorage.removeItem(getStorageKey(noteId));
	} catch {
		// Ignore storage failures.
	}
};
