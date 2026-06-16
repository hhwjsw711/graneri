import assert from "node:assert/strict";
import test from "node:test";
import { isHelperStderrError } from "../src/line-event-helper-session.mjs";

test("classifies benign helper stderr as info-level output", () => {
	assert.equal(
		isHelperStderrError("[helper] microphone activity monitor starting"),
		false,
	);
	assert.equal(
		isHelperStderrError("[helper] meeting window monitor starting"),
		false,
	);
});

test("classifies helper stderr permission and failure messages as errors", () => {
	assert.equal(isHelperStderrError("Permission denied"), true);
	assert.equal(isHelperStderrError("Operation not permitted"), true);
	assert.equal(isHelperStderrError("Cannot access Accessibility API"), true);
	assert.equal(isHelperStderrError("Timed out waiting for helper"), true);
	assert.equal(isHelperStderrError("fatal helper failure"), true);
});
