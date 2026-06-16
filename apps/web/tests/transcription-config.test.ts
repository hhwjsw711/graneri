import { describe, expect, it } from "vitest";
import {
	createRealtimeTranscriptionSession,
	createRealtimeTranscriptionSessionOptions,
	DICTATION_TRANSCRIPTION_MODEL,
	isLowConfidenceTranscriptLogprobs,
	REALTIME_TRANSCRIPTION_DELAY,
	REALTIME_TRANSCRIPTION_MODEL,
	resolveDesktopRealtimeProfile,
	resolveRealtimeNoiseReductionType,
} from "../../../packages/ai/src/transcription.mjs";

describe("transcription config", () => {
	it("keeps dictation and realtime transcription models separate", () => {
		expect(DICTATION_TRANSCRIPTION_MODEL).toBe("gpt-4o-mini-transcribe");
		expect(REALTIME_TRANSCRIPTION_MODEL).toBe("gpt-realtime-whisper");
		expect(REALTIME_TRANSCRIPTION_DELAY).toBe("low");
	});

	it("does not apply microphone noise reduction to system audio", () => {
		expect(resolveRealtimeNoiseReductionType("systemAudio")).toBeNull();
		expect(resolveRealtimeNoiseReductionType("system-audio")).toBeNull();
		expect(resolveRealtimeNoiseReductionType("system_audio")).toBeNull();
		expect(resolveRealtimeNoiseReductionType("microphone")).toBe("near_field");
	});

	it("serializes nullable noise reduction in realtime transcription sessions", () => {
		expect(
			createRealtimeTranscriptionSession({
				language: "en",
				noiseReductionType: null,
			}).audio.input.noise_reduction,
		).toBeNull();
	});

	it("uses realtime-whisper session fields for live transcription", () => {
		const session = createRealtimeTranscriptionSession(
			createRealtimeTranscriptionSessionOptions({
				language: "en",
				source: "systemAudio",
			}),
		);

		expect(session.audio.input).not.toHaveProperty("turn_detection");
		expect(session.audio.input.transcription).toEqual({
			delay: "low",
			language: "en",
			model: "gpt-realtime-whisper",
		});
	});

	it("uses the default desktop realtime profile across realtime sessions", () => {
		const session = createRealtimeTranscriptionSession(
			createRealtimeTranscriptionSessionOptions({
				language: "en",
				source: "systemAudio",
				speaker: "them",
			}),
		);

		expect(session.audio.input).not.toHaveProperty("turn_detection");
		expect(
			resolveDesktopRealtimeProfile({
				source: "systemAudio",
				speaker: "them",
			}),
		).toBe("default");
	});

	it("uses stricter low-confidence thresholds for system audio", () => {
		expect(
			isLowConfidenceTranscriptLogprobs({
				logprobs: [
					{ logprob: -1.8, token: "hello" },
					{ logprob: -2.4, token: "world" },
					{ logprob: -3.6, token: "today" },
				],
				source: "systemAudio",
				text: "hello world today",
			}),
		).toBe(true);

		expect(
			isLowConfidenceTranscriptLogprobs({
				logprobs: [
					{ logprob: -0.08, token: "hello" },
					{ logprob: -0.05, token: "world" },
					{ logprob: -0.09, token: "today" },
				],
				source: "systemAudio",
				text: "hello world today",
			}),
		).toBe(false);
	});
});
