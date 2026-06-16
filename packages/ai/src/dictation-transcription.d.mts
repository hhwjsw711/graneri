export const MAX_DICTATION_AUDIO_BYTES: number;

export type DictationTranscriptionResult = {
	durationInSeconds?: number;
	language?: string;
	text: string;
};

export function transcribeDictationAudio(options?: {
	audio?: Uint8Array;
	language?: string | null;
	prompt?: string | null;
}): Promise<DictationTranscriptionResult>;
