const assert = require("node:assert/strict");
const test = require("node:test");
const {
	channels,
	createGraneriDesktopApi,
	shouldExposeTestHooks,
} = require("../src/preload-api.cjs");

const createIpcRenderer = () => {
	const listeners = new Map();
	const ipcRenderer = {
		invocations: [],
		sends: [],
		removedListeners: [],
		invoke(channel, ...args) {
			this.invocations.push({ args, channel });
			return Promise.resolve({ args, channel });
		},
		send(channel, ...args) {
			this.sends.push({ args, channel });
		},
		on(channel, handler) {
			listeners.set(channel, handler);
		},
		removeListener(channel, handler) {
			this.removedListeners.push({ channel, handler });
			if (listeners.get(channel) === handler) {
				listeners.delete(channel);
			}
		},
		emit(channel, payload) {
			const handler = listeners.get(channel);
			assert.equal(typeof handler, "function");
			handler({ sender: "test" }, payload);
		},
		getListener(channel) {
			return listeners.get(channel);
		},
	};

	return ipcRenderer;
};

const createApi = (options = {}) => {
	const ipcRenderer = createIpcRenderer();
	const api = createGraneriDesktopApi({
		env: options.env ?? { NODE_ENV: "test" },
		ipcRenderer,
		platform: options.platform ?? "darwin",
	});

	return { api, ipcRenderer };
};

test("maps invoke bridge calls to their IPC channels and arguments", async () => {
	const { api, ipcRenderer } = createApi();
	const request = { method: "POST", path: "/api/auth/session" };
	const preferences = {
		notifyForAutoDetectedMeetings: false,
		notifyForScheduledMeetings: true,
		workspaceId: "workspace_1",
	};
	const transcriptDraft = {
		liveTranscript: {
			them: { speaker: "them", startedAt: null, text: "" },
			you: { speaker: "you", startedAt: 1, text: "hello" },
		},
		pendingGenerateTranscript: "",
		utterances: [],
	};
	const noteDraft = {
		workspaceId: "workspace_1",
		title: "Draft title",
		content: "{}",
		searchableText: "Draft title",
	};

	await api.getMeta();
	await api.authFetch(request);
	await api.setActiveWorkspaceNotificationPreferences(preferences);
	await api.configureTranscriptionSession({
		autoStartKey: "meeting_1",
		lang: "en",
		scopeKey: "note_1",
	});
	await api.startDetectedMeetingNote();
	await api.saveTranscriptDraft("note_1", transcriptDraft);
	await api.saveNoteDraft("note_1", noteDraft);
	await api.shareLocalFolders(["/Users/test/Documents/project"]);
	await api.saveTextFile("meeting.txt", "notes");

	assert.deepEqual(ipcRenderer.invocations, [
		{ args: [], channel: "app:get-meta" },
		{ args: [request], channel: "app:auth-fetch" },
		{
			args: [preferences],
			channel: "app:set-active-workspace-notification-preferences",
		},
		{
			args: [{ autoStartKey: "meeting_1", lang: "en", scopeKey: "note_1" }],
			channel: "app:configure-transcription-session",
		},
		{ args: [], channel: "app:start-detected-meeting-note" },
		{
			args: ["note_1", transcriptDraft],
			channel: "app:save-transcript-draft",
		},
		{
			args: ["note_1", noteDraft],
			channel: "app:save-note-draft",
		},
		{
			args: [["/Users/test/Documents/project"]],
			channel: "app:share-local-folders",
		},
		{ args: ["meeting.txt", "notes"], channel: "app:save-text-file" },
	]);
});

test("maps send bridge calls to their IPC channels and arguments", () => {
	const { api, ipcRenderer } = createApi();

	api.reportMeetingWidgetSize({ height: 480, width: 320 });

	assert.deepEqual(ipcRenderer.sends, [
		{
			args: [{ height: 480, width: 320 }],
			channel: "app:report-meeting-widget-size",
		},
	]);
});

test("forwards subscription payloads and removes the same handler on cleanup", () => {
	const { api, ipcRenderer } = createApi();
	const payload = { status: "prompting" };
	const received = [];

	const unsubscribe = api.onMeetingDetectionState((state) => {
		received.push(state);
	});
	const registeredHandler = ipcRenderer.getListener(
		channels.meetingDetectionState,
	);

	ipcRenderer.emit(channels.meetingDetectionState, payload);
	unsubscribe();

	assert.deepEqual(received, [payload]);
	assert.deepEqual(ipcRenderer.removedListeners, [
		{
			channel: channels.meetingDetectionState,
			handler: registeredHandler,
		},
	]);
	assert.equal(
		ipcRenderer.getListener(channels.meetingDetectionState),
		undefined,
	);
});

test("wires native audio and navigation subscriptions to dedicated channels", () => {
	const { api, ipcRenderer } = createApi();
	const navigationPayload = {
		hash: "#meeting",
		pathname: "/notes",
		search: "?id=note_1",
	};
	const capturePayload = { pcm16: "AAAA", type: "chunk" };
	const received = [];

	const unsubscribeNavigate = api.onNavigate((payload) => {
		received.push(payload);
	});
	const unsubscribeCapture = api.onSystemAudioCaptureEvent((payload) => {
		received.push(payload);
	});

	ipcRenderer.emit(channels.desktopNavigation, navigationPayload);
	ipcRenderer.emit(channels.systemAudioCaptureEvent, capturePayload);
	unsubscribeNavigate();
	unsubscribeCapture();

	assert.deepEqual(received, [navigationPayload, capturePayload]);
	assert.equal(ipcRenderer.removedListeners.length, 2);
	assert.equal(
		ipcRenderer.removedListeners[0].channel,
		channels.desktopNavigation,
	);
	assert.equal(
		ipcRenderer.removedListeners[1].channel,
		channels.systemAudioCaptureEvent,
	);
});

test("exposes desktop test hooks only outside production unless explicitly enabled", async () => {
	assert.equal(shouldExposeTestHooks({ NODE_ENV: "production" }), false);
	assert.equal(
		shouldExposeTestHooks({
			NODE_ENV: "production",
			GRANERI_ENABLE_TEST_HOOKS: "1",
		}),
		true,
	);

	const productionApi = createApi({ env: { NODE_ENV: "production" } }).api;
	assert.equal(productionApi.test, undefined);

	const { api, ipcRenderer } = createApi({
		env: { NODE_ENV: "production", GRANERI_ENABLE_TEST_HOOKS: "1" },
	});

	await api.test.showMeetingWidget();
	await api.test.resetMeetingDetection();

	assert.deepEqual(ipcRenderer.invocations, [
		{ args: [], channel: "app:test-show-meeting-widget" },
		{ args: [], channel: "app:test-reset-meeting-detection" },
	]);
});
