import { describe, expect, it } from "vitest";
import {
	createNoteSearch,
	getAppLocationState,
	shouldAutoStartNoteCaptureFromUrl,
} from "../src/app/location";

describe("app location", () => {
	it("requires a capture request id before auto-starting note capture", () => {
		const locationState = getAppLocationState(
			new URL("https://graneri.local/note?capture=1"),
		);

		expect(locationState.shouldAutoStartNoteCapture).toBe(false);
		expect(locationState.noteCaptureRequestId).toBe(null);
		expect(locationState.canonicalSearch).toBe("");
		expect(
			shouldAutoStartNoteCaptureFromUrl(
				new URL("https://graneri.local/note?capture=1"),
			),
		).toBe(false);
	});

	it("preserves valid note capture request ids", () => {
		const locationState = getAppLocationState(
			new URL("https://graneri.local/note?capture=1&captureRequestId=req-1"),
		);

		expect(locationState.shouldAutoStartNoteCapture).toBe(true);
		expect(locationState.noteCaptureRequestId).toBe("req-1");
		expect(locationState.canonicalSearch).toBe(
			"?capture=1&captureRequestId=req-1",
		);
	});

	it("does not emit malformed auto-start capture URLs", () => {
		expect(createNoteSearch({ autoStartCapture: true })).toBe("");
		expect(
			createNoteSearch({
				autoStartCapture: true,
				captureRequestId: " req-2 ",
			}),
		).toBe("?capture=1&captureRequestId=req-2");
	});
});
