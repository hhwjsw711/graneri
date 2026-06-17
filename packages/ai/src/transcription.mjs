export const REALTIME_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";
export const DICTATION_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
export const AUDIO_TRANSCRIPTION_SAMPLE_RATE = 24_000;
export const REALTIME_TRANSCRIPTION_DELAY = "high";

export const REALTIME_TRANSCRIPTION_INCLUDE_FIELDS = [
	"item.input_audio_transcription.logprobs",
];

const systemAudioSources = new Set([
	"systemaudio",
	"system-audio",
	"system_audio",
]);

const transcriptPlaceholderPatterns = new Set([
	"audio unclear",
	"background noise",
	"inaudible",
	"music",
	"noise",
	"silence",
	"unintelligible",
]);

const TRANSCRIPT_SECTION_GAP_MS = 6_000;
const TRANSCRIPT_SECTION_SOFT_WORD_LIMIT = 70;
const TRANSCRIPT_SECTION_HARD_WORD_LIMIT = 110;
const TRANSCRIPT_SECTION_HARD_CHAR_LIMIT = 720;
const TRANSCRIPT_SECTION_SENTENCE_MIN_WORDS = 32;
const TRANSCRIPT_SECTION_SENTENCE_END_PATTERN = /[.!?][)"'\]]*$/;

const DEFAULT_TRANSCRIPT_SPEAKER_LABELS = {
	them: "Them",
	you: "You",
};

const isSystemAudioSource = (source) => {
	const normalizedSource =
		typeof source === "string" ? source.trim().toLowerCase() : "";

	return systemAudioSources.has(normalizedSource);
};

export const normalizeTranscriptText = (value) =>
	typeof value === "string"
		? value
				.toLowerCase()
				.replace(/[^\p{L}\p{N}\s]+/gu, " ")
				.replace(/\s+/g, " ")
				.trim()
		: "";

export const getTranscriptWordCount = (value) =>
	normalizeTranscriptText(value).split(" ").filter(Boolean).length;

const getTranscriptDisplayWordCount = (value) =>
	typeof value === "string"
		? value.trim().split(/\s+/).filter(Boolean).length
		: 0;

const hasTranscriptSentenceEnding = (value) =>
	TRANSCRIPT_SECTION_SENTENCE_END_PATTERN.test(String(value ?? "").trim());

const getTranscriptUtteranceId = (utterance) => String(utterance.id);

const getTranscriptUtteranceText = (utterance) =>
	typeof utterance.text === "string" ? utterance.text.trim() : "";

export const compareTranscriptUtteranceOrder = (left, right) => {
	const leftStartedAt = Number(left.startedAt);
	const rightStartedAt = Number(right.startedAt);

	if (leftStartedAt !== rightStartedAt) {
		return leftStartedAt - rightStartedAt;
	}

	const leftEndedAt = Number(left.endedAt);
	const rightEndedAt = Number(right.endedAt);

	if (leftEndedAt !== rightEndedAt) {
		return leftEndedAt - rightEndedAt;
	}

	return getTranscriptUtteranceId(left).localeCompare(
		getTranscriptUtteranceId(right),
	);
};

const joinTranscriptSectionText = (currentText, nextText) => {
	const normalizedCurrentText = String(currentText ?? "").trim();
	const normalizedNextText = String(nextText ?? "").trim();

	if (!normalizedCurrentText) {
		return normalizedNextText;
	}

	if (!normalizedNextText) {
		return normalizedCurrentText;
	}

	return `${normalizedCurrentText} ${normalizedNextText}`;
};

const shouldAppendTranscriptUtteranceToSection = ({ section, utterance }) => {
	if (section.speaker !== utterance.speaker) {
		return false;
	}

	if (utterance.startedAt - section.endedAt > TRANSCRIPT_SECTION_GAP_MS) {
		return false;
	}

	const sectionWordCount = getTranscriptDisplayWordCount(section.text);

	if (
		section.text.length >= TRANSCRIPT_SECTION_HARD_CHAR_LIMIT ||
		sectionWordCount >= TRANSCRIPT_SECTION_HARD_WORD_LIMIT
	) {
		return false;
	}

	if (
		sectionWordCount >= TRANSCRIPT_SECTION_SENTENCE_MIN_WORDS &&
		hasTranscriptSentenceEnding(section.text)
	) {
		return false;
	}

	const nextWordCount = getTranscriptDisplayWordCount(utterance.text);

	return sectionWordCount + nextWordCount <= TRANSCRIPT_SECTION_SOFT_WORD_LIMIT;
};

