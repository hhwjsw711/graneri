import assert from "node:assert/strict";
import test from "node:test";
import {
	createEmptyLiveTranscriptState,
	createTranscriptRecoveryStatus,
	createTranscriptionSpeakerRuntime,
} from "../src/desktop-transcription-runtime.mjs";

test("creates isolated transcription speaker runtimes", () => {
	const you = createTranscriptionSpeakerRuntime("you");
	const them = createTranscriptionSpeakerRuntime("them");

	you.turns.set("item-1", { text: "hello" });
	you.emittedItemIds.add("item-1");

	assert.equal(you.speaker, "you");
	assert.equal(you.activeSourceMode, "unsupported");
	assert.equal(you.captureDispose, null);
	assert.equal(you.lastCommittedItemId, null);
	assert.equal(you.liveItemId, null);
	assert.equal(you.sessionId, null);
	assert.equal(you.transportActive, false);
	assert.deepEqual([...them.turns.keys()], []);
	assert.deepEqual([...them.emittedItemIds], []);
});

test("creates recovery status with explicit overrides", () => {
	assert.deepEqual(createTranscriptRecoveryStatus(), {
		attempt: 0,
		maxAttempts: 0,
		message: null,
		state: "idle",
	});
	assert.deepEqual(
		createTranscriptRecoveryStatus({
			attempt: 2,
			maxAttempts: 3,
			message: "Retrying",
			state: "recovering",
		}),
		{
			attempt: 2,
			maxAttempts: 3,
			message: "Retrying",
			state: "recovering",
		},
	);
});

test("creates empty live transcript state", () => {
	assert.deepEqual(createEmptyLiveTranscriptState(), {
		you: {
			speaker: "you",
			startedAt: null,
			text: "",
		},
		them: {
			speaker: "them",
			startedAt: null,
			text: "",
		},
	});
});
