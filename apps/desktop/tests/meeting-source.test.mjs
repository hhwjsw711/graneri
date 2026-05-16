import assert from "node:assert/strict";
import test from "node:test";
import {
	getBrowserActiveTabUrlScript,
	getMeetingProviderNameFromUrl,
	normalizeMeetingDetectionSourceName,
	resolveNativeMeetingDetectionSourceName,
} from "../src/meeting-source.mjs";

test("maps supported meeting URLs to provider labels", () => {
	assert.equal(
		getMeetingProviderNameFromUrl("https://meet.google.com/abc-defg-hij"),
		"Google Meet",
	);
	assert.equal(
		getMeetingProviderNameFromUrl("https://meet.google.com/lookup/team-sync"),
		"Google Meet",
	);
	assert.equal(
		getMeetingProviderNameFromUrl("https://telemost.yandex.ru/j/123456"),
		"Yandex Telemost",
	);
	assert.equal(
		getMeetingProviderNameFromUrl("https://foo.zoom.us/wc/123/start"),
		"Zoom",
	);
	assert.equal(
		getMeetingProviderNameFromUrl(
			"https://teams.microsoft.com/l/meetup-join/abc",
		),
		"Microsoft Teams",
	);
});

test("ignores provider home pages and unrelated URLs", () => {
	assert.equal(getMeetingProviderNameFromUrl("https://meet.google.com/"), null);
	assert.equal(getMeetingProviderNameFromUrl("https://zoom.us/pricing"), null);
	assert.equal(getMeetingProviderNameFromUrl("https://example.com/meet"), null);
	assert.equal(getMeetingProviderNameFromUrl("not a url"), null);
});

test("builds browser-specific active tab scripts", () => {
	assert.match(
		getBrowserActiveTabUrlScript("Safari"),
		/URL of current tab of front window/,
	);
	assert.match(
		getBrowserActiveTabUrlScript("Google Chrome"),
		/URL of active tab of front window/,
	);
});

test("normalizes source names", () => {
	assert.equal(normalizeMeetingDetectionSourceName(" Zoom "), "Zoom");
	assert.equal(normalizeMeetingDetectionSourceName(""), null);
	assert.equal(normalizeMeetingDetectionSourceName(null), null);
});

test("does not expose generic helper process names", async () => {
	assert.equal(await resolveNativeMeetingDetectionSourceName("helper"), null);
});
