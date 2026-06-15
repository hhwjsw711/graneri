import { describe, expect, test } from "vitest";
import {
	getNoteGenerateAvailability,
	resolveCanGenerateNotes,
} from "@/lib/note-generate-action";

const createReadyGenerateState = () => ({
	hasGeneratedLatestTranscript: false,
	hasPendingGenerateTranscript: true,
	isChatOpen: false,
	isGeneratingTemplateNote: false,
	isSpeechListening: false,
	isTranscriptOpen: false,
	isTranscriptSessionReady: true,
});

describe("resolveCanGenerateNotes", () => {
	test("allows note generation when the ready transcript panel is closed", () => {
		expect(getNoteGenerateAvailability(createReadyGenerateState())).toEqual({
			status: "available",
		});
		expect(resolveCanGenerateNotes(createReadyGenerateState())).toBe(true);
	});

	test("blocks note generation during chat, active transcription, and open transcript panel", () => {
		expect(
			getNoteGenerateAvailability({
				...createReadyGenerateState(),
				isChatOpen: true,
			}),
		).toEqual({ status: "blocked", reason: "chat_open" });
		expect(
			getNoteGenerateAvailability({
				...createReadyGenerateState(),
				isSpeechListening: true,
			}),
		).toEqual({ status: "blocked", reason: "recording" });
		expect(
			getNoteGenerateAvailability({
				...createReadyGenerateState(),
				isTranscriptOpen: true,
			}),
		).toEqual({ status: "blocked", reason: "transcript_open" });
	});
});
