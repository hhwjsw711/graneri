import assert from "node:assert/strict";
import test from "node:test";
import { isLikelySystemAudioPermissionError } from "../src/native-audio-capture.mjs";

test("system audio startup timeout is retryable instead of permission-blocking", () => {
	assert.equal(
		isLikelySystemAudioPermissionError(
			new Error("Timed out while starting macOS system audio capture."),
		),
		false,
	);
});

test("system audio permission failures are permission-blocking", () => {
	assert.equal(
		isLikelySystemAudioPermissionError(
			new Error("System audio permission denied by macOS."),
		),
		true,
	);
});
