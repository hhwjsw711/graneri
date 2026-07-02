import { describe, expect, it } from "vitest";
import {
	createEmptyLiveTranscriptState,
	createTranscriptDisplayEntries,
} from "../src/lib/transcript";

describe("transcript display entries", () => {
	it("starts a new same-speaker block after a period-ending chunk", () => {
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
				endedAt: 2_000,
				id: "1",
				isLive: false,
				isProvisional: false,
				speaker: "them",
				startedAt: 1_000,
				text: "First question.",
				utteranceIds: ["1"],
			},
			{
				endedAt: 5_000,
				id: "2",
				isLive: false,
				isProvisional: false,
				speaker: "them",
				startedAt: 4_000,
				text: "Second question.",
				utteranceIds: ["2"],
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

	it("groups adjacent same-speaker continuation chunks until a period-ending chunk", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: createEmptyLiveTranscriptState(),
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "First part",
						startedAt: 1_000,
						endedAt: 2_000,
					},
					{
						id: "2",
						speaker: "them",
						text: "continues here",
						startedAt: 4_000,
						endedAt: 5_000,
					},
					{
						id: "3",
						speaker: "them",
						text: "New sentence.",
						startedAt: 6_000,
						endedAt: 7_000,
					},
				],
			}).map((entry) => ({
				id: entry.id,
				text: entry.text,
				utteranceIds: entry.utteranceIds,
			})),
		).toEqual([
			{
				id: "1|2|3",
				text: "First part continues here New sentence.",
				utteranceIds: ["1", "2", "3"],
			},
		]);
	});

	it("appends same-speaker provisional text inside an unfinished committed block", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: {
					...createEmptyLiveTranscriptState(),
					them: {
						speaker: "them",
						startedAt: 7_000,
						text: "Still speaking",
					},
				},
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "Opening",
						startedAt: 1_000,
						endedAt: 2_000,
					},
				],
			}),
		).toEqual([
			{
				committedText: "Opening",
				endedAt: 7_000,
				id: "1",
				isLive: true,
				isProvisional: true,
				liveText: "Still speaking",
				speaker: "them",
				startedAt: 1_000,
				text: "Opening Still speaking",
				utteranceIds: ["1"],
			},
		]);
	});

	it("keeps same-speaker provisional text separate after a period-ending committed block", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: {
					...createEmptyLiveTranscriptState(),
					them: {
						speaker: "them",
						startedAt: 7_000,
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
			}).map((entry) => ({
				id: entry.id,
				isLive: entry.isLive,
				speaker: entry.speaker,
				text: entry.text,
			})),
		).toEqual([
			{
				id: "1",
				isLive: false,
				speaker: "them",
				text: "Opening.",
			},
			{
				id: "live:them:7000",
				isLive: true,
				speaker: "them",
				text: "Still speaking",
			},
		]);
	});

	it("appends user provisional text inside an unfinished committed block", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: {
					...createEmptyLiveTranscriptState(),
					you: {
						speaker: "you",
						startedAt: 7_000,
						text: "one more thing",
					},
				},
				utterances: [
					{
						id: "1",
						speaker: "you",
						text: "My answer",
						startedAt: 1_000,
						endedAt: 2_000,
					},
				],
			}),
		).toEqual([
			{
				committedText: "My answer",
				endedAt: 7_000,
				id: "1",
				isLive: true,
				isProvisional: true,
				liveText: "one more thing",
				speaker: "you",
				startedAt: 1_000,
				text: "My answer one more thing",
				utteranceIds: ["1"],
			},
		]);
	});

	it("keeps provisional live entries separate when speaker changes", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: {
					...createEmptyLiveTranscriptState(),
					you: {
						speaker: "you",
						startedAt: 10_000,
						text: "My response",
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
				id: "live:you:10000",
				isLive: true,
				isProvisional: true,
				speaker: "you",
				startedAt: 10_000,
				text: "My response",
				utteranceIds: [],
			},
		]);
	});

	it("does not append provisional text across an intervening speaker block", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: {
					...createEmptyLiveTranscriptState(),
					you: {
						speaker: "you",
						startedAt: 10_000,
						text: "later answer",
					},
				},
				utterances: [
					{
						id: "1",
						speaker: "you",
						text: "Earlier answer.",
						startedAt: 1_000,
						endedAt: 2_000,
					},
					{
						id: "2",
						speaker: "them",
						text: "Follow-up question.",
						startedAt: 4_000,
						endedAt: 5_000,
					},
				],
			}).map((entry) => ({
				id: entry.id,
				isLive: entry.isLive,
				speaker: entry.speaker,
				text: entry.text,
			})),
		).toEqual([
			{
				id: "1",
				isLive: false,
				speaker: "you",
				text: "Earlier answer.",
			},
			{
				id: "2",
				isLive: false,
				speaker: "them",
				text: "Follow-up question.",
			},
			{
				id: "live:you:10000",
				isLive: true,
				speaker: "you",
				text: "later answer",
			},
		]);
	});

	it("keeps same-speaker blocks together across long pauses when the previous chunk is unfinished", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: createEmptyLiveTranscriptState(),
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "One topic",
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
		).toEqual(["One topic Next topic."]);
	});

	it("starts a new block when embedded speaker labels change", () => {
		expect(
			createTranscriptDisplayEntries({
				liveTranscript: createEmptyLiveTranscriptState(),
				utterances: [
					{
						id: "1",
						speaker: "them",
						text: "Speaker A: first part",
						startedAt: 1_000,
						endedAt: 2_000,
					},
					{
						id: "2",
						speaker: "them",
						text: "Speaker B: response",
						startedAt: 2_500,
						endedAt: 3_000,
					},
				],
			}).map((entry) => entry.text),
		).toEqual(["Speaker A: first part", "Speaker B: response"]);
	});

	it("does not split long same-speaker explanations by display density", () => {
		const firstExplanation =
			"Frontier post training has a lot of moving pieces and the recipe quality depends on how data, policy optimization, evaluation, distillation, preference modeling, and inference constraints reinforce each other during a real production rollout";

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
			`${firstExplanation} The next point is about why the serving cost changes the business model.`,
		]);
	});
});
