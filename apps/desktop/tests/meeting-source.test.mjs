import assert from "node:assert/strict";
import test from "node:test";
import {
	detectActiveBrowserMeetingWindowState,
	getBrowserActiveTabUrlScript,
} from "../src/browser-meeting-source.mjs";
import { getMeetingProviderNameFromUrl } from "../src/meeting-provider-url.mjs";
import {
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
		getMeetingProviderNameFromUrl("https://foo.zoom.us/wc/123/start"),
		"Zoom",
	);
	assert.equal(
		getMeetingProviderNameFromUrl("https://telemost.yandex.ru/j/1111111111"),
		"Yandex Telemost",
	);
	assert.equal(
		getMeetingProviderNameFromUrl(
			"https://telemost.360.yandex.ru/j/1111111111",
		),
		"Yandex Telemost",
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
	assert.equal(getMeetingProviderNameFromUrl("https://telemost.yandex.ru/"), null);
	assert.equal(
		getMeetingProviderNameFromUrl("https://telemost.360.yandex.ru/profile"),
		null,
	);
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

test("resolves native source names from bundle identifiers", async () => {
	assert.equal(
		await resolveNativeMeetingDetectionSourceName({
			bundleId: "us.zoom.xos",
			name: "ZoomOpener",
		}),
		"Zoom",
	);
	assert.equal(
		await resolveNativeMeetingDetectionSourceName({
			bundleId: "com.tinyspeck.slackmacgap",
			name: "Slack Helper",
		}),
		"Slack Huddle",
	);
	assert.equal(
		await resolveNativeMeetingDetectionSourceName({
			bundleId: "com.hnc.discord",
			name: "Discord Helper",
		}),
		"Discord",
	);
});

test("does not expose generic helper process names", async () => {
	assert.equal(
		await resolveNativeMeetingDetectionSourceName("helper", {
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async () => ({ ok: true, value: null }),
		}),
		null,
	);
});

test("resolves generic helper process names through active browser meetings", async () => {
	assert.equal(
		await resolveNativeMeetingDetectionSourceName("helper", {
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async () => ({
				ok: true,
				value: "https://meet.google.com/abc-defg-hij",
			}),
		}),
		"Google Meet",
	);
});

test("ignores browser app labels when provider URL is unknown", async () => {
	assert.equal(
		await resolveNativeMeetingDetectionSourceName("Google Chrome", {
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async () => ({ ok: true, value: "https://example.com" }),
		}),
		null,
	);
});

test("resolves Firefox browser meetings when Firefox is running", async () => {
	assert.equal(
		await resolveNativeMeetingDetectionSourceName("Firefox", {
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async () => ({
				ok: true,
				value: "https://meet.google.com/abc-defg-hij",
			}),
		}),
		"Google Meet",
	);
});

test("ignores unknown microphone source names", async () => {
	assert.equal(
		await resolveNativeMeetingDetectionSourceName("Unknown Recorder"),
		null,
	);
});

test("detects browser-hosted meeting windows", async () => {
	assert.deepEqual(
		await detectActiveBrowserMeetingWindowState({
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async (script) =>
				script.includes("Google Chrome")
					? { ok: true, value: "https://meet.google.com/abc-defg-hij" }
					: { ok: true, value: null },
		}),
		{
			active: true,
			appName: "Google Chrome",
			bundleId: null,
			pid: null,
			permissionGranted: true,
			provider: "Google Meet",
			source: "browser",
			title: "Google Chrome:Google Meet",
		},
	);
});

test("does not AppleScript browsers that are not running", async () => {
	let appleScriptCalls = 0;

	assert.deepEqual(
		await detectActiveBrowserMeetingWindowState({
			isBrowserAppRunningImpl: async () => false,
			runAppleScriptImpl: async () => {
				appleScriptCalls += 1;
				return { ok: true, value: "https://meet.google.com/abc-defg-hij" };
			},
		}),
		{
			active: false,
			permissionGranted: true,
			source: "browser",
		},
	);
	assert.equal(appleScriptCalls, 0);
});

test("reports unavailable browser meeting state when browser queries fail", async () => {
	assert.deepEqual(
		await detectActiveBrowserMeetingWindowState({
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async () => ({ ok: false, value: null }),
		}),
		{
			active: false,
			permissionGranted: false,
			source: "browser",
		},
	);
});

test("reports inactive browser meeting state when no browser tab is a meeting", async () => {
	assert.deepEqual(
		await detectActiveBrowserMeetingWindowState({
			isBrowserAppRunningImpl: async () => true,
			runAppleScriptImpl: async () => ({ ok: true, value: "https://example.com" }),
		}),
		{
			active: false,
			permissionGranted: true,
			source: "browser",
		},
	);
});
