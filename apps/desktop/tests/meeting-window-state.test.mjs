import assert from "node:assert/strict";
import test from "node:test";
import {
	aggregateMeetingWindowState,
	createInactiveBrowserMeetingWindowState,
	createUnavailableMeetingWindowState,
	getMeetingWindowSourceName,
	normalizeMeetingWindowState,
} from "../src/meeting-window-state.mjs";

test("normalizes active meeting windows into the bridge state shape", () => {
	assert.deepEqual(
		normalizeMeetingWindowState({
			active: true,
			appName: " zoom.us ",
			bundleId: " us.zoom.xos ",
			permissionGranted: true,
			pid: 123,
			provider: " Zoom ",
			source: "accessibility",
			title: " Team Sync ",
		}),
		{
			appName: "zoom.us",
			bundleId: "us.zoom.xos",
			permissionGranted: true,
			pid: 123,
			provider: "Zoom",
			source: "accessibility",
			status: "active",
			title: "Team Sync",
		},
	);
});

test("prefers native active meeting windows over browser meeting windows", () => {
	const browserState = normalizeMeetingWindowState({
		active: true,
		appName: "Google Chrome",
		permissionGranted: true,
		provider: "Google Meet",
		source: "browser",
	});
	const nativeState = normalizeMeetingWindowState({
		active: true,
		appName: "zoom.us",
		permissionGranted: true,
		provider: "Zoom",
		source: "accessibility",
	});

	assert.deepEqual(
		aggregateMeetingWindowState({ browserState, nativeState }),
		nativeState,
	);
});

test("uses active browser meeting windows when native windows are unavailable", () => {
	const browserState = normalizeMeetingWindowState({
		active: true,
		appName: "Google Chrome",
		permissionGranted: true,
		provider: "Google Meet",
		source: "browser",
	});
	const nativeState = createUnavailableMeetingWindowState();

	assert.deepEqual(
		aggregateMeetingWindowState({ browserState, nativeState }),
		browserState,
	);
});

test("derives source names only from active meeting windows", () => {
	assert.equal(
		getMeetingWindowSourceName(
			normalizeMeetingWindowState({
				active: true,
				permissionGranted: true,
				provider: " Microsoft Teams ",
			}),
		),
		"Microsoft Teams",
	);
	assert.equal(
		getMeetingWindowSourceName(createInactiveBrowserMeetingWindowState()),
		null,
	);
});
