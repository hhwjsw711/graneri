import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopRecordingPowerSaveBlocker } from "../src/desktop-recording-power-save.mjs";

const createMockPowerSaveBlocker = () => {
	const activeIds = new Set();
	const calls = [];
	let nextId = 1;

	return {
		calls,
		isStarted: (id) => activeIds.has(id),
		start: (type) => {
			calls.push(["start", type]);
			const id = nextId++;
			activeIds.add(id);
			return id;
		},
		stop: (id) => {
			calls.push(["stop", id]);
			activeIds.delete(id);
		},
	};
};

const createBlocker = (powerSaveBlocker) =>
	createDesktopRecordingPowerSaveBlocker({
		logError: () => {},
		logInfo: () => {},
		powerSaveBlocker,
	});

test("recording power save blocker starts once and stops the active blocker", () => {
	const powerSaveBlocker = createMockPowerSaveBlocker();
	const blocker = createBlocker(powerSaveBlocker);

	assert.equal(blocker.start({ reason: "manual" }), 1);
	assert.equal(blocker.start({ reason: "reconnect" }), 1);
	assert.equal(blocker.isActive(), true);

	blocker.stop({ reason: "stop" });

	assert.equal(blocker.isActive(), false);
	assert.deepEqual(powerSaveBlocker.calls, [
		["start", "prevent-display-sleep"],
		["stop", 1],
	]);
});

test("recording power save blocker can restart after stop", () => {
	const powerSaveBlocker = createMockPowerSaveBlocker();
	const blocker = createBlocker(powerSaveBlocker);

	assert.equal(blocker.start({ reason: "manual" }), 1);
	blocker.stop({ reason: "stop" });
	assert.equal(blocker.start({ reason: "manual" }), 2);

	assert.deepEqual(powerSaveBlocker.calls, [
		["start", "prevent-display-sleep"],
		["stop", 1],
		["start", "prevent-display-sleep"],
	]);
});

test("recording power save blocker fails closed when Electron start throws", () => {
	const errors = [];
	const blocker = createDesktopRecordingPowerSaveBlocker({
		logError: (event) => errors.push(event),
		logInfo: () => {},
		powerSaveBlocker: {
			isStarted: () => false,
			start: () => {
				throw new Error("start failed");
			},
			stop: () => {},
		},
	});

	assert.equal(blocker.start({ reason: "manual" }), null);
	assert.equal(blocker.isActive(), false);
	assert.equal(errors.length, 1);
});
