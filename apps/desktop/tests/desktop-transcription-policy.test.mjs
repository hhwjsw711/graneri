import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopSystemAudioPolicy } from "../src/desktop-transcription-policy.mjs";

test("darwin system audio prompt state still auto-bootstraps when helper exists", () => {
	const policy = createDesktopSystemAudioPolicy({
		helperPath: "/Graneri.app/Contents/Resources/app/bin/graneri-system-audio-helper",
		permissionState: "prompt",
		platform: "darwin",
	});

	assert.deepEqual(policy, {
		platform: "desktop",
		systemAudioCapability: {
			isSupported: true,
			shouldAutoBootstrap: true,
			sourceMode: "desktop-native",
		},
	});
});

test("darwin system audio blocked state disables auto-bootstrap", () => {
	const policy = createDesktopSystemAudioPolicy({
		helperPath: "/Graneri.app/Contents/Resources/app/bin/graneri-system-audio-helper",
		permissionState: "blocked",
		platform: "darwin",
	});

	assert.deepEqual(policy, {
		platform: "desktop",
		systemAudioCapability: {
			isSupported: false,
			shouldAutoBootstrap: false,
			sourceMode: "unsupported",
		},
	});
});

test("darwin system audio without helper is unsupported", () => {
	const policy = createDesktopSystemAudioPolicy({
		helperPath: null,
		permissionState: "prompt",
		platform: "darwin",
	});

	assert.deepEqual(policy, {
		platform: "desktop",
		systemAudioCapability: {
			isSupported: false,
			shouldAutoBootstrap: false,
			sourceMode: "unsupported",
		},
	});
});
