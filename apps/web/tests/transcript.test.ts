import { describe, expect, it } from "vitest";
import {
	createEmptyLiveTranscriptState,
	createTranscriptDisplayEntries,
} from "../src/lib/transcript";

describe("transcript display entries", () => {
	it("groups adjacent same-speaker utterances into append-only committed blocks", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: createEmptyLiveTranscriptState(),
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "First question.",
						startedAt: 1_000,
						endedAt: 2_000,
					},
					{
						id: "2",
						speaker: "them",
						text: "Second question.",
						startedAt: 4_000,
						endedAt: 5_000,
					},
					{
						id: "3",
						speaker: "you",
						text: "Answer.",
						startedAt: 8_000,
						endedAt: 9_000,
					},
				],
			}),
		).toEqual([
			{
				endedAt: 5_000,
				id: "1|2",
				isLive: false,
				isProvisional: false,
				speaker: "them",
				startedAt: 1_000,
				text: "First question. Second question.",
				utteranceIds: ["1", "2"],
			},
			{
				endedAt: 9_000,
				id: "3",
				isLive: false,
				isProvisional: false,
				speaker: "you",
				startedAt: 8_000,
				text: "Answer.",
				utteranceIds: ["3"],
			},
		]);
	});

	it("appends provisional live entries after committed blocks", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: {
					...createEmptyLiveTranscriptState(),
					them: {
						speaker: "them",
						startedAt: 10_000,
						text: "Still speaking",
					},
				},
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "Opening.",
						startedAt: 1_000,
						endedAt: 2_000,
					},
				],
			}),
		).toEqual([
			{
				endedAt: 2_000,
				id: "1",
				isLive: false,
				isProvisional: false,
				speaker: "them",
				startedAt: 1_000,
				text: "Opening.",
				utteranceIds: ["1"],
			},
			{
				endedAt: 10_000,
				id: "live:them:10000",
				isLive: true,
				isProvisional: true,
				speaker: "them",
				startedAt: 10_000,
				text: "Still speaking",
				utteranceIds: [],
			},
		]);
	});

	it("starts a new same-speaker block after a long pause", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: createEmptyLiveTranscriptState(),
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "One topic.",
						startedAt: 1_000,
						endedAt: 2_000,
					},
					{
						id: "2",
						speaker: "them",
						text: "Next topic.",
						startedAt: 8_500,
						endedAt: 9_000,
					},
				],
			}).map((entry) => entry.text),
		).toEqual(["One topic.", "Next topic."]);
	});

	it("sections long same-speaker explanations at sentence boundaries", () => {
		const firstExplanation =
			"Frontier post training has a lot of moving pieces and the recipe quality depends on how data, policy optimization, evaluation, distillation, preference modeling, and inference constraints reinforce each other during a real production rollout.";

		expect(
			createTranscriptDisplayEntries({
				liveTranscript: createEmptyLiveTranscriptState(),
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: firstExplanation,
						startedAt: 1_000,
						endedAt: 2_000,
					},
					{
						id: "2",
						speaker: "them",
						text: "The next point is about why the serving cost changes the business model.",
						startedAt: 2_500,
						endedAt: 3_000,
					},
				],
			}).map((entry) => entry.text),
		).toEqual([
			firstExplanation,
			"The next point is about why the serving cost changes the business model.",
		]);
	});

	it("sections long same-speaker explanations before display blocks become too dense", () => {
		const utterances = Array.from({ length: 9 }, (_, index) => ({
			id: String(index + 1),
			speaker: "them" as const,
			text: `This is detailed meeting context chunk ${index + 1} with enough words to make the display block grow steadily`,
			startedAt: 1_000 + index * 1_000,
			endedAt: 1_500 + index * 1_000,
		}));

		const entries = createTranscriptDisplayEntries({
			liveTranscript: createEmptyLiveTranscriptState(),
			utterances,
		});

		expect(entries.length).toBeGreaterThan(1);
		expect(entries.every((entry) => entry.speaker === "them")).toBe(true);
		expect(entries.flatMap((entry) => entry.utteranceIds)).toEqual(
			utterances.map((utterance) => utterance.id),
		);
	});
});
