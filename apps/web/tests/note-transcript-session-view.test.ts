import { describe, expect, it } from "vitest";
import {
	mergeTranscriptUtterances,
	resolveTranscriptSessionReady,
} from "../src/lib/note-transcript-session-view";

describe("note transcript session view", () => {
	it("merges local and controller snapshot utterances without dropping stopped transcript text", () => {
		expect(
			mergeTranscriptUtterances(
				[
					{
						endedAt: 5_000,
						id: "local-2",
						speaker: "you",
						startedAt: 4_000,
						text: "Second captured line.",
					},
				],
				[
					{
						endedAt: 2_000,
						id: "snapshot-1",
						speaker: "you",
						startedAt: 1_000,
						text: "First captured line.",
					},
					{
						endedAt: 5_000,
						id: "local-2",
						speaker: "you",
						startedAt: 4_000,
						text: "Second captured line.",
					},
				],
			),
		).toEqual([
			{
				endedAt: 2_000,
				id: "snapshot-1",
				speaker: "you",
				startedAt: 1_000,
				text: "First captured line.",
			},
			{
				endedAt: 5_000,
				id: "local-2",
				speaker: "you",
				startedAt: 4_000,
				text: "Second captured line.",
			},
		]);
	});

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
