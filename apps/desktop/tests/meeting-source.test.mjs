import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeMeetingDetectionSourceName,
	resolveNativeMeetingDetectionSourceName,
} from "../src/meeting-source.mjs";

test("normalizes source names", () => {
	assert.equal(normalizeMeetingDetectionSourceName(" Zoom "), "Zoom");
	assert.equal(normalizeMeetingDetectionSourceName(""), null);
	assert.equal(normalizeMeetingDetectionSourceName(null), null);
});

test("maps native meeting source names without browser automation", () => {
	assert.equal(resolveNativeMeetingDetectionSourceName("zoom.us"), "Zoom");
	assert.equal(resolveNativeMeetingDetectionSourceName("Slack"), "Slack Huddle");
	assert.equal(resolveNativeMeetingDetectionSourceName("Arc"), "Arc");
	assert.equal(resolveNativeMeetingDetectionSourceName("Google Chrome"), "Google Chrome");
	assert.equal(resolveNativeMeetingDetectionSourceName("helper"), null);
});