const getTranscriptSpeakerLabel = (speaker, speakerLabels) => {
	const normalizedSpeaker = String(speaker ?? "").trim();
	const configuredLabel = speakerLabels?.[normalizedSpeaker];

	if (typeof configuredLabel === "string" && configuredLabel.trim()) {
		return configuredLabel.trim();
	}

	if (!normalizedSpeaker) {
		return "Speaker";
	}

	return `${normalizedSpeaker.charAt(0).toUpperCase()}${normalizedSpeaker.slice(1)}`;
};

export const createTranscriptTextSections = (utterances = []) => {
	const sections = [];

	for (const rawUtterance of [...utterances].sort(
		compareTranscriptUtteranceOrder,
	)) {
		const text = getTranscriptUtteranceText(rawUtterance);

		if (!text) {
			continue;
		}

		const utteranceId = getTranscriptUtteranceId(rawUtterance);
		const utterance = {
			endedAt: Number(rawUtterance.endedAt),
			id: utteranceId,
			speaker: String(rawUtterance.speaker),
			startedAt: Number(rawUtterance.startedAt),
			text,
		};
		const previousSection = sections.at(-1);

		if (
			previousSection &&
			shouldAppendTranscriptUtteranceToSection({
				section: previousSection,
				utterance,
			})
		) {
			previousSection.endedAt = Math.max(
				previousSection.endedAt,
				utterance.endedAt,
			);
			previousSection.id = previousSection.utteranceIds
				.concat(utterance.id)
				.join("|");
			previousSection.text = joinTranscriptSectionText(
				previousSection.text,
				utterance.text,
			);
			previousSection.utteranceIds.push(utterance.id);
			continue;
		}

		sections.push({
			endedAt: utterance.endedAt,
			id: utterance.id,
			speaker: utterance.speaker,
			startedAt: utterance.startedAt,
			text: utterance.text,
			utteranceIds: [utterance.id],
		});
	}

	return sections;
};

export const createTranscriptBlocksText = (
	sections = [],
	{ speakerLabels = DEFAULT_TRANSCRIPT_SPEAKER_LABELS } = {},
) =>
	sections
		.flatMap((section) => {
			const text = typeof section?.text === "string" ? section.text.trim() : "";

			if (!text) {
				return [];
			}

			return [
				`${getTranscriptSpeakerLabel(section.speaker, speakerLabels)}: ${text}`,
			];
		})
		.join("\n\n")
		.trim();

export const createTranscriptBlocksTextFromUtterances = (
	utterances = [],
	options = {},
) =>
	createTranscriptBlocksText(createTranscriptTextSections(utterances), options);

export const isTranscriptPlaceholderText = (value) => {
	const normalizedValue = normalizeTranscriptText(value);

	if (!normalizedValue) {
		return false;
	}

	return (
		transcriptPlaceholderPatterns.has(normalizedValue) &&
		getTranscriptWordCount(normalizedValue) <= 2
	);
};

export const resolveRealtimeNoiseReductionType = (source) => {
	return isSystemAudioSource(source) ? null : "near_field";
};

export const normalizeTranscriptionLanguage = (value) =>
	value?.split("-")[0]?.trim().toLowerCase() || null;

export const createRealtimeTranscriptionSessionOptions = ({
	language = null,
	source = null,
	speaker = null,
} = {}) => ({
	language,
	noiseReductionType: resolveRealtimeNoiseReductionType(source),
	delay: REALTIME_TRANSCRIPTION_DELAY,
});

export const createRealtimeTranscriptionSession = ({
	delay = REALTIME_TRANSCRIPTION_DELAY,
	language = null,
	noiseReductionType = "near_field",
} = {}) => ({
	type: "transcription",
	include: REALTIME_TRANSCRIPTION_INCLUDE_FIELDS,
	audio: {
		input: {
			noise_reduction: noiseReductionType
				? {
						type: noiseReductionType,
					}
				: null,
			transcription: {
				model: REALTIME_TRANSCRIPTION_MODEL,
				delay,
				...(language ? { language } : {}),
			},
		},
	},
});

export const resolveDesktopRealtimeProfile = ({
	source = null,
	speaker = null,
} = {}) => {
	return "default";
};

export const createDesktopRealtimeTranscriptionSession = ({
	language = null,
	source = null,
	speaker = null,
} = {}) => {
	const session = createRealtimeTranscriptionSession(
		createRealtimeTranscriptionSessionOptions({
			language,
			source,
			speaker,
		}),
	);

	return {
		...session,
		audio: {
			input: {
				...session.audio.input,
				format: {
					rate: AUDIO_TRANSCRIPTION_SAMPLE_RATE,
					type: "audio/pcm",
				},
			},
		},
	};
};

