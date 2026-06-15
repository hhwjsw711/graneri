import { describe, expect, it } from "vitest";
import { resolveTranscriptSessionReady } from "../src/lib/note-transcript-session-view";

describe("note transcript session view", () => {
	it("keeps capture transcript ready while server summary hydration is pending", () => {
		expect(
			resolveTranscriptSessionReady({
				hasLocalCaptureTranscript: true,
				isDraftReady: false,
				isSummaryLoading: true,
				isViewingCaptureScope: true,
			}),
		).toBe(true);
	});

	it("waits for capture draft hydration when no local transcript exists", () => {
		expect(
			resolveTranscriptSessionReady({
				hasLocalCaptureTranscript: false,
				isDraftReady: true,
				isSummaryLoading: true,
				isViewingCaptureScope: true,
			}),
		).toBe(false);
	});

	it("uses server summary readiness for non-capture notes", () => {
		expect(
			resolveTranscriptSessionReady({
				hasLocalCaptureTranscript: true,
				isDraftReady: false,
				isSummaryLoading: true,
				isViewingCaptureScope: false,
			}),
		).toBe(false);
	});
});
