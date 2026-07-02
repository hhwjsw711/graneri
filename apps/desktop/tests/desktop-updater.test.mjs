import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
	createDesktopUpdater,
	getDesktopUpdaterUnavailableTrayLabel,
	isDesktopUpdaterAvailable,
} from "../src/desktop-updater.mjs";

const createUpdaterHarness = ({
	available = true,
	messageBoxResponses = [],
} = {}) => {
	const autoUpdater = new EventEmitter();
	autoUpdater.emitAsync = async (eventName, ...args) => {
		for (const listener of autoUpdater.listeners(eventName)) {
			await listener(...args);
		}
	};
	const calls = {
		checkForUpdates: 0,
		quitAndInstall: 0,
		beforeInstall: 0,
		messages: [],
		progress: [],
		trayLabels: [],
	};

	autoUpdater.checkForUpdates = async () => {
		calls.checkForUpdates += 1;
	};
	autoUpdater.quitAndInstall = () => {
		calls.quitAndInstall += 1;
	};

	const updater = createDesktopUpdater({
		appVersion: () => "1.2.3",
		autoUpdater,
		isAvailable: () => available,
		onBeforeInstall: () => {
			calls.beforeInstall += 1;
		},
		setNativeProgress: (value) => {
			calls.progress.push(value);
		},
		setTrayStatusLabel: (value) => {
			calls.trayLabels.push(value);
		},
		showMessageBox: async (options) => {
			calls.messages.push(options);
			return messageBoxResponses.shift() ?? { response: 0 };
		},
	});

	return {
		autoUpdater,
		calls,
		updater,
	};
};

test("desktop updater reports unavailable updates without checking", async () => {
	const { calls, updater } = createUpdaterHarness({ available: false });

	await updater.checkForUpdates();
	await updater.checkForUpdatesQuietly();

	assert.equal(calls.checkForUpdates, 0);
	assert.deepEqual(calls.messages, [
		{
			message: "Updates are unavailable.",
			detail: "Updates are only available in packaged release builds.",
		},
	]);
});

test("desktop updater is available only for release builds with update metadata", () => {
	assert.equal(
		isDesktopUpdaterAvailable({
			hasReleaseUpdateConfig: true,
			isDisabled: false,
			isPackaged: true,
			platform: "darwin",
		}),
		true,
	);
	assert.equal(
		isDesktopUpdaterAvailable({
			hasReleaseUpdateConfig: false,
			isDisabled: false,
			isPackaged: true,
			platform: "darwin",
		}),
		false,
	);
	assert.equal(
		isDesktopUpdaterAvailable({
			hasReleaseUpdateConfig: true,
			isDisabled: true,
			isPackaged: true,
			platform: "darwin",
		}),
		false,
	);
	assert.equal(
		isDesktopUpdaterAvailable({
			hasReleaseUpdateConfig: true,
			isDisabled: false,
			isPackaged: false,
			platform: "darwin",
		}),
		false,
	);
});

test("desktop updater unavailable tray label distinguishes packaged local builds", () => {
	assert.equal(
		getDesktopUpdaterUnavailableTrayLabel({ isPackaged: false }),
		"Updates are unavailable in development builds",
	);
	assert.equal(
		getDesktopUpdaterUnavailableTrayLabel({ isPackaged: true }),
		"Updates are unavailable in this build",
	);
});

test("desktop updater blocks duplicate manual checks while checking", async () => {
	const { autoUpdater, calls, updater } = createUpdaterHarness();

	updater.configure();
	await autoUpdater.emitAsync("checking-for-update");
	await updater.checkForUpdates();

	assert.equal(calls.checkForUpdates, 0);
	assert.equal(calls.trayLabels.at(-1), "Checking for updates...");
	assert.deepEqual(calls.messages, [
		{
			message: "Graneri is already checking for updates.",
		},
	]);
});

test("desktop updater shows manual up-to-date result", async () => {
	const { autoUpdater, calls, updater } = createUpdaterHarness();

	updater.configure();
	await updater.checkForUpdates();
	await autoUpdater.emitAsync("update-not-available");

	assert.equal(calls.checkForUpdates, 1);
	assert.equal(calls.trayLabels.at(-1), "Graneri is up to date");
	assert.equal(calls.progress.at(-1), -1);
	assert.deepEqual(calls.messages, [
		{
			message: "You're up to date.",
			detail: "Graneri 1.2.3 is currently the newest version available.",
		},
	]);
});

test("desktop updater installs a downloaded update when confirmed", async () => {
	const { autoUpdater, calls, updater } = createUpdaterHarness({
		messageBoxResponses: [{ response: 1 }],
	});

	updater.configure();
	await autoUpdater.emitAsync("update-downloaded", { version: "2.0.0" });

	assert.equal(calls.trayLabels.at(-1), "Graneri 2.0.0 is ready to install");
	assert.equal(calls.progress.at(-1), -1);
	assert.equal(calls.beforeInstall, 1);
	assert.equal(calls.quitAndInstall, 1);
	assert.deepEqual(calls.messages, [
		{
			type: "question",
			message: "Graneri 2.0.0 has finished downloading.",
			detail: "Install now or keep working and update on quit.",
			buttons: ["Later", "Install and Restart"],
			defaultId: 1,
			cancelId: 0,
		},
	]);
});