const clampProbability = (logprob) => {
	if (typeof logprob !== "number" || Number.isNaN(logprob)) {
		return null;
	}

	return Math.exp(Math.min(0, Math.max(logprob, -20)));
};

const getConfidenceCandidates = (logprobs) =>
	Array.isArray(logprobs)
		? logprobs
				.map((entry) => ({
					probability: clampProbability(entry?.logprob),
					token:
						typeof entry?.token === "string"
							? entry.token
							: Array.isArray(entry?.bytes)
								? String.fromCharCode(...entry.bytes)
								: "",
				}))
				.filter(
					(entry) =>
						entry.probability !== null &&
						typeof entry.token === "string" &&
						entry.token.trim().length > 0,
				)
		: [];

export const summarizeTranscriptConfidence = ({
	logprobs,
	source = null,
	text,
}) => {
	const normalizedText = typeof text === "string" ? text.trim() : "";
	const wordCount = getTranscriptWordCount(normalizedText);
	const confidenceCandidates = getConfidenceCandidates(logprobs);
	const minimumCandidateCount = isSystemAudioSource(source)
		? Math.max(2, Math.min(4, wordCount))
		: 5;

	if (
		normalizedText.length === 0 ||
		wordCount === 0 ||
		confidenceCandidates.length < minimumCandidateCount
	) {
		return null;
	}

	const probabilities = confidenceCandidates.map((entry) => entry.probability);
	const average =
		probabilities.reduce((sum, probability) => sum + probability, 0) /
		probabilities.length;
	const lowTokenRatio =
		probabilities.filter((probability) => probability < 0.2).length /
		probabilities.length;
	const veryLowTokenRatio =
		probabilities.filter((probability) => probability < 0.08).length /
		probabilities.length;
	const minProbability = Math.min(...probabilities);

	return {
		average,
		lowTokenRatio,
		minProbability,
		tokenCount: probabilities.length,
		veryLowTokenRatio,
		wordCount,
	};
};

export const isLowConfidenceTranscriptLogprobs = ({
	logprobs,
	source = null,
	text,
}) => {
	const summary = summarizeTranscriptConfidence({
		logprobs,
		source,
		text,
	});

	if (!summary) {
		return false;
	}

	if (isSystemAudioSource(source)) {
		if (summary.wordCount <= 4) {
			return (
				summary.average < 0.6 ||
				summary.lowTokenRatio >= 0.5 ||
				summary.veryLowTokenRatio >= 0.25 ||
				summary.minProbability < 0.03
			);
		}

		return (
			summary.average < 0.5 ||
			summary.lowTokenRatio >= 0.45 ||
			summary.veryLowTokenRatio >= 0.18 ||
			summary.minProbability < 0.02
		);
	}

	return summary.average < 0.45 || summary.lowTokenRatio >= 0.6;
};

export const shouldDropTranscriptForConfidence = ({
	logprobs,
	source = null,
	text,
}) => {
	const normalizedText = normalizeTranscriptText(text);

	if (!normalizedText || isTranscriptPlaceholderText(normalizedText)) {
		return true;
	}

	const summary = summarizeTranscriptConfidence({
		logprobs,
		source,
		text: normalizedText,
	});

	if (
		!summary ||
		!isLowConfidenceTranscriptLogprobs({
			logprobs,
			source,
			text: normalizedText,
		})
	) {
		return false;
	}

	if (isSystemAudioSource(source)) {
		if (summary.wordCount <= 2) {
			return (
				summary.average < 0.14 ||
				summary.lowTokenRatio >= 1 ||
				summary.veryLowTokenRatio >= 0.8 ||
				summary.minProbability < 0.0005
			);
		}

		if (summary.wordCount <= 4) {
			return (
				summary.average < 0.2 ||
				summary.lowTokenRatio >= 0.85 ||
				summary.veryLowTokenRatio >= 0.5 ||
				summary.minProbability < 0.0005
			);
		}

		if (summary.wordCount <= 10) {
			return (
				summary.average < 0.16 ||
				summary.lowTokenRatio >= 0.9 ||
				summary.veryLowTokenRatio >= 0.55 ||
				summary.minProbability < 0.0004
			);
		}

		if (summary.wordCount <= 14) {
			return (
				summary.average < 0.14 &&
				(summary.lowTokenRatio >= 0.92 ||
					summary.veryLowTokenRatio >= 0.58 ||
					summary.minProbability < 0.0003)
			);
		}

		return false;
	}

	return true;
};

export const shouldKeepInterruptedTranscriptTurn = ({
	logprobs,
	source = null,
	text,
}) => {
	const normalizedText = normalizeTranscriptText(text);

	if (!normalizedText || isTranscriptPlaceholderText(normalizedText)) {
		return false;
	}

	return true;
};
