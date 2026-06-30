import {
	compareTranscriptUtteranceOrder,
	createTranscriptBlocksText as createSharedTranscriptBlocksText,
	createTranscriptTextSections,
} from "../../../../packages/ai/src/transcription.mjs";

type TranscriptLiveSpeaker = "you" | "them";
export type TranscriptSpeaker = TranscriptLiveSpeaker;

type SystemAudioCaptureState = "unsupported" | "ready" | "connected";
export type SystemAudioCaptureSourceMode =
	| "desktop-native"
	| "display-media"
	| "unsupported";

export type SystemAudioCaptureStatus = {
	state: SystemAudioCaptureState;
	sourceMode: SystemAudioCaptureSourceMode;
};

type TranscriptRecoveryState = "idle" | "reconnecting" | "failed";

export type TranscriptRecoveryStatus = {
	state: TranscriptRecoveryState;
	attempt: number;
	maxAttempts: number;
	message: string | null;
};

export type TranscriptUtterance = {
	id: string;
	speaker: TranscriptSpeaker;
	text: string;
	startedAt: number;
	endedAt: number;
};

type TranscriptDisplayEntry = {
	committedText?: string;
	id: string;
	isLive: boolean;
	isProvisional: boolean;
	liveText?: string;
	speaker: TranscriptSpeaker;
	startedAt: number;
	endedAt: number;
	text: string;
	utteranceIds: string[];
};

type LiveTranscriptEntry = {
	speaker: TranscriptLiveSpeaker;
	startedAt: number | null;
	text: string;
};

export type LiveTranscriptState = Record<
	TranscriptLiveSpeaker,
	LiveTranscriptEntry
>;

const STATIC_TRANSCRIPT_SPEAKER_LABELS: Record<TranscriptLiveSpeaker, string> =
	{
		you: "You",
		them: "Them",
	};

export const createSystemAudioCaptureStatus = (
	overrides: Partial<SystemAudioCaptureStatus> = {},
): SystemAudioCaptureStatus => ({
	state: "unsupported",
	sourceMode: "unsupported",
	...overrides,
});

export const createTranscriptRecoveryStatus = (
	overrides: Partial<TranscriptRecoveryStatus> = {},
): TranscriptRecoveryStatus => ({
	state: "idle",
	attempt: 0,
	maxAttempts: 0,
	message: null,
	...overrides,
});

export const createEmptyLiveTranscriptState = (): LiveTranscriptState => ({
	you: {
		speaker: "you",
		startedAt: null,
		text: "",
	},
	them: {
		speaker: "them",
		startedAt: null,
		text: "",
	},
});

export const compareTranscriptUtterances = (
	left: TranscriptUtterance,
	right: TranscriptUtterance,
) => compareTranscriptUtteranceOrder(left, right);

const compareTranscriptDisplayEntries = (
	left: TranscriptDisplayEntry,
	right: TranscriptDisplayEntry,
) => {
	if (left.startedAt !== right.startedAt) {
		return left.startedAt - right.startedAt;
	}

	if (left.endedAt !== right.endedAt) {
		return left.endedAt - right.endedAt;
	}

	return left.id.localeCompare(right.id);
};

const transcriptDateFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
});

const appendTranscriptText = (baseText: string, appendedText: string) => {
	const normalizedBaseText = baseText.trim();
	const normalizedAppendedText = appendedText.trim();

	if (!normalizedBaseText) {
		return normalizedAppendedText;
	}

	if (!normalizedAppendedText) {
		return normalizedBaseText;
	}

	return `${normalizedBaseText} ${normalizedAppendedText}`;
};

const formatTranscriptDate = (timestamp: number) =>
	transcriptDateFormatter.format(new Date(timestamp));

export const formatTranscriptElapsed = (elapsedMs: number) => {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const createTranscriptBlocksText = (
	entries: Array<Pick<TranscriptDisplayEntry, "speaker" | "text">>,
) =>
	createSharedTranscriptBlocksText(entries, {
		speakerLabels: STATIC_TRANSCRIPT_SPEAKER_LABELS,
	});

export const createTranscriptExportText = ({
	entries,
	startedAt,
}: {
	entries: Array<Pick<TranscriptDisplayEntry, "speaker" | "text">>;
	startedAt?: number | null;
}) => {
	const body = createTranscriptBlocksText(entries);

	if (!body) {
		return "";
	}

	if (startedAt == null) {
		return body;
	}

	return `Date: ${formatTranscriptDate(startedAt)}\n\nTranscript:\n\n${body}`;
};

export const createLiveTranscriptEntries = (
	liveTranscript: LiveTranscriptState,
): TranscriptDisplayEntry[] =>
	Object.values(liveTranscript)
		.filter((entry) => entry.text.trim())
		.sort((left, right) => {
			const leftStartedAt = left.startedAt ?? Number.MAX_SAFE_INTEGER;
			const rightStartedAt = right.startedAt ?? Number.MAX_SAFE_INTEGER;

			if (leftStartedAt !== rightStartedAt) {
				return leftStartedAt - rightStartedAt;
			}

			return left.speaker.localeCompare(right.speaker);
		})
		.map((entry) => {
			const startedAt = entry.startedAt ?? Date.now();

			return {
				endedAt: startedAt,
				id: `live:${entry.speaker}:${startedAt}`,
				isLive: true,
				isProvisional: true,
				speaker: entry.speaker,
				startedAt,
				text: entry.text.trim(),
				utteranceIds: [],
			};
		});

export const createTranscriptDisplayEntries = ({
	liveTranscript,
	utterances,
}: {
	liveTranscript: LiveTranscriptState;
	utterances: TranscriptUtterance[];
}): TranscriptDisplayEntry[] => {
	const committedEntries: TranscriptDisplayEntry[] =
		createTranscriptTextSections(utterances).map((section) => ({
			endedAt: section.endedAt,
			id: section.id,
			isLive: false,
			isProvisional: false,
			speaker: section.speaker as TranscriptSpeaker,
			startedAt: section.startedAt,
			text: section.text,
			utteranceIds: section.utteranceIds,
		}));
	const displayEntries = committedEntries.sort(compareTranscriptDisplayEntries);

	for (const liveEntry of createLiveTranscriptEntries(liveTranscript)) {
		const previousEntry = displayEntries.findLast(
			(entry) => entry.startedAt <= liveEntry.startedAt,
		);

		if (
			previousEntry &&
			previousEntry.speaker === liveEntry.speaker &&
			!previousEntry.isLive
		) {
			previousEntry.endedAt = liveEntry.startedAt;
			previousEntry.isLive = true;
			previousEntry.isProvisional = true;
			previousEntry.committedText = previousEntry.text;
			previousEntry.liveText = liveEntry.text;
			previousEntry.text = appendTranscriptText(
				previousEntry.text,
				liveEntry.text,
			);
			continue;
		}

		displayEntries.push(liveEntry);
	}

	return displayEntries.sort(compareTranscriptDisplayEntries);
};
