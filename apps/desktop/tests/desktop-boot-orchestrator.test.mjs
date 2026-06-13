import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopBootOrchestrator } from "../src/desktop-boot-orchestrator.mjs";

const createEventEmitter = () => {
	const handlers = new Map();
	return {
		emit: async (eventName, ...args) => {
			const handler = handlers.get(eventName);
			return await handler?.(...args);
		},
		getHandler: (eventName) => handlers.get(eventName),
		on: (eventName, handler) => {
			handlers.set(eventName, handler);
		},
	};
};

const createApp = ({ singleInstanceLock = true } = {}) => {
	const emitter = createEventEmitter();
	let readyHandler = null;
	return {
		...emitter,
		requestSingleInstanceLock: () => singleInstanceLock,
		runReady: async () => {
			await readyHandler?.();
		},
		whenReady: () => ({
			then: (handler) => {
				readyHandler = handler;
			},
		}),
	};
};

const createOrchestratorHarness = (overrides = {}) => {
	const calls = [];
	const app = overrides.app ?? createApp();
	const powerMonitor = createEventEmitter();
	const getTranscriptionPhase =
		overrides.getTranscriptionPhase ?? (() => "idle");

	const record = (name, result) => async (...args) => {
		calls.push(args.length > 0 ? `${name}:${args.join(",")}` : name);
		return await result;
	};

	const orchestrator = createDesktopBootOrchestrator({
		app,
		applyDockIcon: () => calls.push("applyDockIcon"),
		checkForUpdatesQuietly: record("checkForUpdatesQuietly"),
		closeLocalServer: record("closeLocalServer"),
		configureUpdater: () => calls.push("configureUpdater"),
		confirmAndQuitCompletely: record("confirmAndQuitCompletely"),
		createMainWindow: record("createMainWindow"),
		createTray: () => calls.push("createTray"),
		ensureLocalServer: record("ensureLocalServer"),
		getExistingMainWindow:
			overrides.getExistingMainWindow ??
			(() => ({
				isVisible: () => true,
			})),
		getProtocolRegistrars: () => ["default", "renderer"],
		getTranscriptionPhase,
		isBypassingQuitConfirmation:
			overrides.isBypassingQuitConfirmation ?? (() => false),
		isKeepOpenInMenuBarEnabled:
			overrides.isKeepOpenInMenuBarEnabled ?? (() => true),
		isMeetingWidgetVisible: overrides.isMeetingWidgetVisible ?? (() => false),
		isUpdaterAvailable: overrides.isUpdaterAvailable ?? (() => false),
		loadDesktopNavigationState: record("loadDesktopNavigationState"),
		loadDesktopPreferences: record("loadDesktopPreferences"),
		loadTraySettings: record("loadTraySettings"),
		markQuitting: () => calls.push("markQuitting"),
		powerMonitor,
		processPlatform: overrides.processPlatform ?? "darwin",
		quitCompletely: () => calls.push("quitCompletely"),
		refreshApplicationMenu: () => calls.push("refreshApplicationMenu"),
		refreshTranscriptionPolicy: () => calls.push("refreshTranscriptionPolicy"),
		refreshTrayCalendar: () => calls.push("refreshTrayCalendar"),
		registerDesktopAppProtocols: ({ protocolRegistrars }) => {
			calls.push(`registerDesktopAppProtocols:${protocolRegistrars.join(",")}`);
		},
		rendererDistDir: "/renderer",
		setTrayStatusLabel: (label) => calls.push(`setTrayStatusLabel:${label}`),
		showMainWindow: record("showMainWindow"),
		startMeetingDetectionMonitors: record("startMeetingDetectionMonitors"),
		stopDesktopTranscriptionSession: record("stopDesktopTranscriptionSession"),
		stopMeetingDetectionMonitors: record("stopMeetingDetectionMonitors"),
		stopMicrophoneCapture: record("stopMicrophoneCapture"),
		stopRealtimeTransport: record("stopRealtimeTransport"),
		stopSystemAudioCapture: record("stopSystemAudioCapture"),
	});

	return {
		app,
		calls,
		orchestrator,
		powerMonitor,
	};
};

test("desktop boot orchestrator quits when another instance owns the lock", () => {
	const app = createApp({ singleInstanceLock: false });
	const { calls, orchestrator } = createOrchestratorHarness({ app });

	orchestrator.start();

	assert.deepEqual(calls, ["quitCompletely"]);
	assert.equal(app.getHandler("second-instance"), undefined);
});

test("desktop boot orchestrator runs ready lifecycle in order", async () => {
	const { app, calls, orchestrator } = createOrchestratorHarness({
		isUpdaterAvailable: () => true,
	});

	orchestrator.start();
	await app.runReady();

	assert.deepEqual(calls, [
		"refreshTranscriptionPolicy",
		"refreshApplicationMenu",
		"registerDesktopAppProtocols:default,renderer",
		"applyDockIcon",
		"loadDesktopPreferences",
		"loadTraySettings",
		"loadDesktopNavigationState",
		"ensureLocalServer",
		"createMainWindow",
		"createTray",
		"refreshTrayCalendar",
		"configureUpdater",
		"startMeetingDetectionMonitors",
		"setTrayStatusLabel:Checking for updates...",
		"checkForUpdatesQuietly",
	]);
});

test("desktop boot orchestrator shows the main window for a second instance", async () => {
	const { app, calls, orchestrator } = createOrchestratorHarness();

	orchestrator.start();
	await app.emit("second-instance");

	assert.deepEqual(calls, ["showMainWindow"]);
});

test("desktop boot orchestrator stops transcription on suspend only while active", async () => {
	const { app, calls, orchestrator, powerMonitor } = createOrchestratorHarness({
		getTranscriptionPhase: () => "listening",
	});

	orchestrator.start();
	await app.runReady();
	calls.length = 0;
	await powerMonitor.emit("suspend");

	assert.deepEqual(calls, ["stopDesktopTranscriptionSession:[object Object]"]);
});

test("desktop boot orchestrator cleans runtime on window-all-closed", async () => {
	const { app, calls, orchestrator } = createOrchestratorHarness({
		isKeepOpenInMenuBarEnabled: () => false,
	});

	orchestrator.start();
	await app.emit("window-all-closed");

	assert.deepEqual(calls, [
		"stopRealtimeTransport:you",
		"stopRealtimeTransport:them",
		"stopMeetingDetectionMonitors",
		"stopMicrophoneCapture",
		"stopSystemAudioCapture",
		"closeLocalServer",
		"quitCompletely",
	]);
});

test("desktop boot orchestrator confirms quit before macOS quit", async () => {
	const { app, calls, orchestrator } = createOrchestratorHarness();
	let didPreventDefault = false;

	orchestrator.start();
	await app.emit("before-quit", {
		preventDefault: () => {
			didPreventDefault = true;
		},
	});

	assert.equal(didPreventDefault, true);
	assert.deepEqual(calls, ["confirmAndQuitCompletely"]);
});
