import {
	createEmptyLiveTranscriptState,
	createLiveTranscriptEntries,
	createTranscriptBlocksText,
	createTranscriptDisplayEntries,
	createTranscriptExportText,
	type LiveTranscriptState,
	type TranscriptUtterance,
} from "@/lib/transcript";
import { createTranscriptText } from "@/lib/transcript-session";

type StoredTranscriptSession = {
	finalTranscript: string;
	utterances: TranscriptUtterance[];
};

type StoredTranscriptSummary = {
	finalTranscript: string;
};

export const sortTranscriptUtterances = (
	utterances: TranscriptUtterance[],
): TranscriptUtterance[] =>
	utterances.slice().sort((left, right) => {
		if (left.startedAt !== right.startedAt) {
			return left.startedAt - right.startedAt;
		}

		if (left.endedAt !== right.endedAt) {
			return left.endedAt - right.endedAt;
		}

		return left.id.localeCompare(right.id);
	});

export const createStoredTranscriptText = ({
	session,
	summary,
}: {
	session: StoredTranscriptSession | null | undefined;
	summary: StoredTranscriptSummary | null | undefined;
}) =>
	session
		? createTranscriptText(session.utterances) || session.finalTranscript
		: (summary?.finalTranscript ?? "");

export const createVisibleTranscriptView = ({
	currentNoteLatestTranscriptSession,
	isViewingCaptureScope,
	listeningStartedAt,
	liveTranscript,
	orderedTranscriptUtterances,
}: {
	currentNoteLatestTranscriptSession:
		| StoredTranscriptSession
		| null
		| undefined;
	isViewingCaptureScope: boolean;
	listeningStartedAt: number | null;
	liveTranscript: LiveTranscriptState;
	orderedTranscriptUtterances: TranscriptUtterance[];
}) => {
	const visibleOrderedTranscriptUtterances = isViewingCaptureScope
		? orderedTranscriptUtterances
		: (currentNoteLatestTranscriptSession?.utterances ?? []);
	const visibleLiveTranscript = isViewingCaptureScope
		? liveTranscript
		: createEmptyLiveTranscriptState();
	const visibleLiveTranscriptEntries = createLiveTranscriptEntries(
		visibleLiveTranscript,
	);
	const visibleDisplayTranscriptEntries = createTranscriptDisplayEntries({
		liveTranscript: visibleLiveTranscript,
		utterances: visibleOrderedTranscriptUtterances,
	});
	const committedStartedAt =
		visibleOrderedTranscriptUtterances[0]?.startedAt ?? null;
	const liveStartedAt = visibleLiveTranscriptEntries.reduce<number | null>(
		(currentValue, entry) => {
			if (entry.startedAt == null) {
				return currentValue;
			}

			return currentValue == null
				? entry.startedAt
				: Math.min(currentValue, entry.startedAt);
		},
		null,
	);
	const visibleTranscriptStartedAt =
		committedStartedAt ??
		liveStartedAt ??
		(isViewingCaptureScope ? listeningStartedAt : null) ??
		null;

	return {
		visibleDisplayTranscriptEntries,
		visibleExportTranscript: createTranscriptExportText({
			entries: visibleDisplayTranscriptEntries,
			startedAt: visibleTranscriptStartedAt,
		}),
		visibleFullTranscript: createTranscriptBlocksText(
			visibleDisplayTranscriptEntries,
		),
		visibleLiveTranscript,
		visibleLiveTranscriptEntries,
		visibleOrderedTranscriptUtterances,
		visibleTranscriptStartedAt,
	};
};
