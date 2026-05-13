const channels = {
	microphoneCaptureEvent: "app:microphone-capture-event",
	systemAudioCaptureEvent: "app:system-audio-capture-event",
	transcriptionSessionState: "app:transcription-session-state",
	transcriptionSessionEvent: "app:transcription-session-event",
	meetingDetectionState: "app:meeting-detection-state",
	desktopNavigation: "app:navigate",
};

const subscribe = (ipcRenderer, channel, listener) => {
	const handler = (_event, payload) => {
		listener(payload);
	};

	ipcRenderer.on(channel, handler);

	return () => {
		ipcRenderer.removeListener(channel, handler);
	};
};

const shouldExposeTestHooks = (env) =>
	env.NODE_ENV !== "production" || env.OPENGRAN_ENABLE_TEST_HOOKS === "1";

const createOpenGranDesktopApi = ({ ipcRenderer, platform, env }) => ({
	platform,
	getMeta: () => ipcRenderer.invoke("app:get-meta"),
	getRuntimeConfig: () => ipcRenderer.invoke("app:get-runtime-config"),
	authFetch: (request) => ipcRenderer.invoke("app:auth-fetch", request),
	getPermissionsStatus: () => ipcRenderer.invoke("app:get-permissions-status"),
	getPreferences: () => ipcRenderer.invoke("app:get-preferences"),
	setNativeTheme: (themeSource) =>
		ipcRenderer.invoke("app:set-native-theme", themeSource),
	getAuthCallbackUrl: () => ipcRenderer.invoke("app:get-auth-callback-url"),
	getShareBaseUrl: () => ipcRenderer.invoke("app:get-share-base-url"),
	setActiveWorkspaceId: (workspaceId) =>
		ipcRenderer.invoke("app:set-active-workspace-id", workspaceId),
	setActiveWorkspaceNotificationPreferences: (payload) =>
		ipcRenderer.invoke(
			"app:set-active-workspace-notification-preferences",
			payload,
		),
	openExternalUrl: (url) => ipcRenderer.invoke("app:open-external-url", url),
	requestPermission: (permissionId) =>
		ipcRenderer.invoke("app:request-permission", permissionId),
	openPermissionSettings: (permissionId) =>
		ipcRenderer.invoke("app:open-permission-settings", permissionId),
	openSoundSettings: () => ipcRenderer.invoke("app:open-sound-settings"),
	setLaunchAtLogin: (enabled) =>
		ipcRenderer.invoke("app:set-launch-at-login", enabled),
	getTranscriptionSessionState: () =>
		ipcRenderer.invoke("app:get-transcription-session-state"),
	getMeetingDetectionState: () =>
		ipcRenderer.invoke("app:get-meeting-detection-state"),
	configureTranscriptionSession: (options) =>
		ipcRenderer.invoke("app:configure-transcription-session", options),
	startTranscriptionSession: () =>
		ipcRenderer.invoke("app:start-transcription-session"),
	stopTranscriptionSession: () =>
		ipcRenderer.invoke("app:stop-transcription-session"),
	requestTranscriptionSystemAudio: () =>
		ipcRenderer.invoke("app:request-transcription-system-audio"),
	detachTranscriptionSystemAudio: () =>
		ipcRenderer.invoke("app:detach-transcription-system-audio"),
	startDetectedMeetingNote: () =>
		ipcRenderer.invoke("app:start-detected-meeting-note"),
	dismissDetectedMeetingWidget: () =>
		ipcRenderer.invoke("app:dismiss-detected-meeting-widget"),
	reportMeetingWidgetSize: (size) =>
		ipcRenderer.send("app:report-meeting-widget-size", size),
	test: shouldExposeTestHooks(env)
		? {
				showMeetingWidget: () =>
					ipcRenderer.invoke("app:test-show-meeting-widget"),
				resetMeetingDetection: () =>
					ipcRenderer.invoke("app:test-reset-meeting-detection"),
			}
		: undefined,
	onTranscriptionSessionState: (listener) =>
		subscribe(ipcRenderer, channels.transcriptionSessionState, listener),
	onTranscriptionSessionEvent: (listener) =>
		subscribe(ipcRenderer, channels.transcriptionSessionEvent, listener),
	onMeetingDetectionState: (listener) =>
		subscribe(ipcRenderer, channels.meetingDetectionState, listener),
	onNavigate: (listener) =>
		subscribe(ipcRenderer, channels.desktopNavigation, listener),
	startSystemAudioCapture: () =>
		ipcRenderer.invoke("app:start-system-audio-capture"),
	stopSystemAudioCapture: () =>
		ipcRenderer.invoke("app:stop-system-audio-capture"),
	startMicrophoneCapture: () =>
		ipcRenderer.invoke("app:start-microphone-capture"),
	stopMicrophoneCapture: () =>
		ipcRenderer.invoke("app:stop-microphone-capture"),
	onMicrophoneCaptureEvent: (listener) =>
		subscribe(ipcRenderer, channels.microphoneCaptureEvent, listener),
	onSystemAudioCaptureEvent: (listener) =>
		subscribe(ipcRenderer, channels.systemAudioCaptureEvent, listener),
	writeClipboardText: (value) =>
		ipcRenderer.invoke("app:write-clipboard-text", value),
	writeClipboardRichText: (payload) =>
		ipcRenderer.invoke("app:write-clipboard-rich-text", payload),
	loadTranscriptDraft: (noteKey) =>
		ipcRenderer.invoke("app:load-transcript-draft", noteKey),
	saveTranscriptDraft: (noteKey, draft) =>
		ipcRenderer.invoke("app:save-transcript-draft", noteKey, draft),
	clearTranscriptDraft: (noteKey) =>
		ipcRenderer.invoke("app:clear-transcript-draft", noteKey),
	loadNoteDraft: (noteKey) =>
		ipcRenderer.invoke("app:load-note-draft", noteKey),
	saveNoteDraft: (noteKey, draft) =>
		ipcRenderer.invoke("app:save-note-draft", noteKey, draft),
	clearNoteDraft: (noteKey) =>
		ipcRenderer.invoke("app:clear-note-draft", noteKey),
	saveTextFile: (defaultFileName, content) =>
		ipcRenderer.invoke("app:save-text-file", defaultFileName, content),
});

module.exports = {
	channels,
	createOpenGranDesktopApi,
	shouldExposeTestHooks,
};
