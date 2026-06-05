import { describe, expect, it } from "vitest";
import { TranscriptionAutoStopController } from "../src/lib/transcription-auto-stop";

describe("meeting transcription auto-stop", () => {
	it("does not stop from a stale meeting signal before capture is listening", () => {
		const controller = new TranscriptionAutoStopController();

		controller.queueMeetingAutoStart({
			enabled: true,
		});

		expect(
			controller.observeMeetingSignal({
				hasMeetingSignal: true,
				isSpeechListening: false,
			}),
		).toBe(false);
		expect(
			controller.observeMeetingSignal({
				hasMeetingSignal: false,
				isSpeechListening: true,
			}),
		).toBe(false);
	});

	it("stops once after an active meeting signal disappears", () => {
		const controller = new TranscriptionAutoStopController();

		controller.queueMeetingAutoStart({
			enabled: true,
		});

		expect(
			controller.observeMeetingSignal({
				hasMeetingSignal: true,
				isSpeechListening: true,
			}),
		).toBe(false);
		expect(
			controller.observeMeetingSignal({
				hasMeetingSignal: false,
				isSpeechListening: true,
			}),
		).toBe(true);
		expect(
			controller.observeMeetingSignal({
				hasMeetingSignal: false,
				isSpeechListening: true,
			}),
		).toBe(false);
	});

	it("can latch meeting auto-stop after auto-start state is queued", () => {
		const controller = new TranscriptionAutoStopController();

		controller.queueMeetingAutoStart({
			enabled: false,
		});
		controller.latchMeetingAutoStop({
			enabled: true,
		});

		controller.observeMeetingSignal({
			hasMeetingSignal: true,
			isSpeechListening: true,
		});

		expect(
			controller.observeMeetingSignal({
				hasMeetingSignal: false,
				isSpeechListening: true,
			}),
		).toBe(true);
	});
});
