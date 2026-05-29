import * as React from "react";
import {
	type TranscriptSessionRepository,
	useTranscriptSessionRepository,
} from "@/hooks/use-transcript-session-repository";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";
import type { TranscriptionControllerState } from "@/lib/transcription-session-types";
import type { Id } from "../../../../convex/_generated/dataModel";

export const getScopedNoteId = (scopeKey: string): Id<"notes"> | null => {
	if (!scopeKey.startsWith("note:")) {
		return null;
	}

	const scopedNoteId = scopeKey.slice("note:".length);
	if (!scopedNoteId || scopedNoteId === "draft") {
		return null;
	}

	return scopedNoteId as Id<"notes">;
};

const getInitialCaptureScopeKey = ({
	noteId,
	isListening,
	scopeKey,
}: {
	noteId: Id<"notes"> | null;
	isListening: boolean;
	scopeKey: string | null;
}) => {
	if (isListening && scopeKey?.startsWith("note:")) {
		return scopeKey;
	}

	return noteId ? `note:${noteId}` : "note:draft";
};

type NoteTranscriptScope = {
	captureScopeKey: string;
	captureScopeNoteId: Id<"notes"> | null;
	captureTranscriptDraftKey: string;
	captureTranscriptSessionRepository: TranscriptSessionRepository;
	currentNoteScopeKey: string;
	currentNoteTranscriptSessionRepository: TranscriptSessionRepository;
	effectiveCurrentNoteTranscriptSessionRepository: TranscriptSessionRepository;
	isCurrentNoteSpeechListening: boolean;
	isScopedTranscriptionSession: boolean;
	isSpeechListening: boolean;
	isViewingCaptureScope: boolean;
	resolvedCaptureScopeKey: string;
	setCaptureScopeKey: React.Dispatch<React.SetStateAction<string>>;
	transcriptionSession: TranscriptionControllerState;
};

export const useNoteTranscriptScope = ({
	noteId,
	shouldLoadStoredTranscriptHistory,
}: {
	noteId: Id<"notes"> | null;
	shouldLoadStoredTranscriptHistory: boolean;
}): NoteTranscriptScope => {
	const transcriptionSession = useTranscriptionSession();
	const initialCaptureScopeKey = React.useMemo(
		() =>
			getInitialCaptureScopeKey({
				noteId,
				isListening: transcriptionSession.isListening,
				scopeKey: transcriptionSession.scopeKey,
			}),
		[noteId, transcriptionSession.isListening, transcriptionSession.scopeKey],
	);
	const resolvedCaptureScopeKey = noteId ? `note:${noteId}` : "note:draft";
	const [captureScopeKey, setCaptureScopeKey] = React.useState(
		initialCaptureScopeKey,
	);
	const captureScopeNoteId = React.useMemo(
		() => getScopedNoteId(captureScopeKey),
		[captureScopeKey],
	);
	const isScopedTranscriptionSession =
		transcriptionSession.isListening &&
		transcriptionSession.scopeKey === captureScopeKey;
	const isViewingCaptureScope = resolvedCaptureScopeKey === captureScopeKey;
	const reusesCaptureTranscriptSessionRepository =
		noteId !== null && noteId === captureScopeNoteId;
	const captureTranscriptSessionRepository = useTranscriptSessionRepository(
		captureScopeNoteId,
		{
			shouldAutoLoadLatestTranscriptSession:
				isScopedTranscriptionSession ||
				(isViewingCaptureScope && shouldLoadStoredTranscriptHistory),
		},
	);
	const currentNoteTranscriptSessionRepository = useTranscriptSessionRepository(
		reusesCaptureTranscriptSessionRepository ? null : noteId,
		{
			shouldAutoLoadLatestTranscriptSession:
				!reusesCaptureTranscriptSessionRepository &&
				!isViewingCaptureScope &&
				shouldLoadStoredTranscriptHistory,
		},
	);
	const isCurrentNoteTranscriptionSession =
		transcriptionSession.scopeKey === resolvedCaptureScopeKey;

	return {
		captureScopeKey,
		captureScopeNoteId,
		captureTranscriptDraftKey: captureScopeKey,
		captureTranscriptSessionRepository,
		currentNoteScopeKey: resolvedCaptureScopeKey,
		currentNoteTranscriptSessionRepository,
		effectiveCurrentNoteTranscriptSessionRepository:
			reusesCaptureTranscriptSessionRepository
				? captureTranscriptSessionRepository
				: currentNoteTranscriptSessionRepository,
		isCurrentNoteSpeechListening: isCurrentNoteTranscriptionSession
			? transcriptionSession.isListening
			: false,
		isScopedTranscriptionSession,
		isSpeechListening: isScopedTranscriptionSession
			? transcriptionSession.isListening
			: false,
		isViewingCaptureScope,
		resolvedCaptureScopeKey,
		setCaptureScopeKey,
		transcriptionSession,
	};
};
