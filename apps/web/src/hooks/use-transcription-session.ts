import { useSyncExternalStore } from "react";
import { transcriptionSessionManager } from "@/lib/transcription-session-manager";
import type { TranscriptionControllerState } from "@/lib/transcription-session-types";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useTranscriptionSession = (): TranscriptionControllerState =>
	useSyncExternalStore(
		transcriptionSessionManager.store.subscribe,
		transcriptionSessionManager.store.getSnapshot,
		transcriptionSessionManager.store.getSnapshot,
	);

const getRecordingNoteId = (
	transcriptionSession: Pick<
		TranscriptionControllerState,
		"isListening" | "scopeKey"
	>,
): Id<"notes"> | null => {
	if (!transcriptionSession.isListening) {
		return null;
	}

	const scopeKey = transcriptionSession.scopeKey;
	if (!scopeKey?.startsWith("note:")) {
		return null;
	}

	const scopedNoteId = scopeKey.slice("note:".length);
	if (!scopedNoteId || scopedNoteId === "draft") {
		return null;
	}

	return scopedNoteId as Id<"notes">;
};

export const useRecordingNoteId = (): Id<"notes"> | null => {
	const transcriptionSession = useTranscriptionSession();

	return getRecordingNoteId(transcriptionSession);
};
