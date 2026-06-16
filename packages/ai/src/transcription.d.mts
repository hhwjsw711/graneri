export declare const REALTIME_TRANSCRIPTION_MODEL: "gpt-realtime-whisper";
export declare const DICTATION_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe";
export declare const AUDIO_TRANSCRIPTION_SAMPLE_RATE: 24000;
export declare const REALTIME_TRANSCRIPTION_DELAY: "low";

export declare const REALTIME_TRANSCRIPTION_INCLUDE_FIELDS: readonly [
	"item.input_audio_transcription.logprobs",
];

export declare function resolveRealtimeNoiseReductionType(
	source?: string | null,
): "near_field" | null;

export declare function createRealtimeTranscriptionSessionOptions(args?: {
	language?: string | null;
	source?: string | null;
	speaker?: string | null;
}): {
	delay: "low";
	language: string | null;
	noiseReductionType: "near_field" | null;
};

export declare function normalizeTranscriptionLanguage(
	value?: string | null,
): string | null;

export declare function normalizeTranscriptText(
	value?: string | null,
): string;

export declare function getTranscriptWordCount(value?: string | null): number;

export declare function isTranscriptPlaceholderText(
	value?: string | null,
): boolean;

export declare function createRealtimeTranscriptionSession(options?: {
	delay?: "minimal" | "low" | "medium" | "high" | "xhigh";
	language?: string | null;
	noiseReductionType?: "near_field" | "far_field" | null;
}): {
	type: "transcription";
	include: readonly ["item.input_audio_transcription.logprobs"];
	audio: {
		input: {
			noise_reduction: {
				type: "near_field" | "far_field";
			} | null;
			transcription: {
				delay: "minimal" | "low" | "medium" | "high" | "xhigh";
				model: typeof REALTIME_TRANSCRIPTION_MODEL;
				language?: string;
			};
		};
	};
};

export declare function resolveDesktopRealtimeProfile(args?: {
	source?: string | null;
	speaker?: string | null;
}): "default";

export declare function createDesktopRealtimeTranscriptionSession(args?: {
	language?: string | null;
	source?: string | null;
	speaker?: string | null;
}): {
	type: "transcription";
	include: readonly ["item.input_audio_transcription.logprobs"];
	audio: {
		input: {
			format: {
				rate: typeof AUDIO_TRANSCRIPTION_SAMPLE_RATE;
				type: "audio/pcm";
			};
			noise_reduction: {
				type: "near_field" | "far_field";
			} | null;
			transcription: {
				delay: "minimal" | "low" | "medium" | "high" | "xhigh";
				model: typeof REALTIME_TRANSCRIPTION_MODEL;
				language?: string;
			};
		};
	};
};

export declare function summarizeTranscriptConfidence(args: {
	logprobs?: Array<{
		bytes?: number[];
		logprob?: number;
		token?: string;
	}> | null;
	source?: string | null;
	text?: string | null;
}): {
	average: number;
	lowTokenRatio: number;
	minProbability: number;
	tokenCount: number;
	veryLowTokenRatio: number;
	wordCount: number;
} | null;

export declare function isLowConfidenceTranscriptLogprobs(args: {
	logprobs?: Array<{
		bytes?: number[];
		logprob?: number;
		token?: string;
	}> | null;
	source?: string | null;
	text?: string | null;
}): boolean;

export declare function shouldDropTranscriptForConfidence(args: {
	logprobs?: Array<{
		bytes?: number[];
		logprob?: number;
		token?: string;
	}> | null;
	source?: string | null;
	text?: string | null;
}): boolean;

export declare function shouldKeepInterruptedTranscriptTurn(args: {
	logprobs?: Array<{
		bytes?: number[];
		logprob?: number;
		token?: string;
	}> | null;
	source?: string | null;
	text?: string | null;
}): boolean;
