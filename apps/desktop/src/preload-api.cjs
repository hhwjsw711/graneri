const channels = {
	microphoneCaptureEvent: "app:microphone-capture-event",
	systemAudioCaptureEvent: "app:system-audio-capture-event",
	transcriptionSessionState: "app:transcription-session-state",
	transcriptionSessionEvent: "app:transcription-session-event",
	meetingDetectionState: "app:meeting-detection-state",
	desktopNavigation: "app:navigate",
};

const invokeChannels = {
	authFetch: "app:auth-fetch",
	clearNoteDraft: "app:clear-note-draft",
	clearTranscriptDraft: "app:clear-transcript-draft",
	configureTranscriptionSession: "app:configure-transcription-session",
	detachTranscriptionSystemAudio: "app:detach-transcription-system-audio",
	dismissDetectedMeetingWidget: "app:dismiss-detected-meeting-widget",
	getAuthCallbackUrl: "app:get-auth-callback-url",
	getMeetingDetectionState: "app:get-meeting-detection-state",
	getMeta: "app:get-meta",
	getPermissionsStatus: "app:get-permissions-status",
	getPreferences: "app:get-preferences",
	getRuntimeConfig: "app:get-runtime-config",
	getShareBaseUrl: "app:get-share-base-url",
	getTranscriptionSessionState: "app:get-transcription-session-state",
	loadNoteDraft: "app:load-note-draft",
	loadTranscriptDraft: "app:load-transcript-draft",
	openExternalUrl: "app:open-external-url",
	openPermissionSettings: "app:open-permission-settings",
	openSoundSettings: "app:open-sound-settings",
	refreshTrayCalendar: "app:refresh-tray-calendar",
	requestPermission: "app:request-permission",
	requestTranscriptionSystemAudio: "app:request-transcription-system-audio",
	saveNoteDraft: "app:save-note-draft",
	saveTextFile: "app:save-text-file",
	saveTranscriptDraft: "app:save-transcript-draft",
	setActiveWorkspaceId: "app:set-active-workspace-id",
	setActiveWorkspaceNotificationPreferences:
		"app:set-active-workspace-notification-preferences",
	setKeepDictationBarVisible: "app:set-keep-dictation-bar-visible",
	setLaunchAtLogin: "app:set-launch-at-login",
	setNativeTheme: "app:set-native-theme",
	setTrayCalendarState: "app:set-tray-calendar-state",
	shareLocalFolders: "app:share-local-folders",
	startDetectedMeetingNote: "app:start-detected-meeting-note",
	startMicrophoneCapture: "app:start-microphone-capture",
	startSystemAudioCapture: "app:start-system-audio-capture",
	startTranscriptionSession: "app:start-transcription-session",
	stopMicrophoneCapture: "app:stop-microphone-capture",
	stopSystemAudioCapture: "app:stop-system-audio-capture",
	stopTranscriptionSession: "app:stop-transcription-session",
	testGetTrayCalendarState: "app:test-get-tray-calendar-state",
	testResetMeetingDetection: "app:test-reset-meeting-detection",
	testShowMeetingWidget: "app:test-show-meeting-widget",
	writeClipboardRichText: "app:write-clipboard-rich-text",
	writeClipboardText: "app:write-clipboard-text",
};

