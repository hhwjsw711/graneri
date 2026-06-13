import { openai } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import {
	DICTATION_TRANSCRIPTION_MODEL,
	normalizeTranscriptionLanguage,
} from "./transcription.mjs";

export const MAX_DICTATION_AUDIO_BYTES = 25_000_000;

const MAX_DICTATION_PROMPT_LENGTH = 1_000;

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeMediaType = (value) => {
	const mediaType = trim(value).toLowerCase();

	if (!mediaType || mediaType.length > 120) {
		return "audio/webm";
	}

	return mediaType;
};

const buildOpenAIOptions = ({ language, prompt }) => {
	const options = {};
	const normalizedLanguage = normalizeTranscriptionLanguage(language);
	const normalizedPrompt = trim(prompt).slice(0, MAX_DICTATION_PROMPT_LENGTH);

	if (normalizedLanguage) {
		options.language = normalizedLanguage;
	}

	if (normalizedPrompt) {
		options.prompt = normalizedPrompt;
	}

	if (Object.keys(options).length > 0) {
		options.timestampGranularities = [];
	}

	return options;
};

const createDictationTranscriptionModel = (mediaType) => {
	const model = openai.transcription(DICTATION_TRANSCRIPTION_MODEL);

	return Object.assign(Object.create(model), {
		doGenerate: (options) =>
			model.doGenerate({
				...options,
				mediaType,
			}),
	});
};

export const transcribeDictationAudio = async ({
	audio,
	language = null,
	mediaType = "audio/webm",
	prompt = null,
} = {}) => {
	if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
		throw new Error("Audio is required.");
	}

	if (audio.byteLength > MAX_DICTATION_AUDIO_BYTES) {
		throw new Error("Audio is too large.");
	}

	const openaiOptions = buildOpenAIOptions({ language, prompt });
	const result = await transcribe({
		model: createDictationTranscriptionModel(normalizeMediaType(mediaType)),
		audio,
		providerOptions:
			Object.keys(openaiOptions).length > 0
				? {
						openai: openaiOptions,
					}
				: undefined,
	});

	return {
		durationInSeconds: result.durationInSeconds,
		language: result.language,
		text: result.text.trim(),
	};
};