const sendChannels = {
	reportMeetingWidgetSize: "app:report-meeting-widget-size",
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
	env.NODE_ENV !== "production" || env.GRANERI_ENABLE_TEST_HOOKS === "1";

const createGraneriDesktopApi = ({ ipcRenderer, platform, env }) => ({
	platform,
	getMeta: () => ipcRenderer.invoke(invokeChannels.getMeta),
	getRuntimeConfig: () => ipcRenderer.invoke(invokeChannels.getRuntimeConfig),
	authFetch: (request) => ipcRenderer.invoke(invokeChannels.authFetch, request),
	getPermissionsStatus: () =>
		ipcRenderer.invoke(invokeChannels.getPermissionsStatus),
	getPreferences: () => ipcRenderer.invoke(invokeChannels.getPreferences),
	setNativeTheme: (themeSource) =>
		ipcRenderer.invoke(invokeChannels.setNativeTheme, themeSource),
	getAuthCallbackUrl: () =>
		ipcRenderer.invoke(invokeChannels.getAuthCallbackUrl),
	getShareBaseUrl: () => ipcRenderer.invoke(invokeChannels.getShareBaseUrl),
	setActiveWorkspaceId: (workspaceId) =>
		ipcRenderer.invoke(invokeChannels.setActiveWorkspaceId, workspaceId),
	setActiveWorkspaceNotificationPreferences: (payload) =>
		ipcRenderer.invoke(
			invokeChannels.setActiveWorkspaceNotificationPreferences,
			payload,
		),
	refreshTrayCalendar: () =>
		ipcRenderer.invoke(invokeChannels.refreshTrayCalendar),
	setTrayCalendarState: (payload) =>
		ipcRenderer.invoke(invokeChannels.setTrayCalendarState, payload),
	openExternalUrl: (url) =>
		ipcRenderer.invoke(invokeChannels.openExternalUrl, url),
	requestPermission: (permissionId) =>
		ipcRenderer.invoke(invokeChannels.requestPermission, permissionId),
	openPermissionSettings: (permissionId) =>
		ipcRenderer.invoke(invokeChannels.openPermissionSettings, permissionId),
	openSoundSettings: () => ipcRenderer.invoke(invokeChannels.openSoundSettings),
	setLaunchAtLogin: (enabled) =>
		ipcRenderer.invoke(invokeChannels.setLaunchAtLogin, enabled),
	setKeepDictationBarVisible: (enabled) =>
		ipcRenderer.invoke(invokeChannels.setKeepDictationBarVisible, enabled),
	getTranscriptionSessionState: () =>
		ipcRenderer.invoke(invokeChannels.getTranscriptionSessionState),
	getMeetingDetectionState: () =>
		ipcRenderer.invoke(invokeChannels.getMeetingDetectionState),
	configureTranscriptionSession: (options) =>
		ipcRenderer.invoke(invokeChannels.configureTranscriptionSession, options),
	startTranscriptionSession: () =>
		ipcRenderer.invoke(invokeChannels.startTranscriptionSession),
	stopTranscriptionSession: (options) =>
		ipcRenderer.invoke(invokeChannels.stopTranscriptionSession, options),
	requestTranscriptionSystemAudio: () =>
		ipcRenderer.invoke(invokeChannels.requestTranscriptionSystemAudio),
	detachTranscriptionSystemAudio: () =>
		ipcRenderer.invoke(invokeChannels.detachTranscriptionSystemAudio),
	startDetectedMeetingNote: () =>
		ipcRenderer.invoke(invokeChannels.startDetectedMeetingNote),
	dismissDetectedMeetingWidget: () =>
		ipcRenderer.invoke(invokeChannels.dismissDetectedMeetingWidget),
	reportMeetingWidgetSize: (size) =>
		ipcRenderer.send(sendChannels.reportMeetingWidgetSize, size),
	test: shouldExposeTestHooks(env)
		? {
				showMeetingWidget: () =>
					ipcRenderer.invoke(invokeChannels.testShowMeetingWidget),
				resetMeetingDetection: () =>
					ipcRenderer.invoke(invokeChannels.testResetMeetingDetection),
				getTrayCalendarState: () =>
					ipcRenderer.invoke(invokeChannels.testGetTrayCalendarState),
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
		ipcRenderer.invoke(invokeChannels.startSystemAudioCapture),
	stopSystemAudioCapture: () =>
		ipcRenderer.invoke(invokeChannels.stopSystemAudioCapture),
	startMicrophoneCapture: () =>
		ipcRenderer.invoke(invokeChannels.startMicrophoneCapture),
	stopMicrophoneCapture: () =>
		ipcRenderer.invoke(invokeChannels.stopMicrophoneCapture),
	onMicrophoneCaptureEvent: (listener) =>
		subscribe(ipcRenderer, channels.microphoneCaptureEvent, listener),
	onSystemAudioCaptureEvent: (listener) =>
		subscribe(ipcRenderer, channels.systemAudioCaptureEvent, listener),
	writeClipboardText: (value) =>
		ipcRenderer.invoke(invokeChannels.writeClipboardText, value),
	writeClipboardRichText: (payload) =>
		ipcRenderer.invoke(invokeChannels.writeClipboardRichText, payload),
	loadTranscriptDraft: (noteKey) =>
		ipcRenderer.invoke(invokeChannels.loadTranscriptDraft, noteKey),
	saveTranscriptDraft: (noteKey, draft) =>
		ipcRenderer.invoke(invokeChannels.saveTranscriptDraft, noteKey, draft),
	clearTranscriptDraft: (noteKey) =>
		ipcRenderer.invoke(invokeChannels.clearTranscriptDraft, noteKey),
	loadNoteDraft: (noteKey) =>
		ipcRenderer.invoke(invokeChannels.loadNoteDraft, noteKey),
	saveNoteDraft: (noteKey, draft) =>
		ipcRenderer.invoke(invokeChannels.saveNoteDraft, noteKey, draft),
	clearNoteDraft: (noteKey) =>
		ipcRenderer.invoke(invokeChannels.clearNoteDraft, noteKey),
	shareLocalFolders: (paths) =>
		ipcRenderer.invoke(invokeChannels.shareLocalFolders, paths),
	saveTextFile: (defaultFileName, content) =>
		ipcRenderer.invoke(invokeChannels.saveTextFile, defaultFileName, content),
});

module.exports = {
	channels,
	createGraneriDesktopApi,
	invokeChannels,
	sendChannels,
	shouldExposeTestHooks,
};
