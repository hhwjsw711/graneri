import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import {
	app,
	BrowserWindow,
	clipboard,
	desktopCapturer,
	dialog,
	Notification as ElectronNotification,
	ipcMain,
	Menu,
	nativeImage,
	nativeTheme,
	powerMonitor,
	screen,
	shell,
	systemPreferences,
	Tray,
} from "electron";
import electronUpdater from "electron-updater";
import WebSocket from "ws";
import { api } from "../../../convex/_generated/api.js";
import { createPcm16Resampler } from "../../../packages/ai/src/pcm16-resampler.mjs";
import {
	createDesktopRealtimeTranscriptionSession,
	isLowConfidenceTranscriptLogprobs,
	isTranscriptPlaceholderText,
	normalizeTranscriptionLanguage,
	resolveDesktopRealtimeProfile,
	shouldKeepInterruptedTranscriptTurn,
	summarizeTranscriptConfidence,
} from "../../../packages/ai/src/transcription.mjs";
import { getDesktopAuthClient } from "./auth-client.mjs";
import { loadRootEnv } from "./env.mjs";
import { startLocalServer } from "./local-server.mjs";
import { resolveNativeMeetingDetectionSourceName } from "./meeting-source.mjs";
import { toErrorLogDetails } from "./network.mjs";
import { getRuntimeConfig, hydrateRuntimeConfig } from "./runtime-config.mjs";

const { autoUpdater } = electronUpdater;

app.setName("OpenGran");
loadRootEnv({
	includeWorkingDirectory:
		app.isPackaged !== true ||
		process.env.OPENGRAN_ENV_MODE?.trim() !== "production",
});
await hydrateRuntimeConfig();

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const trayIconPath = join(runtimeDir, "assets", "OpenGranTemplate.png");
const dockIconPath = join(runtimeDir, "assets", "OpenGranDock.png");
const traySettingsPath = join(app.getPath("userData"), "tray-settings.json");
const lastNavigationPath = join(
	app.getPath("userData"),
	"last-navigation.json",
);
const transcriptDraftsDirPath = join(
	app.getPath("userData"),
	"transcript-drafts",
);
const noteDraftsDirPath = join(app.getPath("userData"), "note-drafts");
const microphoneCaptureEventChannel = "app:microphone-capture-event";
const systemAudioCaptureEventChannel = "app:system-audio-capture-event";
const transcriptionSessionStateChannel = "app:transcription-session-state";
const transcriptionSessionEventChannel = "app:transcription-session-event";
const meetingDetectionStateChannel = "app:meeting-detection-state";
const desktopNavigationChannel = "app:navigate";
const captureHealthTimeoutMs = 3_000;
const desktopRealtimeConnectTimeoutMs = 10_000;
const desktopRealtimePendingAudioChunkLimit = 50;
const desktopRealtimeStopFlushTimeoutMs = 1_500;
const desktopRealtimeStopFlushSettleTimeoutMs = 750;
const maxRecoveryAttempts = 3;
const recoveryBackoffMs = [750, 1_500, 3_000];
const systemAudioAttachRetryBackoffMs = [750, 1_500, 3_000];
const realtimeSessionRolloverMs = 29 * 60 * 1000;
const transcriptDraftStorageVersion = 1;
const transcriptDraftMaxAgeMs = 72 * 60 * 60 * 1000;
const noteDraftStorageVersion = 1;
const noteDraftMaxAgeMs = 72 * 60 * 60 * 1000;
const maxSharedLocalFolders = 12;
const meetingDetectionDebounceMs = 8_000;
const meetingDetectionDismissMs = 30 * 60 * 1000;
const meetingWidgetAutoHideMs = 12 * 1000;
const scheduledMeetingNotificationLeadTimeMs = 5 * 60 * 1000;
const trayCalendarActiveRefreshMs = 60 * 1000;
const trayCalendarIdleRefreshMs = 5 * 60 * 1000;
const trayCalendarUnavailableRefreshMs = 15 * 60 * 1000;
const trayCalendarUpcomingRefreshWindowMs = 30 * 60 * 1000;
const trayCalendarMenuEventLimit = 5;
const shouldLogDesktopTurnDebug =
	app.isPackaged !== true ||
	process.env.OPENGRAN_ENABLE_TRANSCRIPTION_DEBUG === "1";
const transcriptionDebugLogPath = join(
	app.getPath("temp"),
	"opengran-transcription-debug.log",
);
let hasLoggedDesktopTurnDebugSessionHeader = false;
const minimumWindowSize = {
	width: 420,
	height: 700,
};
const defaultWindowSize = {
	width: 1200,
	height: 840,
};
const defaultTraySettings = {
	keepOpenInMenuBar: true,
};
const defaultLastNavigation = {
	hash: "",
	pathname: "/home",
	search: "",
};
const getMainWindowBackgroundColor = () => {
	const shouldUseDarkColors =
		nativeTheme.themeSource === "dark" ||
		(nativeTheme.themeSource === "system" &&
			nativeTheme.shouldUseDarkColors === true);

	return shouldUseDarkColors ? "#18181b" : "#f7f7f5";
};

const applyDesktopThemeSource = (themeSource) => {
	if (
		themeSource !== "light" &&
		themeSource !== "dark" &&
		themeSource !== "system"
	) {
		throw new Error("Desktop theme source must be light, dark, or system.");
	}

	nativeTheme.themeSource = themeSource;

	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.setBackgroundColor(getMainWindowBackgroundColor());
	}

	return {
		ok: true,
		themeSource: nativeTheme.themeSource,
		usesDarkColors: nativeTheme.shouldUseDarkColors === true,
	};
};

nativeTheme.on("updated", () => {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	mainWindow.setBackgroundColor(getMainWindowBackgroundColor());
});

const createInitialTrayCalendarState = () => ({
	status: "idle",
	events: [],
	connectedCalendarCount: 0,
});
const createInitialNotificationPreferences = () => ({
	notifyForScheduledMeetings: false,
	notifyForAutoDetectedMeetings: false,
});
const createLocalFolderId = (folderPath) =>
	createHash("sha256").update(folderPath).digest("hex").slice(0, 24);

const toSharedLocalFolderPayload = (folder) => ({
	id: folder.id,
	name: folder.name,
	path: folder.path,
});

const shareLocalFolders = async (paths) => {
	if (!Array.isArray(paths)) {
		throw new Error("Local folder paths must be an array.");
	}

	const folders = [];

	for (const value of paths) {
		if (typeof value !== "string" || !value.trim()) {
			continue;
		}

		const folderPath = await realpath(value.trim());
		const folderStat = await stat(folderPath);

		if (!folderStat.isDirectory()) {
			throw new Error("Only folders can be shared with Ask AI.");
		}

		const folder = {
			id: createLocalFolderId(folderPath),
			name: folderPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? folderPath,
			path: folderPath,
		};

		sharedLocalFolders.set(folder.id, folder);
		folders.push(toSharedLocalFolderPayload(folder));
	}

	while (sharedLocalFolders.size > maxSharedLocalFolders) {
		const firstKey = sharedLocalFolders.keys().next().value;
		if (!firstKey) {
			break;
		}
		sharedLocalFolders.delete(firstKey);
	}

	return { folders };
};
const getCurrentDayWindow = () => {
	const now = new Date();
	const timeMin = new Date(now);
	timeMin.setHours(0, 0, 0, 0);
	const timeMax = new Date(now);
	timeMax.setHours(23, 59, 59, 999);

	return {
		timeMin: timeMin.toISOString(),
		timeMax: timeMax.toISOString(),
	};
};
const createInitialMeetingDetectionState = () => ({
	candidateStartedAt: null,
	confidence: 0,
	dismissedUntil: null,
	hasMeetingSignal: false,
	isMicrophoneActive: false,
	isSuppressed: false,
	sourceName: null,
	status: "idle",
});

const logOpenAiResponseMetadata = ({ context, requestId, response }) => {
	const openAiRequestId = response.headers.get("x-request-id");
	const processingMs = response.headers.get("openai-processing-ms");

	console.info("[openai]", {
		context,
		openAiRequestId,
		processingMs,
		requestId,
		status: response.status,
	});
};
const createInitialTranscriptionSessionState = () => ({
	autoStartKey: null,
	error: null,
	isAvailable: false,
	isConnecting: false,
	isListening: false,
	liveTranscript: {
		you: {
			speaker: "you",
			startedAt: null,
			text: "",
		},
		them: {
			speaker: "them",
			startedAt: null,
			text: "",
		},
	},
	phase: "idle",
	recoveryStatus: {
		attempt: 0,
		maxAttempts: 0,
		message: null,
		state: "idle",
	},
	scopeKey: null,
	systemAudioStatus: {
		sourceMode: "unsupported",
		state: "unsupported",
	},
	utterances: [],
});

let mainWindow = null;
let localServer = null;
let tray = null;
let isQuitting = false;
let isBypassingQuitConfirmation = false;
let isPromptingForQuitConfirmation = false;
let traySettings = defaultTraySettings;
let trayCalendarState = createInitialTrayCalendarState();
let trayCalendarWorkspaceId = null;
let activeWorkspaceNotificationPreferences =
	createInitialNotificationPreferences();
let trayCalendarRefreshTimeoutId = null;
let trayCalendarRefreshPromise = null;
let trayStatusLabel = "Updates are unavailable in development builds";
let hasConfiguredDisplayMediaHandler = false;
let microphoneCaptureSession = null;
let microphoneCaptureStartRequestId = 0;
let microphoneActivitySession = null;
let microphoneActivityEventSequence = 0;
let systemAudioCaptureSession = null;
let systemAudioCaptureStartRequestId = 0;
const sharedLocalFolders = new Map();
let systemAudioPermissionState = "prompt";
let meetingWidgetWindow = null;
let latestMeetingWidgetSize = { width: 360, height: 104 };
let cachedDockIconImage;
let meetingWidgetAutoHideTimeoutId = null;
let hasPlayedMeetingWidgetSoundForVisiblePrompt = false;
let hasPendingUpdateDownload = false;
let isCheckingForUpdates = false;
let shouldShowUpdateResultDialogs = false;
let pendingUpdateVersion = null;
let latestMeetingDetectionState = createInitialMeetingDetectionState();
let latestTranscriptionSessionState = createInitialTranscriptionSessionState();
const shownScheduledMeetingNotificationKeys = new Set();
const desktopRealtimeTransportSessions = new Map();
const captureEventListeners = {
	microphone: new Set(),
	systemAudio: new Set(),
};
const transcriptionSpeakers = {
	them: createTranscriptionSpeakerRuntime("them"),
	you: createTranscriptionSpeakerRuntime("you"),
};
let transcriptionConfig = {
	autoStartKey: null,
	lang: undefined,
	scopeKey: null,
};
let transcriptionPolicy = null;
let transcriptionRecoveryAttempt = 0;
let transcriptionReconnectTimeoutId = null;
let transcriptionRolloverTimeoutId = null;
let systemAudioAttachRetryTimeoutId = null;
let systemAudioAttachRetryAttempt = 0;
let transcriptionLastHandledAutoStartKey = null;
let transcriptionLifecycleOperationId = 0;
let transcriptionPendingSystemAudioAttachPromise = null;
let transcriptionPendingStartPromise = null;
let transcriptionPendingStopPromise = null;
let currentTranscriptionSessionCorrelationId = null;
let meetingDetectionDebounceTimeoutId = null;
let lastNavigation = { ...defaultLastNavigation };
const areDesktopTestHooksEnabled =
	app.isPackaged !== true || process.env.OPENGRAN_ENABLE_TEST_HOOKS === "1";

const isUpdaterAvailable = () =>
	process.platform === "darwin" &&
	app.isPackaged === true &&
	process.env.OPENGRAN_DISABLE_UPDATER !== "1";

const setTrayStatusLabel = (value) => {
	trayStatusLabel = value;
	refreshTrayMenu();
};

const getDockIconImage = () => {
	if (cachedDockIconImage !== undefined) {
		return cachedDockIconImage;
	}

	const icon = nativeImage.createFromPath(dockIconPath);
	if (icon.isEmpty()) {
		console.warn(`Dock icon is missing or invalid at ${dockIconPath}.`);
		cachedDockIconImage = null;
		return cachedDockIconImage;
	}

	cachedDockIconImage = icon;
	return cachedDockIconImage;
};

const applyDockIcon = () => {
	if (process.platform !== "darwin") {
		return;
	}

	const icon = getDockIconImage();
	if (!icon) {
		return;
	}

	app.dock?.setIcon(icon);
};

const ensureDockVisible = () => {
	if (process.platform !== "darwin") {
		return;
	}

	app.dock?.show();
	applyDockIcon();
};

const ensureAppActive = () => {
	if (process.platform !== "darwin") {
		return;
	}

	app.show();
	app.focus({ steal: true });
};

const ensureDockHidden = () => {
	if (process.platform !== "darwin") {
		return;
	}

	app.dock?.hide();
};

const hideMainWindow = () => {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	mainWindow.hide();
};

const hideApp = ({ hideDock = false } = {}) => {
	hideMainWindow();

	if (process.platform === "darwin") {
		app.hide();
	}

	if (hideDock) {
		ensureDockHidden();
	}
};

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const trayDateFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
	weekday: "short",
});

const trayTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const isSameCalendarDay = (left, right) =>
	left.getFullYear() === right.getFullYear() &&
	left.getMonth() === right.getMonth() &&
	left.getDate() === right.getDate();

const isTrayEventLive = (event, currentDate) => {
	const startAt = new Date(event.startAt).getTime();
	const endAt = new Date(event.endAt).getTime();
	const now = currentDate.getTime();

	return now >= startAt && now <= endAt;
};

const isTrayEventToday = (event, currentDate) => {
	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt).getTime();

	return (
		isSameCalendarDay(startAt, currentDate) && endAt >= currentDate.getTime()
	);
};

const getTrayTodayEvents = (events, currentDate) =>
	events
		.filter((event) => isTrayEventToday(event, currentDate))
		.sort(
			(left, right) =>
				new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
		);

const truncateTrayLabel = (value, maxLength) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const formatTrayDuration = (durationMs) => {
	const totalMinutes = Math.max(1, Math.ceil(durationMs / 60_000));

	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
};

const formatTrayEventTimeRange = (event) => {
	if (event.isAllDay) {
		return "All day";
	}

	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt);
	return `${trayTimeFormatter.format(startAt)} - ${trayTimeFormatter.format(endAt)}`;
};

const formatTrayNextEventHeader = (event, currentDate) => {
	if (isTrayEventLive(event, currentDate)) {
		return "Live now";
	}

	if (event.isAllDay) {
		return "All day";
	}

	const startsInMs = new Date(event.startAt).getTime() - currentDate.getTime();

	if (startsInMs <= 0) {
		return "Starting now";
	}

	return `Starts in ${formatTrayDuration(startsInMs)}`;
};

const formatTrayEventMenuLabel = (event) =>
	`${truncateTrayLabel(event.title, 42)} • ${formatTrayEventTimeRange(event)}`;

const getDetectedMeetingCalendarEvent = (currentDate = new Date()) => {
	if (trayCalendarState.status !== "ready") {
		return null;
	}

	const currentTimestamp = currentDate.getTime();
	const liveMeeting = getTrayTodayEvents(trayCalendarState.events, currentDate)
		.filter((event) => event?.isMeeting)
		.find((event) => {
			const startAt = new Date(event.startAt).getTime();
			const endAt = new Date(event.endAt).getTime();

			return (
				Number.isFinite(startAt) &&
				Number.isFinite(endAt) &&
				startAt <= currentTimestamp &&
				endAt >= currentTimestamp
			);
		});

	if (liveMeeting) {
		return liveMeeting;
	}

	return getTrayTodayEvents(trayCalendarState.events, currentDate)
		.filter((event) => event?.isMeeting)
		.find((event) => {
			const startAt = new Date(event.startAt).getTime();

			return (
				Number.isFinite(startAt) &&
				Math.abs(startAt - currentTimestamp) <=
					scheduledMeetingNotificationLeadTimeMs
			);
		});
};

const openTrayMeetingLink = async (event) => {
	if (!event?.meetingUrl) {
		return;
	}

	await shell.openExternal(event.meetingUrl);
};

const createCalendarEventNoteSearch = (event, options = {}) => {
	const searchParams = new URLSearchParams();
	const autoStartCapture = options.autoStartCapture === true;
	const stopCaptureWhenMeetingEnds =
		options.stopCaptureWhenMeetingEnds === true;

	if (autoStartCapture) {
		searchParams.set("capture", "1");
	}

	if (stopCaptureWhenMeetingEnds) {
		searchParams.set("meeting", "1");
	}

	searchParams.set("calendarEventId", event.id);
	searchParams.set("calendarId", event.calendarId);
	searchParams.set("calendarName", event.calendarName);
	searchParams.set("eventTitle", event.title);
	searchParams.set("startAt", event.startAt);
	searchParams.set("endAt", event.endAt);
	searchParams.set("isAllDay", event.isAllDay ? "1" : "0");

	if (event.meetingUrl) {
		searchParams.set("meetingUrl", event.meetingUrl);
	}

	if (event.location) {
		searchParams.set("location", event.location);
	}

	if (event.htmlLink) {
		searchParams.set("htmlLink", event.htmlLink);
	}

	return `?${searchParams.toString()}`;
};

const openCalendarEventNote = async (event, options = {}) => {
	const hasStarted = new Date(event.startAt).getTime() <= Date.now();

	await showMainWindow({
		pathname: "/note",
		search: createCalendarEventNoteSearch(event, {
			autoStartCapture:
				options.autoStartCapture === true ||
				(options.autoStartCapture == null && hasStarted),
			stopCaptureWhenMeetingEnds:
				options.stopCaptureWhenMeetingEnds === true ||
				(options.stopCaptureWhenMeetingEnds == null && event.isMeeting),
		}),
	});

	if (options.openMeetingLink !== false && event.meetingUrl) {
		await openTrayMeetingLink(event);
	}
};

const buildTrayEventMenuItem = (event) => ({
	label: formatTrayEventMenuLabel(event),
	enabled: event?.isMeeting === true,
	click: () => {
		void openCalendarEventNote(event);
	},
});

const getTrayTitle = () => {
	const currentDate = new Date();
	const todayEvents = getTrayTodayEvents(trayCalendarState.events, currentDate);

	if (todayEvents.length === 0) {
		if (trayCalendarState.status === "idle") {
			return "";
		}

		if (trayCalendarState.status === "not_connected") {
			return "";
		}

		if (trayCalendarState.status === "error") {
			return "";
		}

		return "";
	}

	const nextEvent = todayEvents[0];

	if (isTrayEventLive(nextEvent, currentDate)) {
		return `${truncateTrayLabel(nextEvent.title, 22)} • now`;
	}

	if (nextEvent.isAllDay) {
		return `${truncateTrayLabel(nextEvent.title, 22)} • today`;
	}

	return `${truncateTrayLabel(nextEvent.title, 22)} • in ${formatTrayDuration(new Date(nextEvent.startAt).getTime() - currentDate.getTime())}`;
};

const buildTrayCalendarMenuItems = () => {
	const currentDate = new Date();
	const todayLabel = `Today (${trayDateFormatter.format(currentDate)})`;
	const todayEvents = getTrayTodayEvents(
		trayCalendarState.events,
		currentDate,
	).slice(0, trayCalendarMenuEventLimit);

	if (trayCalendarState.status === "not_connected") {
		return [];
	}

	if (trayCalendarState.status === "error") {
		return [];
	}

	if (trayCalendarState.status === "idle") {
		return [
			{
				label: todayLabel,
				enabled: false,
			},
			{
				label: "Loading calendar…",
				enabled: false,
			},
			{ type: "separator" },
		];
	}

	if (todayEvents.length === 0) {
		return [
			{
				label: todayLabel,
				enabled: false,
			},
			{
				label: "Nothing for today",
				enabled: false,
			},
			{ type: "separator" },
		];
	}

	const [nextEvent, ...laterEvents] = todayEvents;

	return [
		{
			label: formatTrayNextEventHeader(nextEvent, currentDate),
			enabled: false,
		},
		buildTrayEventMenuItem(nextEvent),
		...(laterEvents.length > 0
			? [
					{ type: "separator" },
					{
						label: todayLabel,
						enabled: false,
					},
					...laterEvents.map((event) => buildTrayEventMenuItem(event)),
				]
			: []),
		{ type: "separator" },
	];
};

const getDesktopConvexToken = async () => {
	const desktopAuthClient = getDesktopAuthClient();
	const result = await desktopAuthClient.$fetch("/convex/token", {
		method: "GET",
	});

	return result &&
		typeof result === "object" &&
		"token" in result &&
		typeof result.token === "string" &&
		result.token.trim()
		? result.token
		: null;
};

const clearTrayCalendarRefresh = () => {
	if (trayCalendarRefreshTimeoutId != null) {
		clearTimeout(trayCalendarRefreshTimeoutId);
		trayCalendarRefreshTimeoutId = null;
	}
};

const shouldMaintainTrayCalendar = () =>
	Boolean(trayCalendarWorkspaceId) &&
	(traySettings.keepOpenInMenuBar ||
		activeWorkspaceNotificationPreferences.notifyForScheduledMeetings);

const shouldUseActiveTrayCalendarRefresh = (events) => {
	const now = Date.now();

	return events.some((event) => {
		if (!event?.isMeeting || event.isAllDay) {
			return false;
		}

		const startAt = Date.parse(event.startAt);
		const endAt = Date.parse(event.endAt);

		if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= now) {
			return false;
		}

		return startAt - now <= trayCalendarUpcomingRefreshWindowMs;
	});
};

const getTrayCalendarRefreshDelay = () => {
	if (!shouldMaintainTrayCalendar()) {
		return null;
	}

	if (
		trayCalendarState.status === "ready" &&
		shouldUseActiveTrayCalendarRefresh(trayCalendarState.events)
	) {
		return trayCalendarActiveRefreshMs;
	}

	if (trayCalendarState.status === "ready") {
		return trayCalendarIdleRefreshMs;
	}

	return trayCalendarUnavailableRefreshMs;
};

const scheduleTrayCalendarRefresh = (
	delayMs = getTrayCalendarRefreshDelay(),
) => {
	clearTrayCalendarRefresh();

	if (delayMs == null) {
		return;
	}

	trayCalendarRefreshTimeoutId = setTimeout(() => {
		trayCalendarRefreshTimeoutId = null;
		void refreshTrayCalendar();
	}, delayMs);
};

const refreshTrayCalendar = async () => {
	if (trayCalendarRefreshPromise) {
		return await trayCalendarRefreshPromise;
	}

	trayCalendarRefreshPromise = (async () => {
		try {
			if (!shouldMaintainTrayCalendar()) {
				trayCalendarState = createInitialTrayCalendarState();
				return;
			}

			if (!trayCalendarWorkspaceId) {
				trayCalendarState = {
					...createInitialTrayCalendarState(),
					status: "not_connected",
				};
				return;
			}

			const convexToken = await getDesktopConvexToken();

			if (!convexToken) {
				trayCalendarState = {
					...createInitialTrayCalendarState(),
					status: "not_connected",
				};
				return;
			}

			const convexClient = new ConvexHttpClient(getConvexUrl(), {
				auth: convexToken,
			});
			const result = await convexClient.action(
				api.calendar.listUpcomingGoogleEvents,
				{
					workspaceId: trayCalendarWorkspaceId,
					...getCurrentDayWindow(),
				},
			);

			trayCalendarState =
				result && typeof result === "object" && result.status === "ready"
					? {
							status: "ready",
							events: Array.isArray(result.events) ? result.events : [],
							connectedCalendarCount:
								typeof result.connectedCalendarCount === "number"
									? result.connectedCalendarCount
									: 0,
						}
					: {
							...createInitialTrayCalendarState(),
							status: "not_connected",
						};

			if (trayCalendarState.status === "ready") {
				maybeShowScheduledMeetingNotifications(trayCalendarState.events);
			} else {
				syncShownScheduledMeetingNotifications([]);
			}
		} catch (error) {
			console.warn(
				"Failed to refresh tray calendar.",
				toErrorLogDetails(error),
			);
			trayCalendarState = {
				...createInitialTrayCalendarState(),
				status: "error",
			};
		} finally {
			refreshTrayMenu();
			scheduleTrayCalendarRefresh();
			trayCalendarRefreshPromise = null;
		}
	})();

	return await trayCalendarRefreshPromise;
};

const createScheduledMeetingNotificationKey = (workspaceId, event) =>
	`${workspaceId}:${event.id}:${event.startAt}`;

const formatScheduledMeetingNotificationTime = (value) =>
	new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value));

const syncShownScheduledMeetingNotifications = (events) => {
	if (!trayCalendarWorkspaceId) {
		shownScheduledMeetingNotificationKeys.clear();
		return;
	}

	const activeEventKeys = new Set(
		events.map((event) =>
			createScheduledMeetingNotificationKey(trayCalendarWorkspaceId, event),
		),
	);

	for (const key of shownScheduledMeetingNotificationKeys) {
		if (
			key.startsWith(`${trayCalendarWorkspaceId}:`) &&
			!activeEventKeys.has(key)
		) {
			shownScheduledMeetingNotificationKeys.delete(key);
		}
	}
};

const maybeShowScheduledMeetingNotifications = (events) => {
	if (
		!trayCalendarWorkspaceId ||
		!activeWorkspaceNotificationPreferences.notifyForScheduledMeetings ||
		!ElectronNotification.isSupported()
	) {
		return;
	}

	const now = Date.now();
	syncShownScheduledMeetingNotifications(events);

	for (const event of events) {
		if (!event?.isMeeting || event.isAllDay) {
			continue;
		}

		const startAt = new Date(event.startAt).getTime();
		const endAt = new Date(event.endAt).getTime();

		if (
			!Number.isFinite(startAt) ||
			!Number.isFinite(endAt) ||
			endAt <= now ||
			startAt - now > scheduledMeetingNotificationLeadTimeMs
		) {
			continue;
		}

		const notificationKey = createScheduledMeetingNotificationKey(
			trayCalendarWorkspaceId,
			event,
		);

		if (shownScheduledMeetingNotificationKeys.has(notificationKey)) {
			continue;
		}

		shownScheduledMeetingNotificationKeys.add(notificationKey);

		const isStartingNow = startAt <= now;
		const notification = new ElectronNotification({
			title: isStartingNow ? "Meeting started" : "Meeting starting soon",
			body: `${event.title}\n${event.calendarName} • ${
				isStartingNow
					? "In progress now"
					: `Starts at ${formatScheduledMeetingNotificationTime(event.startAt)}`
			}`,
			icon: dockIconPath,
		});

		try {
			notification.on("click", () => {
				void openCalendarEventNote(event, {
					autoStartCapture: isStartingNow,
					openMeetingLink: true,
					stopCaptureWhenMeetingEnds: true,
				});
			});
			notification.show();
		} catch (error) {
			console.warn("Failed to show scheduled meeting notification.", error);
		}
	}
};

const normalizeMeetingWidgetSize = (value) => {
	const nextWidth = Number.isFinite(value?.width)
		? Math.max(240, Math.min(560, Math.round(value.width)))
		: latestMeetingWidgetSize.width;
	const nextHeight = Number.isFinite(value?.height)
		? Math.max(64, Math.min(220, Math.round(value.height)))
		: latestMeetingWidgetSize.height;

	return {
		width: nextWidth,
		height: nextHeight,
	};
};

const getMeetingWidgetWindowBounds = (size = latestMeetingWidgetSize) => {
	const display = screen.getPrimaryDisplay();
	const { width, x, y } = display.workArea;
	const widgetSize = normalizeMeetingWidgetSize(size);
	return {
		width: widgetSize.width,
		height: widgetSize.height,
		x: Math.round(x + width - widgetSize.width - 18),
		y: Math.round(y + 18),
	};
};

const updateMeetingWidgetWindowSize = (size) => {
	latestMeetingWidgetSize = normalizeMeetingWidgetSize(size);

	if (!meetingWidgetWindow || meetingWidgetWindow.isDestroyed()) {
		return;
	}

	meetingWidgetWindow.setBounds(
		getMeetingWidgetWindowBounds(latestMeetingWidgetSize),
	);
};

const syncMeetingDetectionState = (patch) => {
	const isMicrophoneActive = Boolean(
		patch?.isMicrophoneActive ?? latestMeetingDetectionState.isMicrophoneActive,
	);

	latestMeetingDetectionState = {
		...latestMeetingDetectionState,
		...patch,
		hasMeetingSignal: isMicrophoneActive,
	};

	broadcastToDesktopWindows({
		channel: meetingDetectionStateChannel,
		payload: latestMeetingDetectionState,
	});
};

const clearMeetingWidgetAutoHideTimeout = () => {
	if (meetingWidgetAutoHideTimeoutId == null) {
		return;
	}

	clearTimeout(meetingWidgetAutoHideTimeoutId);
	meetingWidgetAutoHideTimeoutId = null;
};

const hideMeetingWidgetWindow = () => {
	clearMeetingWidgetAutoHideTimeout();
	hasPlayedMeetingWidgetSoundForVisiblePrompt = false;

	if (!meetingWidgetWindow || meetingWidgetWindow.isDestroyed()) {
		meetingWidgetWindow = null;
		return;
	}

	meetingWidgetWindow.hide();
};

const ensureMeetingWidgetWindow = async () => {
	if (meetingWidgetWindow && !meetingWidgetWindow.isDestroyed()) {
		return meetingWidgetWindow;
	}

	const bounds = getMeetingWidgetWindowBounds();
	meetingWidgetWindow = new BrowserWindow({
		...bounds,
		show: false,
		frame: false,
		hasShadow: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		focusable: true,
		acceptFirstMouse: true,
		title: "OpenGran meeting widget",
		icon: dockIconPath,
		webPreferences: {
			preload: join(runtimeDir, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	meetingWidgetWindow.setAlwaysOnTop(true, "floating");
	meetingWidgetWindow.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
	});

	meetingWidgetWindow.on("closed", () => {
		meetingWidgetWindow = null;
	});

	await meetingWidgetWindow.loadURL(
		await getNavigationUrl({
			pathname: "/desktop/meeting-widget",
		}),
	);

	return meetingWidgetWindow;
};

const autoHideMeetingWidgetPrompt = () => {
	hideMeetingWidgetWindow();

	const hasMeetingSignal = latestMeetingDetectionState.isMicrophoneActive;

	if (!hasMeetingSignal || isMeetingDetectionSuppressed()) {
		syncMeetingDetectionState({
			candidateStartedAt: null,
			confidence: 0,
			isSuppressed: isMeetingDetectionSuppressed(),
			sourceName: null,
			status: "idle",
		});
		return;
	}

	syncMeetingDetectionState({
		confidence: 0.35,
		isSuppressed: false,
		sourceName: null,
		status: "monitoring",
	});
};

const showMeetingWidgetWindow = async () => {
	clearMeetingWidgetAutoHideTimeout();

	const nextWindow = await ensureMeetingWidgetWindow();
	const bounds = getMeetingWidgetWindowBounds();
	const shouldPlaySound =
		!nextWindow.isVisible() || !hasPlayedMeetingWidgetSoundForVisiblePrompt;
	nextWindow.setBounds(bounds);
	ensureDockVisible();
	nextWindow.showInactive();
	if (shouldPlaySound) {
		shell.beep();
		hasPlayedMeetingWidgetSoundForVisiblePrompt = true;
	}

	meetingWidgetAutoHideTimeoutId = setTimeout(() => {
		meetingWidgetAutoHideTimeoutId = null;
		autoHideMeetingWidgetPrompt();
	}, meetingWidgetAutoHideMs);
};

const resolveSystemAudioHelperPath = () => {
	const envPath = process.env.OPENGRAN_SYSTEM_AUDIO_HELPER_PATH?.trim();
	const unpackedHelperPath = app.isPackaged
		? resolve(
				process.resourcesPath,
				"app.asar.unpacked",
				".bundle-root",
				"apps",
				"desktop",
				"dist",
				"bin",
				"opengran-system-audio-helper",
			)
		: null;
	const candidates = [
		envPath,
		unpackedHelperPath,
		resolve(runtimeDir, "bin", "opengran-system-audio-helper"),
		resolve(
			runtimeDir,
			"..",
			".generated",
			"system-audio",
			"opengran-system-audio-helper",
		),
	].filter(Boolean);

	return candidates.find((candidatePath) => existsSync(candidatePath)) ?? null;
};

const resolveMicrophoneHelperPath = () => {
	const envPath = process.env.OPENGRAN_MICROPHONE_HELPER_PATH?.trim();
	const unpackedHelperPath = app.isPackaged
		? resolve(
				process.resourcesPath,
				"app.asar.unpacked",
				".bundle-root",
				"apps",
				"desktop",
				"dist",
				"bin",
				"opengran-microphone-helper",
			)
		: null;
	const candidates = [
		envPath,
		unpackedHelperPath,
		resolve(runtimeDir, "bin", "opengran-microphone-helper"),
		resolve(
			runtimeDir,
			"..",
			".generated",
			"system-audio",
			"opengran-microphone-helper",
		),
	].filter(Boolean);

	return candidates.find((candidatePath) => existsSync(candidatePath)) ?? null;
};

const resolveMicrophoneActivityHelperPath = () => {
	const envPath = process.env.OPENGRAN_MICROPHONE_ACTIVITY_HELPER_PATH?.trim();
	const unpackedHelperPath = app.isPackaged
		? resolve(
				process.resourcesPath,
				"app.asar.unpacked",
				".bundle-root",
				"apps",
				"desktop",
				"dist",
				"bin",
				"opengran-microphone-activity-helper",
			)
		: null;
	const candidates = [
		envPath,
		unpackedHelperPath,
		resolve(runtimeDir, "bin", "opengran-microphone-activity-helper"),
		resolve(
			runtimeDir,
			"..",
			".generated",
			"system-audio",
			"opengran-microphone-activity-helper",
		),
	].filter(Boolean);

	return candidates.find((candidatePath) => existsSync(candidatePath)) ?? null;
};

function createTranscriptionSpeakerRuntime(speaker) {
	return {
		speaker,
		activeSourceMode: "unsupported",
		captureDispose: null,
		emittedItemIds: new Set(),
		lastCommittedItemId: null,
		liveItemId: null,
		sessionId: null,
		transportActive: false,
		turns: new Map(),
	};
}

function createTranscriptRecoveryStatus(overrides = {}) {
	return {
		attempt: 0,
		maxAttempts: 0,
		message: null,
		state: "idle",
		...overrides,
	};
}

function createEmptyLiveTranscriptState() {
	return {
		you: {
			speaker: "you",
			startedAt: null,
			text: "",
		},
		them: {
			speaker: "them",
			startedAt: null,
			text: "",
		},
	};
}

const isLikelySystemAudioPermissionError = (error) => {
	const message = error instanceof Error ? error.message : String(error);

	return (
		message.includes("system-audio tap") ||
		message.includes("System audio capture exited before it became ready") ||
		message.includes("Timed out while starting macOS system audio capture")
	);
};

const markSystemAudioPermissionGranted = () => {
	systemAudioPermissionState = "granted";
};

const markSystemAudioPermissionPrompt = () => {
	systemAudioPermissionState = "prompt";
};

const markSystemAudioPermissionBlocked = () => {
	systemAudioPermissionState = "blocked";
};

const getLiveDesktopWindows = () =>
	BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());

const broadcastToDesktopWindows = ({ channel, payload }) => {
	for (const window of getLiveDesktopWindows()) {
		window.webContents.send(channel, payload);
	}
};

const emitSystemAudioCaptureEvent = (event) => {
	for (const listener of captureEventListeners.systemAudio) {
		listener(event);
	}

	broadcastToDesktopWindows({
		channel: systemAudioCaptureEventChannel,
		payload: event,
	});
};

const emitMicrophoneCaptureEvent = (event) => {
	for (const listener of captureEventListeners.microphone) {
		listener(event);
	}

	broadcastToDesktopWindows({
		channel: microphoneCaptureEventChannel,
		payload: event,
	});
};

const subscribeToCaptureEvents = (source, listener) => {
	const listenerSet = captureEventListeners[source];

	if (!listenerSet) {
		throw new Error(`Unsupported capture source: ${source}`);
	}

	listenerSet.add(listener);

	return () => {
		listenerSet.delete(listener);
	};
};

const clearCaptureHealthTimeout = (session) => {
	if (session?.healthTimeout) {
		clearTimeout(session.healthTimeout);
		session.healthTimeout = null;
	}
};

const syncTranscriptionSessionState = (state) => {
	latestTranscriptionSessionState = state;
	broadcastToDesktopWindows({
		channel: transcriptionSessionStateChannel,
		payload: state,
	});
	reevaluateMeetingDetection();
};

const emitTranscriptionSessionEvent = (event) => {
	broadcastToDesktopWindows({
		channel: transcriptionSessionEventChannel,
		payload: event,
	});
};

const patchTranscriptionSessionState = (patch) => {
	syncTranscriptionSessionState({
		...latestTranscriptionSessionState,
		...patch,
	});
};

const countLoggedTranscriptWords = (value) =>
	typeof value === "string" && value.trim()
		? value.trim().split(/\s+/u).filter(Boolean).length
		: 0;

const summarizeTranscriptTextForLog = (value) => {
	const text = typeof value === "string" ? value.trim() : "";
	const wordCount = countLoggedTranscriptWords(text);

	return {
		isOversizedTurn: wordCount >= 80,
		textLength: text.length,
		textPreview: text.slice(0, 160),
		turnSizeBucket:
			wordCount >= 80
				? "very_long"
				: wordCount >= 40
					? "long"
					: wordCount >= 15
						? "medium"
						: wordCount > 0
							? "short"
							: "empty",
		wordCount,
	};
};

const summarizeTranscriptConfidenceForLog = ({ logprobs, source, text }) => {
	const summary = summarizeTranscriptConfidence({
		logprobs,
		source,
		text,
	});

	return summary
		? {
				confidenceAverage: summary.average,
				confidenceLowTokenRatio: summary.lowTokenRatio,
				confidenceMinProbability: summary.minProbability,
				confidenceTokenCount: summary.tokenCount,
				confidenceVeryLowTokenRatio: summary.veryLowTokenRatio,
			}
		: {
				confidenceAverage: null,
				confidenceLowTokenRatio: null,
				confidenceMinProbability: null,
				confidenceTokenCount: 0,
				confidenceVeryLowTokenRatio: null,
			};
};

const logDesktopTurnDebug = (event, details = {}) => {
	if (!shouldLogDesktopTurnDebug) {
		return;
	}

	const payload = {
		event,
		timestamp: new Date().toISOString(),
		...details,
	};

	console.info("[desktop-turn]", payload);

	if (!hasLoggedDesktopTurnDebugSessionHeader) {
		hasLoggedDesktopTurnDebugSessionHeader = true;
		void appendFile(
			transcriptionDebugLogPath,
			`${JSON.stringify({
				event: "debug_session_started",
				pid: process.pid,
				timestamp: new Date().toISOString(),
			})}\n`,
			"utf8",
		).catch(() => {});
	}

	void appendFile(
		transcriptionDebugLogPath,
		`${JSON.stringify(payload)}\n`,
		"utf8",
	).catch(() => {});
};

const updateTranscriptionLiveTranscript = (speaker, value) => {
	patchTranscriptionSessionState({
		liveTranscript: {
			...latestTranscriptionSessionState.liveTranscript,
			[speaker]: {
				...latestTranscriptionSessionState.liveTranscript[speaker],
				...value,
			},
		},
	});
};

const clearTranscriptionLiveTranscript = (speaker, metadata = {}) => {
	const previousValue = latestTranscriptionSessionState.liveTranscript[speaker];

	if (previousValue?.text?.trim()) {
		logDesktopTurnDebug("live.cleared", {
			itemId: metadata.itemId ?? null,
			reason: metadata.reason ?? "unknown",
			speaker,
			...summarizeTranscriptTextForLog(previousValue.text),
		});
	}

	updateTranscriptionLiveTranscript(speaker, {
		startedAt: null,
		text: "",
	});
};

const compareTranscriptUtterances = (left, right) => {
	if (left.startedAt !== right.startedAt) {
		return left.startedAt - right.startedAt;
	}

	if (left.endedAt !== right.endedAt) {
		return left.endedAt - right.endedAt;
	}

	return left.id.localeCompare(right.id);
};

const appendTranscriptionUtterance = (utterance) => {
	patchTranscriptionSessionState({
		utterances: [...latestTranscriptionSessionState.utterances, utterance].sort(
			compareTranscriptUtterances,
		),
	});
	emitTranscriptionSessionEvent({
		type: "session.utterance_committed",
		utterance,
	});
};

const createDesktopSystemAudioPolicy = () => {
	if (process.platform === "darwin") {
		const sourceMode =
			getSystemAudioPermission().state === "granted"
				? "desktop-native"
				: "unsupported";

		return {
			platform: "desktop",
			systemAudioCapability: {
				isSupported: sourceMode !== "unsupported",
				sourceMode,
				shouldAutoBootstrap: sourceMode === "desktop-native",
			},
		};
	}

	if (process.platform === "win32") {
		return {
			platform: "desktop",
			systemAudioCapability: {
				isSupported: true,
				sourceMode: "display-media",
				shouldAutoBootstrap: false,
			},
		};
	}

	return {
		platform: "desktop",
		systemAudioCapability: {
			isSupported: false,
			sourceMode: "unsupported",
			shouldAutoBootstrap: false,
		},
	};
};

const createSystemAudioStatusFromPolicy = (policy) => ({
	state: !policy.systemAudioCapability.isSupported ? "unsupported" : "ready",
	sourceMode: policy.systemAudioCapability.sourceMode,
});

const resolveCurrentSystemAudioStatus = (policy) => {
	if (!policy.systemAudioCapability.isSupported) {
		return createSystemAudioStatusFromPolicy(policy);
	}

	if (transcriptionSpeakers.them.transportActive) {
		return {
			sourceMode:
				transcriptionSpeakers.them.activeSourceMode ??
				policy.systemAudioCapability.sourceMode,
			state: "connected",
		};
	}

	return createSystemAudioStatusFromPolicy(policy);
};

const canUseHostedDesktopAi = () =>
	Boolean(process.env.CONVEX_SITE_URL?.trim() || process.env.SITE_URL?.trim());

const getDesktopRealtimeAvailability = () =>
	process.platform === "darwin" &&
	(Boolean(process.env.OPENAI_API_KEY) || canUseHostedDesktopAi()) &&
	Boolean(resolveMicrophoneHelperPath());

const isNonRecoverableStartError = (error) => {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();

	return (
		message.includes("microphone access") ||
		message.includes("not configured") ||
		message.includes("permission") ||
		message.includes("system settings")
	);
};

const normalizeTranscriptionError = (error) => {
	if (!(error instanceof Error)) {
		return {
			code: "unknown",
			message: "Failed to start live transcription.",
		};
	}

	const message = error.message;
	const normalizedMessage = message.toLowerCase();

	if (
		normalizedMessage.includes("blocked") ||
		normalizedMessage.includes("permission denied") ||
		normalizedMessage.includes("microphone access is required") ||
		isNonRecoverableStartError(error)
	) {
		return {
			code: "permission_denied",
			message,
		};
	}

	if (
		normalizedMessage.includes("unavailable") ||
		normalizedMessage.includes("missing")
	) {
		return {
			code: "device_unavailable",
			message,
		};
	}

	if (normalizedMessage.includes("connect")) {
		return {
			code: "connection_failed",
			message,
		};
	}

	return {
		code: "configuration_failed",
		message,
	};
};

const clearTranscriptionReconnectTimeout = () => {
	if (transcriptionReconnectTimeoutId == null) {
		return;
	}

	clearTimeout(transcriptionReconnectTimeoutId);
	transcriptionReconnectTimeoutId = null;
};

const clearTranscriptionRolloverTimeout = () => {
	if (transcriptionRolloverTimeoutId == null) {
		return;
	}

	clearTimeout(transcriptionRolloverTimeoutId);
	transcriptionRolloverTimeoutId = null;
};

const isCurrentTranscriptionOperation = (operationId) =>
	transcriptionLifecycleOperationId === operationId;

const clearSystemAudioAttachRetryTimeout = ({ resetAttempt = false } = {}) => {
	if (systemAudioAttachRetryTimeoutId != null) {
		clearTimeout(systemAudioAttachRetryTimeoutId);
		systemAudioAttachRetryTimeoutId = null;
	}

	if (resetAttempt) {
		systemAudioAttachRetryAttempt = 0;
	}
};

const refreshTranscriptionPolicy = () => {
	transcriptionPolicy = createDesktopSystemAudioPolicy();

	patchTranscriptionSessionState({
		isAvailable: getDesktopRealtimeAvailability(),
		systemAudioStatus: resolveCurrentSystemAudioStatus(transcriptionPolicy),
	});

	return transcriptionPolicy;
};

const clearMeetingDetectionDebounceTimeout = () => {
	if (meetingDetectionDebounceTimeoutId == null) {
		return;
	}

	clearTimeout(meetingDetectionDebounceTimeoutId);
	meetingDetectionDebounceTimeoutId = null;
};

const isMeetingDetectionSuppressed = () =>
	["starting", "listening", "reconnecting", "stopping"].includes(
		latestTranscriptionSessionState.phase,
	) || (latestMeetingDetectionState.dismissedUntil ?? 0) > Date.now();

const reevaluateMeetingDetection = () => {
	const isSuppressed = isMeetingDetectionSuppressed();
	const hasMeetingSignal = latestMeetingDetectionState.isMicrophoneActive;
	const confidence = 0.35;
	const promptConfidence = 0.82;

	if (!hasMeetingSignal || isSuppressed) {
		clearMeetingDetectionDebounceTimeout();
		hideMeetingWidgetWindow();
		syncMeetingDetectionState({
			candidateStartedAt: null,
			confidence: 0,
			isSuppressed,
			sourceName: null,
			status: "idle",
		});
		return;
	}

	syncMeetingDetectionState({
		confidence,
		isSuppressed: false,
		sourceName: latestMeetingDetectionState.sourceName,
		status: "monitoring",
	});

	if (!activeWorkspaceNotificationPreferences.notifyForAutoDetectedMeetings) {
		clearMeetingDetectionDebounceTimeout();
		hideMeetingWidgetWindow();
		return;
	}

	if (meetingDetectionDebounceTimeoutId != null) {
		return;
	}

	meetingDetectionDebounceTimeoutId = setTimeout(() => {
		meetingDetectionDebounceTimeoutId = null;

		if (
			!latestMeetingDetectionState.isMicrophoneActive ||
			isMeetingDetectionSuppressed()
		) {
			reevaluateMeetingDetection();
			return;
		}

		syncMeetingDetectionState({
			candidateStartedAt: Date.now(),
			confidence: promptConfidence,
			isSuppressed: false,
			sourceName: latestMeetingDetectionState.sourceName,
			status: "prompting",
		});
		void showMeetingWidgetWindow();
	}, meetingDetectionDebounceMs);
};

const dismissDetectedMeetingWidget = () => {
	clearMeetingDetectionDebounceTimeout();
	hideMeetingWidgetWindow();
	syncMeetingDetectionState({
		candidateStartedAt: null,
		confidence: 0,
		dismissedUntil: Date.now() + meetingDetectionDismissMs,
		isSuppressed: true,
		sourceName: null,
		status: "idle",
	});
};

const startDetectedMeetingNote = async () => {
	clearMeetingDetectionDebounceTimeout();
	hideMeetingWidgetWindow();
	syncMeetingDetectionState({
		candidateStartedAt: null,
		confidence: 0,
		dismissedUntil: null,
		isSuppressed: true,
		sourceName: null,
		status: "idle",
	});

	const detectedMeetingCalendarEvent = getDetectedMeetingCalendarEvent();

	if (detectedMeetingCalendarEvent) {
		await openCalendarEventNote(detectedMeetingCalendarEvent, {
			autoStartCapture: true,
			stopCaptureWhenMeetingEnds: true,
		});
		return;
	}

	await showMainWindow({
		pathname: "/note",
		search: "?capture=1&meeting=1",
	});
};

const showMeetingWidgetForTest = async () => {
	clearMeetingDetectionDebounceTimeout();
	syncMeetingDetectionState({
		candidateStartedAt: Date.now(),
		confidence: 1,
		dismissedUntil: null,
		isMicrophoneActive: true,
		isSuppressed: false,
		sourceName: null,
		status: "prompting",
	});
	await showMeetingWidgetWindow();
};

const resetMeetingDetectionForTest = () => {
	clearMeetingDetectionDebounceTimeout();
	hideMeetingWidgetWindow();
	syncMeetingDetectionState({
		candidateStartedAt: null,
		confidence: 0,
		dismissedUntil: null,
		isMicrophoneActive: false,
		isSuppressed: false,
		sourceName: null,
		status: "idle",
	});
};

const ensureDesktopMicrophonePermissionGranted = async () => {
	let microphonePermission = getMicrophonePermission();

	if (microphonePermission.state === "granted") {
		return;
	}

	if (
		microphonePermission.state === "prompt" &&
		microphonePermission.canRequest
	) {
		await requestPermission("microphone");
		microphonePermission = getMicrophonePermission();
	}

	if (microphonePermission.state === "granted") {
		return;
	}

	if (microphonePermission.state === "blocked") {
		throw new Error(
			"Microphone access is blocked. Enable it in system settings, then try again.",
		);
	}

	if (microphonePermission.state === "unsupported") {
		throw new Error("Microphone capture is not available on this platform.");
	}

	throw new Error("Microphone access is required to start live transcription.");
};

const emitTranscriptionOrderedTurns = (speaker) => {
	const state = transcriptionSpeakers[speaker];

	for (;;) {
		const nextTurn = [...state.turns.values()].find(
			(turn) =>
				(turn.completed || turn.failed) &&
				!state.emittedItemIds.has(turn.itemId) &&
				turn.previousItemId === state.lastCommittedItemId,
		);

		if (!nextTurn) {
			return;
		}

		const text = nextTurn.text.trim();
		const source = speaker === "them" ? "systemAudio" : "microphone";
		const isPlaceholder = text ? isTranscriptPlaceholderText(text) : false;
		const isLowConfidence =
			!nextTurn.failed && text
				? isLowConfidenceTranscriptLogprobs({
						logprobs: nextTurn.logprobs ?? null,
						source,
						text,
					})
				: false;
		const shouldEmit = !nextTurn.failed && text && !isPlaceholder;

		if (shouldEmit) {
			appendTranscriptionUtterance({
				endedAt: Date.now(),
				id: `${state.sessionId ?? "session"}:${speaker}:${nextTurn.itemId}`,
				speaker,
				startedAt: nextTurn.startedAt ?? Date.now(),
				text,
			});
		}

		logDesktopTurnDebug("turn.ordered", {
			itemId: nextTurn.itemId,
			outcome: shouldEmit
				? "emitted"
				: isPlaceholder
					? "placeholder"
					: nextTurn.failed
						? "failed"
						: "empty",
			isLowConfidence,
			shouldDropForConfidence: false,
			previousItemId: nextTurn.previousItemId,
			speaker,
			...summarizeTranscriptConfidenceForLog({
				logprobs: nextTurn.logprobs ?? null,
				source,
				text,
			}),
			...summarizeTranscriptTextForLog(text),
		});

		state.emittedItemIds.add(nextTurn.itemId);
		state.lastCommittedItemId = nextTurn.itemId;

		if (state.liveItemId === nextTurn.itemId) {
			state.liveItemId = null;
			clearTranscriptionLiveTranscript(speaker, {
				itemId: nextTurn.itemId,
				reason: shouldEmit
					? "turn_emitted"
					: nextTurn.failed
						? "turn_failed"
						: "turn_empty",
			});
		}
	}
};

const upsertTranscriptionTurn = (speaker, itemId, updates) => {
	const state = transcriptionSpeakers[speaker];
	const currentValue = state.turns.get(itemId);
	const nextValue = {
		completed: currentValue?.completed ?? false,
		failed: currentValue?.failed ?? false,
		itemId,
		logprobs: currentValue?.logprobs ?? null,
		previousItemId: currentValue?.previousItemId ?? null,
		startedAt: currentValue?.startedAt ?? null,
		text: currentValue?.text ?? "",
		...updates,
	};

	state.turns.set(itemId, nextValue);
	return nextValue;
};

const wait = (durationMs) =>
	new Promise((resolvePromise) => {
		setTimeout(resolvePromise, durationMs);
	});

const verifyDesktopOneTimeToken = async (oneTimeToken) => {
	const retryDelayMs = [0, 250, 750, 1500];
	let lastError = null;

	for (const delayMs of retryDelayMs) {
		if (delayMs > 0) {
			await wait(delayMs);
		}

		try {
			const desktopAuthClient = getDesktopAuthClient();
			await desktopAuthClient.$fetch("/cross-domain/one-time-token/verify", {
				method: "POST",
				body: JSON.stringify({
					token: oneTimeToken,
				}),
				headers: {
					"content-type": "application/json",
				},
				throw: true,
			});
			void refreshTrayCalendar();
			return;
		} catch (error) {
			lastError = error;
			console.warn(
				"Desktop auth callback verification failed.",
				error instanceof Error ? error.message : error,
			);
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("Failed to verify desktop auth callback.");
};

const closeLocalServer = async () => {
	if (!localServer) {
		return;
	}

	const server = localServer;
	localServer = null;
	await server.close();
};

const ensureLocalServer = async () => {
	if (!localServer) {
		localServer = await startLocalServer({
			getSharedLocalFolders: (ids) =>
				ids
					.map((id) => sharedLocalFolders.get(id))
					.filter(Boolean)
					.map(toSharedLocalFolderPayload),
			onAuthCallback: handleDesktopAuthCallback,
		});
	}

	return localServer;
};

const resolveRendererUrl = async () => {
	const developmentUrl = process.env.OPENGRAN_RENDERER_URL?.trim();
	if (developmentUrl) {
		return developmentUrl;
	}

	return (await ensureLocalServer()).origin;
};

const loadTraySettings = async () => {
	try {
		const raw = await readFile(traySettingsPath, "utf8");
		const parsed = JSON.parse(raw);

		traySettings = {
			...defaultTraySettings,
			...(parsed && typeof parsed === "object" ? parsed : {}),
		};
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			traySettings = { ...defaultTraySettings };
			return;
		}

		console.warn("Failed to read tray settings.", error);
		traySettings = { ...defaultTraySettings };
	}
};

const saveTraySettings = async () => {
	try {
		await mkdir(app.getPath("userData"), { recursive: true });
		await writeFile(
			traySettingsPath,
			JSON.stringify(traySettings, null, 2),
			"utf8",
		);
	} catch (error) {
		console.warn("Failed to save tray settings.", error);
	}
};

const normalizeRestorableNavigation = ({
	pathname = "/home",
	search = "",
} = {}) => {
	if (typeof pathname !== "string") {
		return null;
	}

	if (!["/home", "/chat", "/note", "/shared"].includes(pathname)) {
		return null;
	}

	const params = new URLSearchParams(typeof search === "string" ? search : "");

	if (pathname === "/note") {
		const noteId = params.get("noteId")?.trim();

		if (!noteId) {
			return null;
		}

		return {
			hash: "",
			pathname,
			search: `?noteId=${encodeURIComponent(noteId)}`,
		};
	}

	if (pathname === "/chat") {
		const chatId = params.get("chatId")?.trim();

		return {
			hash: "",
			pathname,
			search: chatId ? `?chatId=${encodeURIComponent(chatId)}` : "",
		};
	}

	return {
		hash: "",
		pathname,
		search: "",
	};
};

const loadLastNavigation = async () => {
	try {
		const raw = await readFile(lastNavigationPath, "utf8");
		const parsed = JSON.parse(raw);

		lastNavigation = normalizeRestorableNavigation(parsed) ?? {
			...defaultLastNavigation,
		};
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			lastNavigation = { ...defaultLastNavigation };
			return;
		}

		console.warn("Failed to read last navigation.", error);
		lastNavigation = { ...defaultLastNavigation };
	}
};

const saveLastNavigation = async () => {
	try {
		await mkdir(app.getPath("userData"), { recursive: true });
		await writeFile(
			lastNavigationPath,
			JSON.stringify(lastNavigation, null, 2),
			"utf8",
		);
	} catch (error) {
		console.warn("Failed to save last navigation.", error);
	}
};

const rememberRendererNavigation = async (urlString) => {
	try {
		const rendererUrl = new URL(await resolveRendererUrl());
		const nextUrl = new URL(urlString);

		if (nextUrl.origin !== rendererUrl.origin) {
			return;
		}

		const normalizedNavigation = normalizeRestorableNavigation({
			hash: nextUrl.hash,
			pathname: nextUrl.pathname,
			search: nextUrl.search,
		});

		if (!normalizedNavigation) {
			return;
		}

		if (
			lastNavigation.pathname === normalizedNavigation.pathname &&
			lastNavigation.search === normalizedNavigation.search &&
			lastNavigation.hash === normalizedNavigation.hash
		) {
			return;
		}

		lastNavigation = normalizedNavigation;
		await saveLastNavigation();
	} catch (error) {
		console.warn("Failed to remember renderer navigation.", error);
	}
};

const getTranscriptDraftPath = (noteKey) =>
	join(
		transcriptDraftsDirPath,
		`${Buffer.from(noteKey, "utf8").toString("base64url")}.json`,
	);

const ensureTranscriptDraftsDir = async () => {
	await mkdir(transcriptDraftsDirPath, { recursive: true });
};

const pruneTranscriptDrafts = async () => {
	try {
		await ensureTranscriptDraftsDir();
		const entries = await readdir(transcriptDraftsDirPath, {
			withFileTypes: true,
		});

		await Promise.all(
			entries.map(async (entry) => {
				if (!entry.isFile()) {
					return;
				}

				const filePath = join(transcriptDraftsDirPath, entry.name);

				try {
					const fileStats = await stat(filePath);

					if (Date.now() - fileStats.mtimeMs > transcriptDraftMaxAgeMs) {
						await rm(filePath, { force: true });
					}
				} catch {
					await rm(filePath, { force: true });
				}
			}),
		);
	} catch (error) {
		console.warn("Failed to prune transcript drafts.", error);
	}
};

const loadTranscriptDraft = async (noteKey) => {
	await pruneTranscriptDrafts();

	const filePath = getTranscriptDraftPath(noteKey);

	try {
		const rawValue = await readFile(filePath, "utf8");
		const parsed = JSON.parse(rawValue);

		if (
			parsed?.version !== transcriptDraftStorageVersion ||
			parsed?.noteKey !== noteKey ||
			typeof parsed?.updatedAt !== "number" ||
			Date.now() - parsed.updatedAt > transcriptDraftMaxAgeMs
		) {
			await rm(filePath, { force: true });
			return { draft: null };
		}

		return {
			draft: parsed,
		};
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return { draft: null };
		}

		await rm(filePath, { force: true }).catch(() => {});
		return { draft: null };
	}
};

const saveTranscriptDraft = async ({ noteKey, draft }) => {
	await pruneTranscriptDrafts();
	await ensureTranscriptDraftsDir();

	await writeFile(
		getTranscriptDraftPath(noteKey),
		JSON.stringify(
			{
				...draft,
				version: transcriptDraftStorageVersion,
				noteKey,
				updatedAt: Date.now(),
			},
			null,
			2,
		),
		"utf8",
	);

	return { ok: true };
};

const clearTranscriptDraft = async (noteKey) => {
	await rm(getTranscriptDraftPath(noteKey), { force: true });
	return { ok: true };
};

const getNoteDraftPath = (noteKey) =>
	join(
		noteDraftsDirPath,
		`${Buffer.from(noteKey, "utf8").toString("base64url")}.json`,
	);

const ensureNoteDraftsDir = async () => {
	await mkdir(noteDraftsDirPath, { recursive: true });
};

const pruneNoteDrafts = async () => {
	try {
		await ensureNoteDraftsDir();
		const entries = await readdir(noteDraftsDirPath, {
			withFileTypes: true,
		});

		await Promise.all(
			entries.map(async (entry) => {
				if (!entry.isFile()) {
					return;
				}

				const filePath = join(noteDraftsDirPath, entry.name);

				try {
					const fileStats = await stat(filePath);

					if (Date.now() - fileStats.mtimeMs > noteDraftMaxAgeMs) {
						await rm(filePath, { force: true });
					}
				} catch {
					await rm(filePath, { force: true });
				}
			}),
		);
	} catch (error) {
		console.warn("Failed to prune note drafts.", error);
	}
};

const loadNoteDraft = async (noteKey) => {
	await pruneNoteDrafts();

	const filePath = getNoteDraftPath(noteKey);

	try {
		const rawValue = await readFile(filePath, "utf8");
		const parsed = JSON.parse(rawValue);

		if (
			parsed?.version !== noteDraftStorageVersion ||
			parsed?.noteId !== noteKey ||
			typeof parsed?.updatedAt !== "number" ||
			Date.now() - parsed.updatedAt > noteDraftMaxAgeMs
		) {
			await rm(filePath, { force: true });
			return { draft: null };
		}

		return { draft: parsed };
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return { draft: null };
		}

		await rm(filePath, { force: true }).catch(() => {});
		return { draft: null };
	}
};

const saveNoteDraft = async ({ noteKey, draft }) => {
	await pruneNoteDrafts();
	await ensureNoteDraftsDir();

	await writeFile(
		getNoteDraftPath(noteKey),
		JSON.stringify(
			{
				...draft,
				version: noteDraftStorageVersion,
				noteId: noteKey,
				updatedAt: Date.now(),
			},
			null,
			2,
		),
		"utf8",
	);

	return { ok: true };
};

const clearNoteDraft = async (noteKey) => {
	await rm(getNoteDraftPath(noteKey), { force: true });
	return { ok: true };
};

const parseDesktopRealtimeTransportEvent = ({ event, speaker }) => {
	if (!event || typeof event !== "object" || typeof event.type !== "string") {
		return null;
	}

	if (event.type === "input_audio_buffer.committed" && event.item_id) {
		return {
			speaker,
			type: "committed",
			itemId: event.item_id,
			previousItemId: event.previous_item_id ?? null,
		};
	}

	if (
		event.type === "conversation.item.input_audio_transcription.delta" &&
		event.item_id &&
		typeof event.delta === "string"
	) {
		return {
			logprobs: event.logprobs ?? null,
			speaker,
			type: "partial",
			itemId: event.item_id,
			textDelta: event.delta,
		};
	}

	if (
		event.type === "conversation.item.input_audio_transcription.completed" &&
		event.item_id
	) {
		return {
			logprobs: event.logprobs ?? null,
			speaker,
			type: "final",
			itemId: event.item_id,
			text: event.transcript ?? event.text ?? "",
		};
	}

	if (event.type === "conversation.item.input_audio_transcription.failed") {
		if (!event.item_id) {
			return null;
		}

		return {
			itemId: event.item_id,
			message:
				event.error?.message ??
				"Realtime transcription failed for the current turn.",
			speaker,
			type: "turn_failed",
		};
	}

	if (event.type === "error") {
		return {
			speaker,
			type: "interrupted",
			message: event.error?.message ?? "Realtime transcription failed.",
		};
	}

	return null;
};

const resolveDesktopRealtimeStopFlush = (session) => {
	const stopFlush = session.stopFlush;

	if (!stopFlush) {
		return;
	}

	clearTimeout(stopFlush.timeoutId);
	clearTimeout(stopFlush.settleTimeoutId);
	session.stopFlush = null;
	stopFlush.resolve();
};

const settleDesktopRealtimeStopFlush = (session) => {
	const stopFlush = session.stopFlush;

	if (!stopFlush) {
		return;
	}

	clearTimeout(stopFlush.settleTimeoutId);
	stopFlush.settleTimeoutId = setTimeout(() => {
		resolveDesktopRealtimeStopFlush(session);
	}, desktopRealtimeStopFlushSettleTimeoutMs);
};

const notifyDesktopRealtimeStopFlushEvent = (session, transportEvent) => {
	const stopFlush = session?.stopFlush;

	if (!stopFlush || !transportEvent) {
		return;
	}

	if (transportEvent.type === "committed") {
		stopFlush.targetItemId ??= transportEvent.itemId;
		settleDesktopRealtimeStopFlush(session);
		return;
	}

	if (
		(transportEvent.type === "final" ||
			transportEvent.type === "turn_failed") &&
		(!stopFlush.targetItemId ||
			transportEvent.itemId === stopFlush.targetItemId)
	) {
		resolveDesktopRealtimeStopFlush(session);
	}
};

const flushDesktopRealtimeTransportOnStop = async (session) => {
	if (session.socket.readyState !== WebSocket.OPEN || session.stopFlush) {
		return;
	}

	const targetItemId =
		transcriptionSpeakers[session.speaker]?.liveItemId ?? null;

	console.info("[desktop-realtime] flushing transport before stop", {
		profile: session.profile,
		source: session.source,
		speaker: session.speaker,
		targetItemId,
	});

	await new Promise((resolvePromise) => {
		session.stopFlush = {
			resolve: resolvePromise,
			settleTimeoutId: null,
			targetItemId,
			timeoutId: setTimeout(() => {
				resolveDesktopRealtimeStopFlush(session);
			}, desktopRealtimeStopFlushTimeoutMs),
		};

		try {
			session.socket.send(
				JSON.stringify({
					type: "input_audio_buffer.commit",
				}),
			);
			settleDesktopRealtimeStopFlush(session);
		} catch (error) {
			console.warn("[desktop-realtime] failed to flush transport on stop", {
				message: error instanceof Error ? error.message : String(error),
				profile: session.profile,
				source: session.source,
				speaker: session.speaker,
			});
			resolveDesktopRealtimeStopFlush(session);
		}
	});
};

const stopDesktopRealtimeTransport = async (speaker) => {
	const session = desktopRealtimeTransportSessions.get(speaker);

	if (!session) {
		return { ok: true };
	}

	desktopRealtimeTransportSessions.delete(speaker);
	session.isClosing = true;
	session.unsubscribeCapture?.();
	session.unsubscribeCapture = null;
	clearTimeout(session.openTimeout);
	await flushDesktopRealtimeTransportOnStop(session);

	await new Promise((resolvePromise) => {
		const finalize = () => {
			resolvePromise();
		};

		session.socket.once("close", finalize);
		session.socket.close();

		setTimeout(() => {
			if (session.socket.readyState !== WebSocket.CLOSED) {
				session.socket.terminate();
			}
			finalize();
		}, 1_000);
	});

	return { ok: true };
};

const scheduleTranscriptionRollover = () => {
	clearTranscriptionRolloverTimeout();

	transcriptionRolloverTimeoutId = setTimeout(() => {
		transcriptionRolloverTimeoutId = null;
		void handleDesktopTransportInterrupted({
			message: "Realtime transcription session reached the rollover window.",
			planned: true,
			speaker: "you",
		});
	}, realtimeSessionRolloverMs);
};

const createDesktopRealtimeSessionConfig = ({ lang, source, speaker }) => {
	const language = normalizeTranscriptionLanguage(lang);
	return createDesktopRealtimeTranscriptionSession({
		language,
		source,
		speaker,
	});
};

const sendDesktopRealtimeAudioChunk = ({ audio, socket }) => {
	socket.send(
		JSON.stringify({
			type: "input_audio_buffer.append",
			audio,
		}),
	);
};

const createDesktopRealtimeClientSecret = async ({ lang, source, speaker }) => {
	if (!process.env.OPENAI_API_KEY) {
		const baseUrl = process.env.CONVEX_SITE_URL?.trim();

		if (!baseUrl) {
			throw new Error("CONVEX_SITE_URL is not configured.");
		}

		const response = await fetch(
			new URL("/api/realtime-transcription-session", baseUrl),
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					lang,
					source,
					speaker,
				}),
			},
		);
		const payload = await response.json().catch(() => ({}));

		if (!response.ok) {
			throw new Error(
				payload?.error?.message ||
					payload?.error ||
					"Failed to create realtime transcription session.",
			);
		}

		const clientSecret = payload?.clientSecret;

		if (!clientSecret || typeof clientSecret !== "string") {
			throw new Error("OpenAI did not return a realtime client secret.");
		}

		return clientSecret;
	}

	const requestId = randomUUID();
	const response = await fetch(
		"https://api.openai.com/v1/realtime/client_secrets",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
				"X-Client-Request-Id": requestId,
			},
			body: JSON.stringify({
				expires_after: {
					anchor: "created_at",
					seconds: 600,
				},
				session: createDesktopRealtimeSessionConfig({
					lang,
					source,
					speaker,
				}),
			}),
		},
	);

	logOpenAiResponseMetadata({
		context: "desktop.realtime.client_secret",
		requestId,
		response,
	});

	const payload = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(
			payload?.error?.message ||
				"Failed to create realtime transcription session.",
		);
	}

	const clientSecret = payload?.value;

	if (!clientSecret) {
		throw new Error("OpenAI did not return a realtime client secret.");
	}

	return clientSecret;
};

const startDesktopRealtimeTransport = async ({ lang, source, speaker }) => {
	if (process.platform !== "darwin") {
		throw new Error(
			"Desktop realtime transcription transport is only available on macOS.",
		);
	}
	const language = normalizeTranscriptionLanguage(lang);

	if (!process.env.OPENAI_API_KEY && !canUseHostedDesktopAi()) {
		throw new Error(
			"Realtime transcription is not configured for this desktop build.",
		);
	}

	const captureSession =
		source === "microphone"
			? microphoneCaptureSession
			: systemAudioCaptureSession;

	if (!captureSession?.sampleRate) {
		throw new Error("Desktop audio capture is not active.");
	}

	await stopDesktopRealtimeTransport(speaker);
	const clientSecret = await createDesktopRealtimeClientSecret({
		lang,
		source,
		speaker,
	});
	const profile = resolveDesktopRealtimeProfile({
		source,
		speaker,
	});

	return await new Promise((resolvePromise, rejectPromise) => {
		let didResolve = false;
		const resampleChunk = createPcm16Resampler(
			captureSession.sampleRate,
			24_000,
		);
		const socket = new WebSocket(
			"wss://api.openai.com/v1/realtime?intent=transcription",
			{
				headers: {
					Authorization: `Bearer ${clientSecret}`,
				},
			},
		);
		const session = {
			isClosing: false,
			openTimeout: setTimeout(() => {
				if (didResolve) {
					return;
				}

				rejectPromise(
					new Error(
						"Timed out while connecting desktop realtime transcription.",
					),
				);
				socket.terminate();
			}, desktopRealtimeConnectTimeoutMs),
			pendingAudio: [],
			profile,
			socket,
			source,
			speaker,
			language,
			unsubscribeCapture: null,
		};

		logDesktopTurnDebug("transport.session_started", {
			language,
			profile,
			source,
			speaker,
		});

		console.info("[desktop-realtime] starting transport", {
			language,
			profile,
			source,
			speaker,
		});

		const flushPendingAudio = () => {
			if (socket.readyState !== WebSocket.OPEN) {
				return;
			}

			for (const pendingAudio of session.pendingAudio) {
				sendDesktopRealtimeAudioChunk({
					audio: pendingAudio,
					socket,
				});
			}
			session.pendingAudio = [];
		};

		const finalizeStartError = (error) => {
			console.warn("[desktop-realtime] transport start failed", {
				didResolve,
				message: error instanceof Error ? error.message : String(error),
				profile,
				source,
				speaker,
			});

			if (didResolve) {
				void handleDesktopRealtimeTransportEvent({
					speaker,
					type: "interrupted",
					message:
						error instanceof Error
							? error.message
							: "Realtime transcription failed.",
				});
				return;
			}

			didResolve = true;
			rejectPromise(error);
		};

		session.unsubscribeCapture = subscribeToCaptureEvents(source, (event) => {
			if (session.isClosing) {
				return;
			}

			if (event.type === "chunk" && event.pcm16) {
				const audio = resampleChunk(event.pcm16);

				if (!audio) {
					return;
				}

				if (socket.readyState !== WebSocket.OPEN) {
					session.pendingAudio.push(audio);
					if (
						session.pendingAudio.length > desktopRealtimePendingAudioChunkLimit
					) {
						session.pendingAudio.shift();
					}
					return;
				}

				sendDesktopRealtimeAudioChunk({
					audio,
					socket,
				});
				return;
			}

			if (event.type === "error" || event.type === "stopped") {
				void handleDesktopRealtimeTransportEvent({
					speaker,
					type: "interrupted",
					message: event.message ?? "Desktop audio capture was interrupted.",
				});
				void stopDesktopRealtimeTransport(speaker);
			}
		});

		desktopRealtimeTransportSessions.set(speaker, session);

		socket.on("open", () => {
			logDesktopTurnDebug("transport.session_open", {
				language,
				profile,
				source,
				speaker,
			});
			console.info("[desktop-realtime] transport open", {
				language,
				profile,
				source,
				speaker,
			});
			clearTimeout(session.openTimeout);
			flushPendingAudio();

			if (!didResolve) {
				didResolve = true;
				resolvePromise({
					ok: true,
				});
			}
		});

		socket.on("message", (rawValue) => {
			try {
				const payload = JSON.parse(String(rawValue));

				if (payload?.type === "error" && !didResolve) {
					finalizeStartError(
						new Error(
							payload.error?.message ??
								"Realtime transcription failed during session initialization.",
						),
					);
					return;
				}

				const transportEvent = parseDesktopRealtimeTransportEvent({
					event: payload,
					speaker,
				});

				if (transportEvent) {
					notifyDesktopRealtimeStopFlushEvent(session, transportEvent);
					void handleDesktopRealtimeTransportEvent(transportEvent);
				}
			} catch (error) {
				console.error(
					"[desktop-realtime] failed to parse websocket event",
					error,
				);
			}
		});

		socket.on("error", (error) => {
			clearTimeout(session.openTimeout);
			console.warn("[desktop-realtime] socket error", {
				didResolve,
				isClosing: session.isClosing,
				message: error instanceof Error ? error.message : String(error),
				profile,
				socketState: socket.readyState,
				source,
				speaker,
			});
			finalizeStartError(error);
		});

		socket.on("close", (code, reasonBuffer) => {
			clearTimeout(session.openTimeout);
			session.unsubscribeCapture?.();
			session.unsubscribeCapture = null;

			const reason = Buffer.isBuffer(reasonBuffer)
				? reasonBuffer.toString("utf8")
				: String(reasonBuffer ?? "");

			console.warn("[desktop-realtime] socket close", {
				code,
				didResolve,
				isClosing: session.isClosing,
				profile,
				reason,
				socketState: socket.readyState,
				source,
				speaker,
			});

			if (desktopRealtimeTransportSessions.get(speaker) === session) {
				desktopRealtimeTransportSessions.delete(speaker);
			}

			if (!session.isClosing) {
				void handleDesktopRealtimeTransportEvent({
					speaker,
					type: "interrupted",
					message: "Realtime transcription connection was interrupted.",
				});
			}
		});
	});
};

const requestTranscriptionAutoStart = (autoStartKey) => {
	if (
		autoStartKey == null ||
		transcriptionLastHandledAutoStartKey === autoStartKey ||
		["starting", "listening", "reconnecting"].includes(
			latestTranscriptionSessionState.phase,
		)
	) {
		return;
	}

	void startDesktopTranscriptionSession().then((didStart) => {
		if (didStart) {
			transcriptionLastHandledAutoStartKey = autoStartKey;
		}
	});
};

const configureDesktopTranscriptionSession = ({
	autoStartKey = null,
	lang,
	scopeKey = null,
}) => {
	const previousScopeKey = transcriptionConfig.scopeKey;
	transcriptionConfig = {
		autoStartKey,
		lang,
		scopeKey,
	};

	patchTranscriptionSessionState({
		autoStartKey,
		isAvailable: getDesktopRealtimeAvailability(),
		scopeKey,
	});
	refreshTranscriptionPolicy();

	if (previousScopeKey !== scopeKey) {
		transcriptionLastHandledAutoStartKey = null;
		void stopDesktopTranscriptionSession({
			preserveUtterances: false,
			resetError: true,
			resetRecovery: true,
		});
	}

	if (autoStartKey != null) {
		requestTranscriptionAutoStart(autoStartKey);
	}
};

const appendTranscriptionTailUtterance = (speaker) => {
	const state = transcriptionSpeakers[speaker];
	const liveEntry = latestTranscriptionSessionState.liveTranscript[speaker];
	const source = speaker === "them" ? "systemAudio" : "microphone";
	const text = liveEntry.text.trim();

	if (
		!shouldKeepInterruptedTranscriptTurn({
			source,
			text,
		})
	) {
		return;
	}

	appendTranscriptionUtterance({
		endedAt: Date.now(),
		id: `${state.sessionId ?? "session"}:${speaker}:manual:${randomUUID()}`,
		speaker,
		startedAt: liveEntry.startedAt ?? Date.now(),
		text,
	});
};

const stopTranscriptionSpeaker = async (speaker) => {
	const state = transcriptionSpeakers[speaker];

	if (speaker === "you") {
		await stopDesktopRealtimeTransport("you");
		appendTranscriptionTailUtterance(speaker);
		await stopMicrophoneCapture();
	} else {
		await stopDesktopRealtimeTransport("them");
		appendTranscriptionTailUtterance(speaker);
		await stopSystemAudioCapture();
	}

	await state.captureDispose?.();
	transcriptionSpeakers[speaker] = createTranscriptionSpeakerRuntime(speaker);
	clearTranscriptionLiveTranscript(speaker);
};

const cleanupDesktopTranscriptionSession = async ({
	operationId,
	preserveUtterances,
}) => {
	await Promise.all([
		stopTranscriptionSpeaker("you"),
		stopTranscriptionSpeaker("them"),
	]);
	clearTranscriptionRolloverTimeout();

	if (transcriptionLifecycleOperationId !== operationId) {
		return;
	}

	patchTranscriptionSessionState({
		isConnecting: false,
		isListening: false,
		liveTranscript: createEmptyLiveTranscriptState(),
		phase: "idle",
		systemAudioStatus: transcriptionPolicy
			? resolveCurrentSystemAudioStatus(transcriptionPolicy)
			: latestTranscriptionSessionState.systemAudioStatus,
		utterances: preserveUtterances
			? latestTranscriptionSessionState.utterances
			: [],
	});
};

const handleDesktopRealtimeTransportEvent = async (event) => {
	const state = transcriptionSpeakers[event.speaker];

	if (!state.transportActive) {
		return;
	}

	if (event.type === "committed") {
		const existingTurn = state.turns.get(event.itemId);
		const startedAt =
			existingTurn?.startedAt ??
			latestTranscriptionSessionState.liveTranscript[event.speaker].startedAt ??
			Date.now();
		logDesktopTurnDebug("transport.committed", {
			hasExistingTurn: Boolean(existingTurn),
			itemId: event.itemId,
			liveItemId: state.liveItemId,
			previousItemId: event.previousItemId,
			speaker: event.speaker,
			turnCompleted: existingTurn?.completed ?? false,
			turnFailed: existingTurn?.failed ?? false,
		});
		upsertTranscriptionTurn(event.speaker, event.itemId, {
			previousItemId: event.previousItemId,
			startedAt,
		});

		emitTranscriptionOrderedTurns(event.speaker);
		return;
	}

	if (event.type === "partial") {
		const existingTurn = state.turns.get(event.itemId);
		const nextTurn = upsertTranscriptionTurn(event.speaker, event.itemId, {
			failed: false,
			logprobs: event.logprobs ?? existingTurn?.logprobs ?? null,
			startedAt: existingTurn?.startedAt ?? Date.now(),
			text: `${existingTurn?.text ?? ""}${event.textDelta}`,
		});

		if (!existingTurn) {
			logDesktopTurnDebug("transport.partial_started", {
				itemId: event.itemId,
				liveItemId: state.liveItemId,
				speaker: event.speaker,
				...summarizeTranscriptTextForLog(nextTurn.text),
			});
		} else if (state.liveItemId && state.liveItemId !== event.itemId) {
			logDesktopTurnDebug("transport.partial_replaced_live_item", {
				itemId: event.itemId,
				replacedItemId: state.liveItemId,
				speaker: event.speaker,
				...summarizeTranscriptTextForLog(nextTurn.text),
			});
		}

		state.liveItemId = event.itemId;
		updateTranscriptionLiveTranscript(event.speaker, {
			startedAt: nextTurn.startedAt,
			text: nextTurn.text,
		});
		return;
	}

	if (event.type === "turn_failed") {
		const existingTurn = state.turns.get(event.itemId);
		const source = event.speaker === "them" ? "systemAudio" : "microphone";
		const interruptedText =
			existingTurn?.text ||
			latestTranscriptionSessionState.liveTranscript[event.speaker].text ||
			"";
		const shouldKeepInterruptedText = shouldKeepInterruptedTranscriptTurn({
			logprobs: existingTurn?.logprobs ?? null,
			source,
			text: interruptedText,
		});
		logDesktopTurnDebug("transport.turn_failed", {
			itemId: event.itemId,
			keepInterruptedText: shouldKeepInterruptedText,
			liveItemId: state.liveItemId,
			message: event.message,
			speaker: event.speaker,
			...summarizeTranscriptTextForLog(interruptedText),
		});
		upsertTranscriptionTurn(event.speaker, event.itemId, {
			completed: shouldKeepInterruptedText,
			failed: !shouldKeepInterruptedText,
			logprobs: shouldKeepInterruptedText
				? (existingTurn?.logprobs ?? null)
				: null,
			startedAt:
				existingTurn?.startedAt ??
				latestTranscriptionSessionState.liveTranscript[event.speaker]
					.startedAt ??
				Date.now(),
			text: shouldKeepInterruptedText ? interruptedText : "",
		});

		if (state.liveItemId === event.itemId) {
			state.liveItemId = null;
			clearTranscriptionLiveTranscript(event.speaker, {
				itemId: event.itemId,
				reason: shouldKeepInterruptedText
					? "turn_failed_salvaged"
					: "turn_failed_dropped",
			});
		}

		emitTranscriptionOrderedTurns(event.speaker);
		return;
	}

	if (event.type === "final") {
		const existingTurn = state.turns.get(event.itemId);
		const finalText =
			event.text ||
			existingTurn?.text ||
			latestTranscriptionSessionState.liveTranscript[event.speaker].text;
		const source = event.speaker === "them" ? "systemAudio" : "microphone";

		logDesktopTurnDebug("transport.final", {
			itemId: event.itemId,
			liveItemId: state.liveItemId,
			speaker: event.speaker,
			...summarizeTranscriptConfidenceForLog({
				logprobs: event.logprobs ?? existingTurn?.logprobs ?? null,
				source,
				text: finalText,
			}),
			...summarizeTranscriptTextForLog(finalText),
		});
		upsertTranscriptionTurn(event.speaker, event.itemId, {
			completed: true,
			failed: false,
			logprobs: event.logprobs ?? existingTurn?.logprobs ?? null,
			startedAt:
				existingTurn?.startedAt ??
				latestTranscriptionSessionState.liveTranscript[event.speaker]
					.startedAt ??
				Date.now(),
			text:
				event.text ||
				existingTurn?.text ||
				latestTranscriptionSessionState.liveTranscript[event.speaker].text,
		});
		emitTranscriptionOrderedTurns(event.speaker);
		return;
	}

	await handleDesktopTransportInterrupted({
		message: event.message,
		speaker: event.speaker,
	});
};

const connectDesktopTranscriptionSpeaker = async ({
	lang,
	operationId,
	source,
	sourceMode,
	speaker,
}) => {
	if (speaker === "you") {
		await startMicrophoneCapture();
	} else {
		await startSystemAudioCapture();
	}

	if (!isCurrentTranscriptionOperation(operationId)) {
		if (speaker === "you") {
			await stopMicrophoneCapture().catch(() => {});
		} else {
			await stopSystemAudioCapture().catch(() => {});
		}
		return false;
	}

	try {
		await startDesktopRealtimeTransport({
			lang,
			source,
			speaker,
		});
	} catch (error) {
		if (speaker === "you") {
			await stopMicrophoneCapture().catch(() => {});
		} else {
			await stopSystemAudioCapture().catch(() => {});
		}
		throw error;
	}

	if (!isCurrentTranscriptionOperation(operationId)) {
		await stopDesktopRealtimeTransport(speaker).catch(() => {});
		if (speaker === "you") {
			await stopMicrophoneCapture().catch(() => {});
		} else {
			await stopSystemAudioCapture().catch(() => {});
		}
		return false;
	}

	const state = transcriptionSpeakers[speaker];
	state.activeSourceMode = sourceMode;
	state.sessionId ??= currentTranscriptionSessionCorrelationId;
	state.transportActive = true;
};

const scheduleAutomaticSystemAudioAttachRetry = ({
	attempt,
	message,
	operationId,
}) => {
	if (
		attempt >= systemAudioAttachRetryBackoffMs.length ||
		transcriptionLifecycleOperationId !== operationId ||
		latestTranscriptionSessionState.phase !== "listening" ||
		transcriptionSpeakers.them.transportActive
	) {
		return false;
	}

	const policy = transcriptionPolicy ?? refreshTranscriptionPolicy();
	if (
		!policy.systemAudioCapability.shouldAutoBootstrap ||
		policy.systemAudioCapability.sourceMode !== "desktop-native"
	) {
		return false;
	}

	clearSystemAudioAttachRetryTimeout();
	systemAudioAttachRetryAttempt = attempt + 1;

	const delay =
		systemAudioAttachRetryBackoffMs[attempt] ??
		systemAudioAttachRetryBackoffMs[systemAudioAttachRetryBackoffMs.length - 1];

	console.warn("[transcription] scheduling automatic system audio retry", {
		attempt: systemAudioAttachRetryAttempt,
		delay,
		message,
	});

	systemAudioAttachRetryTimeoutId = setTimeout(() => {
		systemAudioAttachRetryTimeoutId = null;

		if (
			transcriptionLifecycleOperationId !== operationId ||
			latestTranscriptionSessionState.phase !== "listening" ||
			transcriptionSpeakers.them.transportActive
		) {
			return;
		}

		void attachDesktopSystemAudio({
			automatic: true,
			attempt: systemAudioAttachRetryAttempt,
			operationId,
		});
	}, delay);

	return true;
};

const attachDesktopSystemAudio = async ({
	automatic,
	attempt = 0,
	operationId,
}) => {
	if (transcriptionPendingSystemAudioAttachPromise) {
		return await transcriptionPendingSystemAudioAttachPromise;
	}

	const attachPromise = (async () => {
		const policy = transcriptionPolicy ?? refreshTranscriptionPolicy();

		if (
			!isCurrentTranscriptionOperation(operationId) ||
			!policy.systemAudioCapability.isSupported ||
			policy.systemAudioCapability.sourceMode !== "desktop-native" ||
			transcriptionSpeakers.them.transportActive
		) {
			return false;
		}

		try {
			const didConnect = await connectDesktopTranscriptionSpeaker({
				lang: transcriptionConfig.lang,
				operationId,
				source: "systemAudio",
				sourceMode: policy.systemAudioCapability.sourceMode,
				speaker: "them",
			});

			if (!didConnect || !isCurrentTranscriptionOperation(operationId)) {
				return false;
			}

			patchTranscriptionSessionState({
				systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
			});

			clearSystemAudioAttachRetryTimeout({
				resetAttempt: true,
			});
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn("[transcription] system audio attach failed", {
				automatic,
				attempt,
				message,
			});
			patchTranscriptionSessionState({
				systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
			});

			if (automatic) {
				scheduleAutomaticSystemAudioAttachRetry({
					attempt,
					message,
					operationId,
				});
			}

			return false;
		}
	})();

	transcriptionPendingSystemAudioAttachPromise = attachPromise;

	try {
		return await attachPromise;
	} finally {
		if (transcriptionPendingSystemAudioAttachPromise === attachPromise) {
			transcriptionPendingSystemAudioAttachPromise = null;
		}
	}
};

const runDesktopTranscriptionStart = async ({ preserveUtterances, reason }) => {
	const operationId = ++transcriptionLifecycleOperationId;
	clearTranscriptionReconnectTimeout();
	clearTranscriptionRolloverTimeout();
	clearSystemAudioAttachRetryTimeout({
		resetAttempt: true,
	});
	const policy = transcriptionPolicy ?? refreshTranscriptionPolicy();
	transcriptionPolicy = policy;
	currentTranscriptionSessionCorrelationId = randomUUID();

	patchTranscriptionSessionState({
		error: null,
		isConnecting: true,
		isListening: false,
		liveTranscript: createEmptyLiveTranscriptState(),
		phase: reason === "reconnect" ? "reconnecting" : "starting",
		recoveryStatus:
			reason === "reconnect"
				? latestTranscriptionSessionState.recoveryStatus
				: createTranscriptRecoveryStatus(),
		systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
		utterances: preserveUtterances
			? latestTranscriptionSessionState.utterances
			: [],
	});

	try {
		await ensureDesktopMicrophonePermissionGranted();
		await connectDesktopTranscriptionSpeaker({
			lang: transcriptionConfig.lang,
			operationId,
			source: "microphone",
			sourceMode: "unsupported",
			speaker: "you",
		});

		if (transcriptionLifecycleOperationId !== operationId) {
			return false;
		}

		transcriptionRecoveryAttempt = 0;
		patchTranscriptionSessionState({
			error: null,
			isConnecting: false,
			isListening: true,
			phase: "listening",
			recoveryStatus: createTranscriptRecoveryStatus(),
		});
		scheduleTranscriptionRollover();

		if (policy.systemAudioCapability.shouldAutoBootstrap) {
			void attachDesktopSystemAudio({
				automatic: true,
				operationId,
			});
		}

		return true;
	} catch (error) {
		if (transcriptionLifecycleOperationId !== operationId) {
			return false;
		}

		const normalizedError = normalizeTranscriptionError(error);
		await cleanupDesktopTranscriptionSession({
			operationId,
			preserveUtterances,
		});
		patchTranscriptionSessionState({
			error: normalizedError,
			isConnecting: false,
			isListening: false,
			liveTranscript: createEmptyLiveTranscriptState(),
			phase: "failed",
			recoveryStatus: createTranscriptRecoveryStatus({
				attempt: transcriptionRecoveryAttempt,
				maxAttempts: maxRecoveryAttempts,
				message: normalizedError.message,
				state: "failed",
			}),
			systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
			utterances: preserveUtterances
				? latestTranscriptionSessionState.utterances
				: [],
		});

		if (normalizedError.code === "permission_denied") {
			emitTranscriptionSessionEvent({
				type: "session.permission_failure",
				error: normalizedError,
			});
		}

		return false;
	}
};

async function handleDesktopTransportInterrupted({
	message,
	planned = false,
	speaker,
}) {
	console.warn("[transcription] transport interrupted", {
		message,
		phase: latestTranscriptionSessionState.phase,
		speaker,
		themActive: transcriptionSpeakers.them.transportActive,
		youActive: transcriptionSpeakers.you.transportActive,
	});

	if (latestTranscriptionSessionState.phase === "stopping") {
		return;
	}

	if (speaker === "them") {
		await stopTranscriptionSpeaker("them");
		clearSystemAudioAttachRetryTimeout({
			resetAttempt: true,
		});
		patchTranscriptionSessionState({
			error: null,
			isConnecting: false,
			isListening: transcriptionSpeakers.you.transportActive,
			phase: transcriptionSpeakers.you.transportActive ? "listening" : "idle",
			systemAudioStatus: transcriptionPolicy
				? resolveCurrentSystemAudioStatus(transcriptionPolicy)
				: {
						sourceMode: "unsupported",
						state: "unsupported",
					},
		});

		if (
			transcriptionPolicy?.systemAudioCapability.shouldAutoBootstrap &&
			transcriptionSpeakers.you.transportActive
		) {
			scheduleAutomaticSystemAudioAttachRetry({
				attempt: 0,
				message,
				operationId: transcriptionLifecycleOperationId,
			});
		}

		return;
	}

	const operationId = ++transcriptionLifecycleOperationId;
	await cleanupDesktopTranscriptionSession({
		operationId,
		preserveUtterances: true,
	});

	if (planned) {
		transcriptionRecoveryAttempt = 0;
		patchTranscriptionSessionState({
			error: null,
			isConnecting: true,
			isListening: false,
			phase: "reconnecting",
			recoveryStatus: createTranscriptRecoveryStatus({
				attempt: 0,
				maxAttempts: maxRecoveryAttempts,
				message,
				state: "reconnecting",
			}),
		});

		transcriptionReconnectTimeoutId = setTimeout(() => {
			transcriptionReconnectTimeoutId = null;
			void runDesktopTranscriptionStart({
				preserveUtterances: true,
				reason: "reconnect",
			});
		}, 0);
		return;
	}

	const nextAttempt = transcriptionRecoveryAttempt + 1;
	if (nextAttempt > maxRecoveryAttempts) {
		patchTranscriptionSessionState({
			error: {
				code: "connection_failed",
				message,
			},
			phase: "failed",
			recoveryStatus: createTranscriptRecoveryStatus({
				attempt: transcriptionRecoveryAttempt,
				maxAttempts: maxRecoveryAttempts,
				message,
				state: "failed",
			}),
		});
		return;
	}

	transcriptionRecoveryAttempt = nextAttempt;
	patchTranscriptionSessionState({
		error: null,
		isConnecting: true,
		isListening: false,
		phase: "reconnecting",
		recoveryStatus: createTranscriptRecoveryStatus({
			attempt: nextAttempt,
			maxAttempts: maxRecoveryAttempts,
			message,
			state: "reconnecting",
		}),
	});

	const delay =
		recoveryBackoffMs[nextAttempt - 1] ??
		recoveryBackoffMs[recoveryBackoffMs.length - 1];
	transcriptionReconnectTimeoutId = setTimeout(() => {
		transcriptionReconnectTimeoutId = null;
		void runDesktopTranscriptionStart({
			preserveUtterances: true,
			reason: "reconnect",
		});
	}, delay);
}

const startDesktopTranscriptionSession = async () => {
	await transcriptionPendingStopPromise;

	if (transcriptionPendingStartPromise) {
		return await transcriptionPendingStartPromise;
	}

	const startPromise = runDesktopTranscriptionStart({
		preserveUtterances: false,
		reason: "manual",
	}).finally(() => {
		if (transcriptionPendingStartPromise === startPromise) {
			transcriptionPendingStartPromise = null;
		}
	});

	transcriptionPendingStartPromise = startPromise;
	return await startPromise;
};

const stopDesktopTranscriptionSession = async ({
	preserveUtterances = true,
	resetError = false,
	resetRecovery = true,
} = {}) => {
	if (transcriptionPendingStopPromise) {
		return await transcriptionPendingStopPromise;
	}

	const operationId = ++transcriptionLifecycleOperationId;
	clearTranscriptionReconnectTimeout();
	clearTranscriptionRolloverTimeout();
	clearSystemAudioAttachRetryTimeout({
		resetAttempt: true,
	});
	patchTranscriptionSessionState({
		isConnecting: false,
		isListening: false,
		phase: "stopping",
	});

	const stopPromise = cleanupDesktopTranscriptionSession({
		operationId,
		preserveUtterances,
	})
		.finally(() => {
			if (transcriptionPendingStopPromise === stopPromise) {
				transcriptionPendingStopPromise = null;
			}
		})
		.then(() => {
			transcriptionRecoveryAttempt = 0;
			currentTranscriptionSessionCorrelationId = null;
			patchTranscriptionSessionState({
				error: resetError ? null : latestTranscriptionSessionState.error,
				isConnecting: false,
				isListening: false,
				liveTranscript: createEmptyLiveTranscriptState(),
				phase:
					latestTranscriptionSessionState.phase === "failed"
						? "failed"
						: "idle",
				recoveryStatus: resetRecovery
					? createTranscriptRecoveryStatus()
					: latestTranscriptionSessionState.recoveryStatus,
				systemAudioStatus: transcriptionPolicy
					? resolveCurrentSystemAudioStatus(transcriptionPolicy)
					: latestTranscriptionSessionState.systemAudioStatus,
				utterances: preserveUtterances
					? latestTranscriptionSessionState.utterances
					: [],
			});
		});

	transcriptionPendingStopPromise = stopPromise;
	return await stopPromise;
};

const requestDesktopTranscriptionSystemAudio = async () => {
	if (latestTranscriptionSessionState.phase !== "listening") {
		return false;
	}

	clearSystemAudioAttachRetryTimeout({
		resetAttempt: true,
	});
	return await attachDesktopSystemAudio({
		automatic: false,
		operationId: transcriptionLifecycleOperationId,
	});
};

const detachDesktopTranscriptionSystemAudio = async () => {
	clearSystemAudioAttachRetryTimeout({
		resetAttempt: true,
	});
	await stopTranscriptionSpeaker("them");

	patchTranscriptionSessionState({
		systemAudioStatus: transcriptionPolicy
			? resolveCurrentSystemAudioStatus(transcriptionPolicy)
			: latestTranscriptionSessionState.systemAudioStatus,
	});
};

const stopMicrophoneCapture = async () => {
	if (!microphoneCaptureSession) {
		return;
	}

	const session = microphoneCaptureSession;
	microphoneCaptureSession = null;
	session.isStopping = true;

	if (session.cleanupTimeout) {
		clearTimeout(session.cleanupTimeout);
		session.cleanupTimeout = null;
	}

	clearCaptureHealthTimeout(session);

	session.lineReader?.removeAllListeners();
	session.process.stdout?.removeAllListeners();
	session.process.stderr?.removeAllListeners();
	session.process.removeAllListeners();

	await new Promise((resolvePromise) => {
		const finalize = () => {
			resolvePromise();
		};

		session.process.once("exit", finalize);
		session.process.kill("SIGTERM");

		setTimeout(() => {
			if (!session.process.killed) {
				session.process.kill("SIGKILL");
			}
			finalize();
		}, 1_000);
	});

	emitMicrophoneCaptureEvent({
		type: "stopped",
	});
};

const stopSystemAudioCapture = async () => {
	if (!systemAudioCaptureSession) {
		return;
	}

	const session = systemAudioCaptureSession;
	systemAudioCaptureSession = null;
	session.isStopping = true;

	if (session.cleanupTimeout) {
		clearTimeout(session.cleanupTimeout);
		session.cleanupTimeout = null;
	}

	clearCaptureHealthTimeout(session);

	session.lineReader?.removeAllListeners();
	session.process.stdout?.removeAllListeners();
	session.process.stderr?.removeAllListeners();
	session.process.removeAllListeners();

	await new Promise((resolvePromise) => {
		const finalize = () => {
			resolvePromise();
		};

		session.process.once("exit", finalize);
		session.process.kill("SIGTERM");

		setTimeout(() => {
			if (!session.process.killed) {
				session.process.kill("SIGKILL");
			}
			finalize();
		}, 1_000);
	});

	emitSystemAudioCaptureEvent({
		type: "stopped",
	});
};

const stopMicrophoneActivityMonitor = async () => {
	clearMeetingDetectionDebounceTimeout();

	if (!microphoneActivitySession) {
		syncMeetingDetectionState({
			candidateStartedAt: null,
			confidence: 0,
			isMicrophoneActive: false,
			sourceName: null,
			status: "idle",
		});
		hideMeetingWidgetWindow();
		return;
	}

	const session = microphoneActivitySession;
	microphoneActivitySession = null;
	session.isStopping = true;

	if (session.cleanupTimeout) {
		clearTimeout(session.cleanupTimeout);
		session.cleanupTimeout = null;
	}

	session.lineReader?.removeAllListeners();
	session.process.stdout?.removeAllListeners();
	session.process.stderr?.removeAllListeners();
	session.process.removeAllListeners();

	await new Promise((resolvePromise) => {
		const finalize = () => {
			resolvePromise();
		};

		session.process.once("exit", finalize);
		session.process.kill("SIGTERM");

		setTimeout(() => {
			if (!session.process.killed) {
				session.process.kill("SIGKILL");
			}
			finalize();
		}, 1_000);
	});

	syncMeetingDetectionState({
		candidateStartedAt: null,
		confidence: 0,
		isMicrophoneActive: false,
		sourceName: null,
		status: "idle",
	});
	hideMeetingWidgetWindow();
};

const startMicrophoneActivityMonitor = async () => {
	if (process.platform !== "darwin") {
		return false;
	}

	const helperPath = resolveMicrophoneActivityHelperPath();
	if (!helperPath) {
		console.warn("[meeting-detection] microphone activity helper is missing");
		return false;
	}

	await stopMicrophoneActivityMonitor();

	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(helperPath, [], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const lineReader = createInterface({
			input: child.stdout,
			crlfDelay: Infinity,
		});
		let didResolve = false;
		let session;

		const failStart = (error) => {
			if (didResolve) {
				console.error(
					"[meeting-detection] microphone activity helper failed after start",
					error,
				);
				void stopMicrophoneActivityMonitor();
				return;
			}

			didResolve = true;
			rejectPromise(error);
		};

		const startupTimeout = setTimeout(() => {
			failStart(
				new Error("Timed out while starting the microphone activity monitor."),
			);
			child.kill("SIGKILL");
		}, 5_000);

		session = {
			cleanupTimeout: startupTimeout,
			isStopping: false,
			lineReader,
			process: child,
		};
		microphoneActivitySession = session;

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			const message = String(chunk).trim();
			if (message) {
				console.error("[microphone-activity-helper]", message);
			}
		});

		lineReader.on("line", (line) => {
			let event;

			try {
				event = JSON.parse(line);
			} catch (error) {
				console.error(
					"[meeting-detection] failed to parse microphone activity event",
					error,
					line,
				);
				return;
			}

			if (event?.type !== "ready" && event?.type !== "active-changed") {
				return;
			}

			const eventSequence = ++microphoneActivityEventSequence;
			void (async () => {
				const isActive = event.active === true;
				const sourceName = isActive
					? await resolveNativeMeetingDetectionSourceName(event.sourceName)
					: null;

				if (
					microphoneActivitySession !== session ||
					eventSequence !== microphoneActivityEventSequence
				) {
					return;
				}

				syncMeetingDetectionState({
					...(event.type === "ready"
						? {
								dismissedUntil:
									latestMeetingDetectionState.dismissedUntil ?? null,
							}
						: {}),
					isMicrophoneActive: isActive,
					sourceName,
				});
				reevaluateMeetingDetection();

				if (event.type === "ready") {
					clearTimeout(startupTimeout);
					session.cleanupTimeout = null;
					if (!didResolve) {
						didResolve = true;
						resolvePromise(true);
					}
				}
			})().catch((error) => {
				console.error(
					"[meeting-detection] failed to handle microphone activity event",
					error,
				);
				if (event?.type === "ready" && !didResolve) {
					failStart(error);
				}
			});
		});

		child.on("error", (error) => {
			clearTimeout(startupTimeout);
			if (microphoneActivitySession === session) {
				microphoneActivitySession = null;
			}
			failStart(error);
		});

		child.on("exit", (code, signal) => {
			clearTimeout(startupTimeout);
			if (microphoneActivitySession === session) {
				microphoneActivitySession = null;
			}

			if (!session.isStopping) {
				console.error("[meeting-detection] microphone activity helper exited", {
					code,
					signal,
				});
				syncMeetingDetectionState({
					candidateStartedAt: null,
					confidence: 0,
					isMicrophoneActive: false,
					sourceName: null,
					status: "idle",
				});
				hideMeetingWidgetWindow();
			}

			if (!didResolve && !session.isStopping) {
				failStart(
					new Error(
						`Microphone activity monitor exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
					),
				);
			}
		});
	});
};

const startMicrophoneCapture = async () => {
	if (process.platform !== "darwin") {
		throw new Error("Native microphone capture is only available on macOS.");
	}

	const helperPath = resolveMicrophoneHelperPath();
	if (!helperPath) {
		throw new Error("The macOS microphone helper is missing.");
	}

	console.info("[microphone] starting macOS helper", {
		helperPath,
	});

	const requestId = ++microphoneCaptureStartRequestId;
	await stopMicrophoneCapture();

	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(helperPath, [], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const lineReader = createInterface({
			input: child.stdout,
			crlfDelay: Infinity,
		});
		let didResolve = false;
		let session;

		const rejectStart = (error) => {
			if (requestId !== microphoneCaptureStartRequestId) {
				console.info("[microphone] ignoring stale helper start failure", {
					requestId,
					currentRequestId: microphoneCaptureStartRequestId,
					message: error instanceof Error ? error.message : String(error),
				});
				return;
			}

			console.error(
				"[microphone] helper failed to start",
				error instanceof Error ? error.message : error,
			);
			if (didResolve) {
				emitMicrophoneCaptureEvent({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
				return;
			}

			didResolve = true;
			rejectPromise(error);
		};

		const resolveStart = (payload) => {
			if (requestId !== microphoneCaptureStartRequestId) {
				console.info("[microphone] ignoring stale helper ready event", {
					requestId,
					currentRequestId: microphoneCaptureStartRequestId,
				});
				return;
			}

			if (didResolve) {
				return;
			}

			console.info("[microphone] helper reported ready", payload);
			logDesktopTurnDebug("microphone.helper_ready", {
				channels: payload?.channels ?? null,
				route:
					payload?.route && typeof payload.route === "object"
						? payload.route
						: null,
				sampleRate: payload?.sampleRate ?? null,
				voiceProcessingEnabled: payload?.voiceProcessingEnabled === true,
				voiceProcessingOutputEnabled:
					payload?.voiceProcessingOutputEnabled === true,
			});
			didResolve = true;
			resolvePromise(payload);
		};

		const cleanupTimeout = setTimeout(() => {
			if (requestId !== microphoneCaptureStartRequestId) {
				console.info("[microphone] cleared stale helper startup timeout", {
					requestId,
					currentRequestId: microphoneCaptureStartRequestId,
				});
				return;
			}

			console.error("[microphone] helper startup timed out after 5000ms");
			rejectStart(
				new Error("Timed out while starting macOS microphone capture."),
			);
			child.kill("SIGKILL");
		}, 5_000);

		const resetHealthTimeout = () => {
			if (!session || session.isStopping) {
				return;
			}

			clearCaptureHealthTimeout(session);
			session.healthTimeout = setTimeout(() => {
				if (microphoneCaptureSession !== session || session.isStopping) {
					return;
				}

				const timeoutError = new Error(
					"Timed out while receiving macOS microphone audio frames.",
				);
				console.error("[microphone] helper stopped producing audio frames");

				if (didResolve) {
					emitMicrophoneCaptureEvent({
						type: "error",
						message: timeoutError.message,
					});
				} else {
					rejectStart(timeoutError);
				}

				child.kill("SIGKILL");
			}, captureHealthTimeoutMs);
		};

		session = {
			isStopping: false,
			cleanupTimeout,
			healthTimeout: null,
			lineReader,
			process: child,
			requestId,
			sampleRate: null,
		};
		microphoneCaptureSession = session;

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			const message = String(chunk).trim();
			if (message) {
				console.error("[microphone-helper]", message);
			}
		});

		lineReader.on("line", (line) => {
			let event;

			try {
				event = JSON.parse(line);
			} catch (error) {
				console.error("Failed to parse microphone helper event", error, line);
				return;
			}

			if (event?.type !== "chunk") {
				console.info("[microphone] helper event", event?.type ?? "unknown");
			}

			if (event?.type === "ready") {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				session.sampleRate = Number(event.sampleRate) || 48_000;
				resetHealthTimeout();
				resolveStart({
					channels: Number(event.channels) || 1,
					route:
						event?.route && typeof event.route === "object"
							? event.route
							: null,
					sampleRate: session.sampleRate,
					voiceProcessingEnabled: event?.voiceProcessingEnabled === true,
					voiceProcessingOutputEnabled:
						event?.voiceProcessingOutputEnabled === true,
				});
				return;
			}

			if (event?.type === "error") {
				const nextError = new Error(
					typeof event.message === "string"
						? event.message
						: "Microphone capture failed.",
				);
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				rejectStart(nextError);
				return;
			}

			if (event?.type === "chunk") {
				resetHealthTimeout();
			}

			emitMicrophoneCaptureEvent(event);
		});

		child.on("error", (error) => {
			clearTimeout(cleanupTimeout);
			session.cleanupTimeout = null;
			clearCaptureHealthTimeout(session);
			if (microphoneCaptureSession === session) {
				microphoneCaptureSession = null;
			}
			console.error("[microphone] helper process error", error);
			rejectStart(error);
		});

		child.on("exit", (code, signal) => {
			clearTimeout(cleanupTimeout);
			session.cleanupTimeout = null;
			clearCaptureHealthTimeout(session);
			if (microphoneCaptureSession === session) {
				microphoneCaptureSession = null;
			}

			console.info("[microphone] helper exited", {
				code,
				signal,
				didResolve,
				isStopping: session.isStopping,
			});

			if (!session.isStopping && !didResolve) {
				rejectStart(
					new Error(
						`Microphone capture exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
					),
				);
				return;
			}

			if (!session.isStopping) {
				emitMicrophoneCaptureEvent({
					type: "stopped",
					code,
					signal,
				});
			}
		});
	});
};

const startSystemAudioCapture = async () => {
	if (process.platform !== "darwin") {
		throw new Error("Native system audio capture is only available on macOS.");
	}

	const helperPath = resolveSystemAudioHelperPath();
	if (!helperPath) {
		throw new Error("The macOS system-audio helper is missing.");
	}

	console.info("[system-audio] starting macOS helper", {
		helperPath,
	});

	const requestId = ++systemAudioCaptureStartRequestId;
	await stopSystemAudioCapture();

	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(helperPath, [], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const lineReader = createInterface({
			input: child.stdout,
			crlfDelay: Infinity,
		});
		let didResolve = false;
		let session;

		const rejectStart = (error) => {
			if (requestId !== systemAudioCaptureStartRequestId) {
				console.info("[system-audio] ignoring stale helper start failure", {
					requestId,
					currentRequestId: systemAudioCaptureStartRequestId,
					message: error instanceof Error ? error.message : String(error),
				});
				return;
			}

			if (isLikelySystemAudioPermissionError(error)) {
				markSystemAudioPermissionBlocked();
			} else if (systemAudioPermissionState !== "granted") {
				markSystemAudioPermissionPrompt();
			}

			console.error(
				"[system-audio] helper failed to start",
				error instanceof Error ? error.message : error,
			);
			if (didResolve) {
				emitSystemAudioCaptureEvent({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
				return;
			}

			didResolve = true;
			rejectPromise(error);
		};

		const resolveStart = (payload) => {
			if (requestId !== systemAudioCaptureStartRequestId) {
				console.info("[system-audio] ignoring stale helper ready event", {
					requestId,
					currentRequestId: systemAudioCaptureStartRequestId,
				});
				return;
			}

			if (didResolve) {
				return;
			}

			console.info("[system-audio] helper reported ready", payload);
			markSystemAudioPermissionGranted();
			didResolve = true;
			resolvePromise(payload);
		};

		const cleanupTimeout = setTimeout(() => {
			if (requestId !== systemAudioCaptureStartRequestId) {
				console.info("[system-audio] cleared stale helper startup timeout", {
					requestId,
					currentRequestId: systemAudioCaptureStartRequestId,
				});
				return;
			}

			console.error("[system-audio] helper startup timed out after 5000ms");
			rejectStart(
				new Error("Timed out while starting macOS system audio capture."),
			);
			child.kill("SIGKILL");
		}, 5_000);

		const resetHealthTimeout = () => {
			if (!session || session.isStopping) {
				return;
			}

			clearCaptureHealthTimeout(session);
			session.healthTimeout = setTimeout(() => {
				if (systemAudioCaptureSession !== session || session.isStopping) {
					return;
				}

				const timeoutError = new Error(
					"Timed out while receiving macOS system audio frames.",
				);
				console.error("[system-audio] helper stopped producing audio frames");

				if (didResolve) {
					emitSystemAudioCaptureEvent({
						type: "error",
						message: timeoutError.message,
					});
				} else {
					rejectStart(timeoutError);
				}

				child.kill("SIGKILL");
			}, captureHealthTimeoutMs);
		};

		session = {
			isStopping: false,
			cleanupTimeout,
			healthTimeout: null,
			lineReader,
			process: child,
			requestId,
			sampleRate: null,
		};
		systemAudioCaptureSession = session;

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			const message = String(chunk).trim();
			if (message) {
				console.error("[system-audio-helper]", message);
			}
		});

		lineReader.on("line", (line) => {
			let event;

			try {
				event = JSON.parse(line);
			} catch (error) {
				console.error("Failed to parse system audio helper event", error, line);
				return;
			}

			if (event?.type !== "chunk") {
				console.info("[system-audio] helper event", event?.type ?? "unknown");
			}

			if (event?.type === "ready") {
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				session.sampleRate = Number(event.sampleRate) || 48_000;
				resetHealthTimeout();
				resolveStart({
					channels: Number(event.channels) || 1,
					sampleRate: session.sampleRate,
				});
				return;
			}

			if (event?.type === "error") {
				const nextError = new Error(
					typeof event.message === "string"
						? event.message
						: "System audio capture failed.",
				);
				clearTimeout(cleanupTimeout);
				session.cleanupTimeout = null;
				clearCaptureHealthTimeout(session);
				rejectStart(nextError);
				return;
			}

			if (event?.type === "chunk") {
				resetHealthTimeout();
			}

			emitSystemAudioCaptureEvent(event);
		});

		child.on("error", (error) => {
			clearTimeout(cleanupTimeout);
			session.cleanupTimeout = null;
			clearCaptureHealthTimeout(session);
			if (systemAudioCaptureSession === session) {
				systemAudioCaptureSession = null;
			}
			console.error("[system-audio] helper process error", error);
			rejectStart(error);
		});

		child.on("exit", (code, signal) => {
			clearTimeout(cleanupTimeout);
			session.cleanupTimeout = null;
			clearCaptureHealthTimeout(session);
			if (systemAudioCaptureSession === session) {
				systemAudioCaptureSession = null;
			}

			console.info("[system-audio] helper exited", {
				code,
				signal,
				didResolve,
				isStopping: session.isStopping,
			});

			if (!session.isStopping && !didResolve) {
				rejectStart(
					new Error(
						`System audio capture exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
					),
				);
				return;
			}

			if (!session.isStopping) {
				emitSystemAudioCaptureEvent({
					type: "stopped",
					code,
					signal,
				});
			}
		});
	});
};

const getNavigationUrl = async ({
	pathname = "/home",
	search = "",
	hash = "",
} = {}) => {
	const targetUrl = new URL(await resolveRendererUrl());
	targetUrl.pathname = pathname;
	targetUrl.search = search;
	targetUrl.hash = hash;

	return targetUrl.toString();
};

const buildAuthCallbackUrl = async (callbackUrl) => {
	const rendererUrl = new URL(await resolveRendererUrl());
	const incomingUrl = new URL(callbackUrl);
	const authError = incomingUrl.searchParams.get("error");
	const authErrorDescription =
		incomingUrl.searchParams.get("error_description");

	rendererUrl.pathname = "/home";
	rendererUrl.hash = "";
	rendererUrl.search = "";

	if (authError) {
		rendererUrl.searchParams.set("authError", authError);
	}

	if (authErrorDescription) {
		rendererUrl.searchParams.set("authErrorDescription", authErrorDescription);
	}

	return rendererUrl.toString();
};

const getDesktopAuthCallbackUrl = async () => {
	const server = await ensureLocalServer();
	return `${server.origin}/auth/callback`;
};

const showMainWindow = async (options = {}) => {
	const hasExplicitNavigation =
		"pathname" in options || "search" in options || "hash" in options;

	if (!mainWindow) {
		const targetUrl = await getNavigationUrl(
			hasExplicitNavigation ? options : lastNavigation,
		);
		await createMainWindow(targetUrl);
	} else if (hasExplicitNavigation) {
		await navigateMainWindow(options);
	}

	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	}

	ensureDockVisible();
	ensureAppActive();
	mainWindow.show();
	mainWindow.focus();
};

const navigateMainWindow = async (options = {}) => {
	if (!mainWindow) {
		return;
	}

	const targetUrl = new URL(await getNavigationUrl(options));
	const currentUrlString = mainWindow.webContents.getURL();

	if (!currentUrlString || mainWindow.webContents.isLoadingMainFrame()) {
		await mainWindow.loadURL(targetUrl.toString());
		return;
	}

	try {
		const currentUrl = new URL(currentUrlString);

		if (
			currentUrl.origin !== targetUrl.origin ||
			(currentUrl.pathname === targetUrl.pathname &&
				currentUrl.search === targetUrl.search &&
				currentUrl.hash === targetUrl.hash)
		) {
			if (currentUrl.toString() !== targetUrl.toString()) {
				await mainWindow.loadURL(targetUrl.toString());
			}
			return;
		}
	} catch {
		await mainWindow.loadURL(targetUrl.toString());
		return;
	}

	mainWindow.webContents.send(desktopNavigationChannel, {
		hash: targetUrl.hash,
		pathname: targetUrl.pathname,
		search: targetUrl.search,
	});
	await rememberRendererNavigation(targetUrl.toString());
};

const handleDesktopAuthCallback = async (callbackUrl) => {
	const incomingUrl = new URL(callbackUrl);
	const oneTimeToken = incomingUrl.searchParams.get("ott");

	if (oneTimeToken) {
		await verifyDesktopOneTimeToken(oneTimeToken);
	}

	const targetUrl = await buildAuthCallbackUrl(callbackUrl);

	if (!mainWindow) {
		await createMainWindow(targetUrl);
	} else {
		await mainWindow.loadURL(targetUrl);
	}

	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	}

	ensureDockVisible();
	ensureAppActive();
	mainWindow.show();
	mainWindow.focus();
};

const createMainWindow = async (targetUrl) => {
	const navigationUrl = targetUrl ?? (await getNavigationUrl(lastNavigation));
	const isMac = process.platform === "darwin";

	mainWindow = new BrowserWindow({
		width: defaultWindowSize.width,
		height: defaultWindowSize.height,
		minWidth: minimumWindowSize.width,
		minHeight: minimumWindowSize.height,
		title: "OpenGran",
		icon: dockIconPath,
		backgroundColor: getMainWindowBackgroundColor(),
		autoHideMenuBar: true,
		titleBarStyle: isMac ? "hiddenInset" : "default",
		trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
		webPreferences: {
			preload: join(runtimeDir, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	if (!hasConfiguredDisplayMediaHandler) {
		hasConfiguredDisplayMediaHandler = true;
		mainWindow.webContents.session.setDisplayMediaRequestHandler(
			async (_request, callback) => {
				const sources = await desktopCapturer.getSources({
					types: ["screen"],
					thumbnailSize: {
						width: 1,
						height: 1,
					},
				});
				const primarySource = sources[0];

				if (!primarySource) {
					callback({});
					return;
				}

				callback(
					process.platform === "win32"
						? {
								video: primarySource,
								audio: "loopback",
							}
						: {
								video: primarySource,
							},
				);
			},
			{
				useSystemPicker: true,
			},
		);
	}

	mainWindow.on("close", (event) => {
		if (
			isQuitting ||
			process.platform !== "darwin" ||
			!traySettings.keepOpenInMenuBar
		) {
			return;
		}

		event.preventDefault();
		hideMainWindow();
	});

	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	mainWindow.webContents.on("before-input-event", (event, input) => {
		const key = input.key?.toLowerCase();

		if (key === "r" && (input.meta || input.control)) {
			event.preventDefault();
		}
	});

	mainWindow.webContents.on("did-navigate", (_event, url) => {
		void rememberRendererNavigation(url);
	});
	mainWindow.webContents.on("did-navigate-in-page", (_event, url) => {
		void rememberRendererNavigation(url);
	});

	await mainWindow.loadURL(navigationUrl);
	ensureDockVisible();
};

const getMicrophonePermission = () => {
	if (process.platform !== "darwin" && process.platform !== "win32") {
		return {
			id: "microphone",
			description:
				"During your meetings, OpenGran transcribes your microphone.",
			required: false,
			state: "unsupported",
			canRequest: false,
			canOpenSystemSettings: false,
		};
	}

	if (process.platform === "darwin" && !resolveMicrophoneHelperPath()) {
		return {
			id: "microphone",
			description: "The macOS microphone helper is missing from this build.",
			required: true,
			state: "unsupported",
			canRequest: false,
			canOpenSystemSettings: false,
		};
	}

	const rawStatus = systemPreferences.getMediaAccessStatus("microphone");
	const canRequest =
		process.platform === "darwin" && rawStatus === "not-determined";

	return {
		id: "microphone",
		description: "During your meetings, OpenGran transcribes your microphone.",
		required: true,
		state:
			rawStatus === "granted"
				? "granted"
				: rawStatus === "denied" || rawStatus === "restricted"
					? "blocked"
					: rawStatus === "not-determined"
						? canRequest
							? "prompt"
							: "blocked"
						: "unknown",
		canRequest,
		canOpenSystemSettings: true,
	};
};

const getSystemAudioPermission = () => {
	if (process.platform === "win32") {
		return {
			id: "systemAudio",
			description:
				"During your meetings, OpenGran transcribes your system audio output.",
			required: false,
			state: "granted",
			canRequest: false,
			canOpenSystemSettings: false,
		};
	}

	if (process.platform === "darwin") {
		const helperPath = resolveSystemAudioHelperPath();

		return {
			id: "systemAudio",
			description: helperPath
				? "During your meetings, OpenGran transcribes your system audio output."
				: "The macOS system-audio helper is missing from this build.",
			required: false,
			state: helperPath ? systemAudioPermissionState : "unsupported",
			canRequest:
				Boolean(helperPath) && systemAudioPermissionState === "prompt",
			canOpenSystemSettings:
				Boolean(helperPath) && systemAudioPermissionState === "blocked",
		};
	}

	return {
		id: "systemAudio",
		description:
			"System audio capture is not available on this desktop platform.",
		required: false,
		state: "unsupported",
		canRequest: false,
		canOpenSystemSettings: false,
	};
};

const getPermissionsStatus = () => ({
	isDesktop: true,
	platform: process.platform,
	permissions: [getMicrophonePermission(), getSystemAudioPermission()],
});

const getDesktopPreferences = () => {
	const canLaunchAtLogin =
		app.isPackaged === true &&
		(process.platform === "darwin" || process.platform === "win32");

	if (!canLaunchAtLogin) {
		return {
			launchAtLogin: false,
			canLaunchAtLogin: false,
		};
	}

	return {
		launchAtLogin: app.getLoginItemSettings().openAtLogin === true,
		canLaunchAtLogin: true,
	};
};

const setLaunchAtLogin = async (enabled) => {
	if (typeof enabled !== "boolean") {
		throw new Error("Launch at login must be a boolean.");
	}

	if (!getDesktopPreferences().canLaunchAtLogin) {
		throw new Error(
			"Launch at login is not available on this desktop platform.",
		);
	}

	app.setLoginItemSettings({
		openAtLogin: enabled,
	});

	return getDesktopPreferences();
};

const requestPermission = async (permissionId) => {
	if (permissionId === "systemAudio") {
		if (process.platform !== "darwin") {
			throw new Error("Unsupported desktop permission.");
		}

		if (getMicrophonePermission().state !== "granted") {
			throw new Error("Enable microphone before system audio.");
		}

		try {
			await startSystemAudioCapture();
			await stopSystemAudioCapture();
		} catch (error) {
			await stopSystemAudioCapture().catch(() => {});

			if (isLikelySystemAudioPermissionError(error)) {
				markSystemAudioPermissionBlocked();
				throw new Error(
					"System audio access is blocked. Enable it in System Settings > Privacy & Security > Screen & System Audio Recording, then try again.",
				);
			}

			markSystemAudioPermissionPrompt();
			throw error;
		}

		refreshTranscriptionPolicy();
		return getPermissionsStatus();
	}

	if (permissionId !== "microphone") {
		throw new Error("Unsupported desktop permission.");
	}

	if (
		process.platform === "darwin" &&
		systemPreferences.getMediaAccessStatus("microphone") === "not-determined"
	) {
		await systemPreferences.askForMediaAccess("microphone");
	}

	refreshTranscriptionPolicy();
	return getPermissionsStatus();
};

const openPermissionSettings = async (permissionId) => {
	if (permissionId === "systemAudio") {
		if (process.platform !== "darwin") {
			throw new Error("Unsupported desktop permission.");
		}

		markSystemAudioPermissionPrompt();
		await shell.openExternal(
			"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
		);

		return { ok: true };
	}

	if (permissionId !== "microphone") {
		throw new Error("Unsupported desktop permission.");
	}

	if (process.platform === "darwin") {
		const currentStatus = systemPreferences.getMediaAccessStatus("microphone");

		// macOS only lists an app in Privacy > Microphone after it has asked once.
		if (currentStatus === "not-determined") {
			await systemPreferences.askForMediaAccess("microphone");
		}

		if (systemPreferences.getMediaAccessStatus("microphone") === "granted") {
			return { ok: true };
		}
	}

	const settingsUrl =
		process.platform === "darwin"
			? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
			: process.platform === "win32"
				? "ms-settings:privacy-microphone"
				: null;

	if (!settingsUrl) {
		throw new Error("System settings are not available on this platform.");
	}

	await shell.openExternal(settingsUrl);

	return { ok: true };
};

const openSoundSettings = async () => {
	if (process.platform !== "darwin") {
		throw new Error("Sound settings are only available on macOS.");
	}

	await shell.openExternal(
		"x-apple.systempreferences:com.apple.Sound-Settings.extension",
	);

	return { ok: true };
};

ipcMain.handle("app:get-meta", () => ({
	name: app.getName(),
	version: app.getVersion(),
	platform: process.platform,
}));

ipcMain.handle("app:get-runtime-config", async () => {
	return await getRuntimeConfig();
});

ipcMain.handle("app:get-preferences", async () => {
	return getDesktopPreferences();
});

ipcMain.handle("app:set-native-theme", async (_event, themeSource) => {
	return applyDesktopThemeSource(themeSource);
});

ipcMain.handle("app:auth-fetch", async (_event, request) => {
	if (!request || typeof request !== "object") {
		throw new Error("Auth request payload must be an object.");
	}

	const method =
		typeof request.method === "string" && request.method.trim()
			? request.method.toUpperCase()
			: "GET";
	const path =
		typeof request.path === "string" && request.path.startsWith("/")
			? request.path
			: null;

	if (!path) {
		throw new Error("Auth request path must start with '/'.");
	}

	const headers =
		request.headers && typeof request.headers === "object"
			? Object.fromEntries(
					Object.entries(request.headers).filter(
						([key, value]) =>
							typeof key === "string" && typeof value === "string",
					),
				)
			: {};

	const desktopAuthClient = getDesktopAuthClient();
	const cookie = desktopAuthClient.getCookie();

	if (cookie) {
		headers.cookie = cookie;
	}

	if (method !== "GET" && method !== "HEAD" && !headers["content-type"]) {
		headers["content-type"] = "application/json";
	}

	const body =
		method === "GET" || method === "HEAD"
			? undefined
			: headers["content-type"]?.includes("application/json") &&
					request.body !== undefined &&
					request.body !== null &&
					typeof request.body !== "string"
				? JSON.stringify(request.body)
				: request.body;

	return await desktopAuthClient.$fetch(path, {
		method,
		body,
		headers,
		throw: Boolean(request.throw),
	});
});

ipcMain.handle("app:get-permissions-status", () => getPermissionsStatus());

ipcMain.handle("app:get-transcription-session-state", async () => {
	return latestTranscriptionSessionState;
});

ipcMain.handle("app:get-meeting-detection-state", async () => {
	return latestMeetingDetectionState;
});

ipcMain.handle(
	"app:configure-transcription-session",
	async (_event, options) => {
		if (!options || typeof options !== "object") {
			throw new Error("Transcription session options are required.");
		}

		configureDesktopTranscriptionSession(options);
		return { ok: true };
	},
);

ipcMain.handle("app:start-transcription-session", async () => {
	return await startDesktopTranscriptionSession();
});

ipcMain.handle("app:stop-transcription-session", async () => {
	await stopDesktopTranscriptionSession();
	return { ok: true };
});

ipcMain.handle("app:request-transcription-system-audio", async () => {
	return await requestDesktopTranscriptionSystemAudio();
});

ipcMain.handle("app:detach-transcription-system-audio", async () => {
	await detachDesktopTranscriptionSystemAudio();
	return { ok: true };
});

ipcMain.handle("app:start-detected-meeting-note", async () => {
	await startDetectedMeetingNote();
	return { ok: true };
});

ipcMain.handle("app:dismiss-detected-meeting-widget", async () => {
	dismissDetectedMeetingWidget();
	return { ok: true };
});

ipcMain.on("app:report-meeting-widget-size", (event, size) => {
	if (
		!meetingWidgetWindow ||
		meetingWidgetWindow.isDestroyed() ||
		event.sender !== meetingWidgetWindow.webContents
	) {
		return;
	}

	updateMeetingWidgetWindowSize(size);
});

if (areDesktopTestHooksEnabled) {
	ipcMain.handle("app:test-show-meeting-widget", async () => {
		await showMeetingWidgetForTest();
		return { ok: true };
	});

	ipcMain.handle("app:test-reset-meeting-detection", async () => {
		resetMeetingDetectionForTest();
		return { ok: true };
	});
}

ipcMain.handle("app:open-external-url", async (_event, url) => {
	if (typeof url !== "string" || !url.startsWith("http")) {
		throw new Error("Invalid external URL.");
	}

	await shell.openExternal(url);
	return { ok: true };
});

ipcMain.handle("app:request-permission", async (_event, permissionId) => {
	if (typeof permissionId !== "string") {
		throw new Error("Permission id must be a string.");
	}

	return await requestPermission(permissionId);
});

ipcMain.handle("app:open-permission-settings", async (_event, permissionId) => {
	if (typeof permissionId !== "string") {
		throw new Error("Permission id must be a string.");
	}

	return await openPermissionSettings(permissionId);
});

ipcMain.handle("app:open-sound-settings", async () => {
	return await openSoundSettings();
});

ipcMain.handle("app:set-launch-at-login", async (_event, enabled) => {
	return await setLaunchAtLogin(enabled);
});

ipcMain.handle("app:start-system-audio-capture", async () => {
	return await startSystemAudioCapture();
});

ipcMain.handle("app:stop-system-audio-capture", async () => {
	await stopSystemAudioCapture();
	return { ok: true };
});

ipcMain.handle("app:start-microphone-capture", async () => {
	return await startMicrophoneCapture();
});

ipcMain.handle("app:stop-microphone-capture", async () => {
	await stopMicrophoneCapture();
	return { ok: true };
});

ipcMain.handle("app:get-auth-callback-url", async () => {
	return {
		url: await getDesktopAuthCallbackUrl(),
	};
});

ipcMain.handle("app:get-share-base-url", async () => {
	const shareBaseUrl =
		process.env.SITE_URL?.trim() || (await resolveRendererUrl());

	return {
		url: shareBaseUrl,
	};
});

ipcMain.handle("app:set-active-workspace-id", async (_event, workspaceId) => {
	if (workspaceId !== null && typeof workspaceId !== "string") {
		throw new Error("Workspace id must be a string or null.");
	}

	trayCalendarWorkspaceId = workspaceId;
	activeWorkspaceNotificationPreferences =
		createInitialNotificationPreferences();
	reevaluateMeetingDetection();
	scheduleTrayCalendarRefresh(0);
	return { ok: true };
});

ipcMain.handle(
	"app:set-active-workspace-notification-preferences",
	async (_event, payload) => {
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new Error("Notification preferences payload is invalid.");
		}

		const {
			workspaceId,
			notifyForScheduledMeetings,
			notifyForAutoDetectedMeetings,
		} = payload;

		if (workspaceId !== null && typeof workspaceId !== "string") {
			throw new Error("Workspace id must be a string or null.");
		}

		if (
			typeof notifyForScheduledMeetings !== "boolean" ||
			typeof notifyForAutoDetectedMeetings !== "boolean"
		) {
			throw new Error("Notification preference values must be booleans.");
		}

		if (workspaceId !== trayCalendarWorkspaceId) {
			return { ok: true };
		}

		activeWorkspaceNotificationPreferences = {
			notifyForScheduledMeetings,
			notifyForAutoDetectedMeetings,
		};
		reevaluateMeetingDetection();
		scheduleTrayCalendarRefresh(0);
		return { ok: true };
	},
);

ipcMain.handle("app:write-clipboard-text", async (_event, value) => {
	if (typeof value !== "string") {
		throw new Error("Clipboard value must be a string.");
	}

	clipboard.writeText(value);
	return { ok: true };
});

ipcMain.handle("app:write-clipboard-rich-text", async (_event, payload) => {
	if (
		!payload ||
		typeof payload !== "object" ||
		typeof payload.html !== "string" ||
		typeof payload.text !== "string"
	) {
		throw new Error("Clipboard payload must include html and text strings.");
	}

	clipboard.write({
		html: payload.html,
		text: payload.text,
	});
	return { ok: true };
});

ipcMain.handle("app:load-transcript-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Transcript draft key must be a non-empty string.");
	}

	return await loadTranscriptDraft(noteKey.trim());
});

ipcMain.handle("app:save-transcript-draft", async (_event, noteKey, draft) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Transcript draft key must be a non-empty string.");
	}

	if (!draft || typeof draft !== "object") {
		throw new Error("Transcript draft payload must be an object.");
	}

	return await saveTranscriptDraft({
		noteKey: noteKey.trim(),
		draft,
	});
});

ipcMain.handle("app:clear-transcript-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Transcript draft key must be a non-empty string.");
	}

	return await clearTranscriptDraft(noteKey.trim());
});

ipcMain.handle("app:load-note-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	return await loadNoteDraft(noteKey.trim());
});

ipcMain.handle("app:save-note-draft", async (_event, noteKey, draft) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	if (!draft || typeof draft !== "object") {
		throw new Error("Note draft payload must be an object.");
	}

	return await saveNoteDraft({
		noteKey: noteKey.trim(),
		draft,
	});
});

ipcMain.handle("app:clear-note-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	return await clearNoteDraft(noteKey.trim());
});

ipcMain.handle("app:share-local-folders", async (_event, paths) => {
	return await shareLocalFolders(paths);
});

ipcMain.handle(
	"app:save-text-file",
	async (_event, defaultFileName, content) => {
		if (typeof defaultFileName !== "string" || !defaultFileName.trim()) {
			throw new Error("Default file name must be a non-empty string.");
		}

		if (typeof content !== "string") {
			throw new Error("File content must be a string.");
		}

		const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
			defaultPath: defaultFileName,
			filters: [{ name: "Text", extensions: ["txt"] }],
		});

		if (result.canceled || !result.filePath) {
			return { ok: true, canceled: true };
		}

		await writeFile(result.filePath, content, "utf8");

		return {
			ok: true,
			canceled: false,
			filePath: result.filePath,
		};
	},
);

const quitCompletely = () => {
	isBypassingQuitConfirmation = true;
	isQuitting = true;
	app.quit();
};

const promptToConfirmQuitCompletely = async () => {
	if (isPromptingForQuitConfirmation) {
		return false;
	}

	isPromptingForQuitConfirmation = true;

	try {
		const parentWindow =
			mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
				? mainWindow
				: undefined;
		const dialogOptions = {
			type: "question",
			buttons: ["Cancel", "Quit"],
			defaultId: 1,
			cancelId: 0,
			noLink: true,
			title: `Quit ${app.getName()}?`,
			message: `Quit ${app.getName()}?`,
			detail: "Notifications for upcoming meetings will stop",
			icon: nativeImage.createFromPath(dockIconPath),
		};
		const { response } = parentWindow
			? await dialog.showMessageBox(parentWindow, dialogOptions)
			: await dialog.showMessageBox(dialogOptions);

		return response === 1;
	} finally {
		isPromptingForQuitConfirmation = false;
	}
};

const setNativeUpdateProgress = (progressFraction) => {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	mainWindow.setProgressBar(progressFraction);
};

const showUpdateMessageBox = async ({
	type = "info",
	title = "Software Update",
	message,
	detail,
	buttons = ["OK"],
	defaultId = 0,
	cancelId = defaultId,
}) => {
	const parentWindow =
		mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
			? mainWindow
			: undefined;
	const dialogOptions = {
		type,
		buttons,
		defaultId,
		cancelId,
		noLink: true,
		title,
		message,
		detail,
		icon: nativeImage.createFromPath(dockIconPath),
	};

	return parentWindow
		? await dialog.showMessageBox(parentWindow, dialogOptions)
		: await dialog.showMessageBox(dialogOptions);
};

const showAboutMessageBox = async () => {
	const parentWindow =
		mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
			? mainWindow
			: undefined;
	const version = app.getVersion();
	const currentYear = new Date().getFullYear();
	const dialogOptions = {
		type: "info",
		buttons: ["OK"],
		defaultId: 0,
		cancelId: 0,
		noLink: true,
		title: `About ${app.getName()}`,
		message: app.getName(),
		detail: [
			`Version ${version} (${version})`,
			`Copyright © ${currentYear} ${app.getName()}`,
		].join("\n"),
		icon: nativeImage.createFromPath(dockIconPath),
	};

	return parentWindow
		? await dialog.showMessageBox(parentWindow, dialogOptions)
		: await dialog.showMessageBox(dialogOptions);
};

const confirmAndQuitCompletely = async () => {
	if (!(await promptToConfirmQuitCompletely())) {
		return;
	}

	quitCompletely();
};

const promptToInstallDownloadedUpdate = async (version) => {
	const { response } = await showUpdateMessageBox({
		type: "question",
		message: `OpenGran ${version} has finished downloading.`,
		detail: "Install now or keep working and update on quit.",
		buttons: ["Later", "Install and Restart"],
		defaultId: 1,
		cancelId: 0,
	});

	if (response !== 1) {
		return;
	}

	isBypassingQuitConfirmation = true;
	isQuitting = true;
	autoUpdater.quitAndInstall();
};

const configureAutoUpdater = () => {
	if (!isUpdaterAvailable()) {
		return;
	}

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("checking-for-update", () => {
		isCheckingForUpdates = true;
		setTrayStatusLabel("Checking for updates...");
		setNativeUpdateProgress(0.02);
	});

	autoUpdater.on("update-available", (info) => {
		hasPendingUpdateDownload = false;
		pendingUpdateVersion = info.version;
		setTrayStatusLabel(`Downloading OpenGran ${info.version}...`);
		setNativeUpdateProgress(0.03);
	});

	autoUpdater.on("download-progress", (progress) => {
		setTrayStatusLabel(
			`Downloading update... ${Math.round(progress.percent)}%`,
		);
		setNativeUpdateProgress(
			Math.max(0.03, Math.min(1, Number(progress.percent ?? 0) / 100)),
		);
	});

	autoUpdater.on("update-not-available", async () => {
		isCheckingForUpdates = false;
		hasPendingUpdateDownload = false;
		pendingUpdateVersion = null;
		setTrayStatusLabel("OpenGran is up to date");
		setNativeUpdateProgress(-1);

		if (!shouldShowUpdateResultDialogs) {
			return;
		}

		shouldShowUpdateResultDialogs = false;
		await showUpdateMessageBox({
			message: "You're up to date.",
			detail: `OpenGran ${app.getVersion()} is currently the newest version available.`,
		});
	});

	autoUpdater.on("update-downloaded", async (info) => {
		isCheckingForUpdates = false;
		hasPendingUpdateDownload = true;
		pendingUpdateVersion = info.version;
		shouldShowUpdateResultDialogs = false;
		setTrayStatusLabel(`OpenGran ${info.version} is ready to install`);
		setNativeUpdateProgress(-1);
		await promptToInstallDownloadedUpdate(info.version);
	});

	autoUpdater.on("error", async (error) => {
		isCheckingForUpdates = false;
		setTrayStatusLabel("Update check failed");
		setNativeUpdateProgress(-1);
		console.error("Auto updater failed", error);

		if (!shouldShowUpdateResultDialogs) {
			return;
		}

		shouldShowUpdateResultDialogs = false;
		await showUpdateMessageBox({
			type: "error",
			message: "Update check failed.",
			detail: [
				"OpenGran couldn't check for updates.",
				error instanceof Error ? error.message : String(error),
			]
				.filter(Boolean)
				.join("\n\n"),
		});
	});
};

const handleCheckForUpdates = async () => {
	if (!isUpdaterAvailable()) {
		await showUpdateMessageBox({
			message: "Updates are unavailable.",
			detail: "Updates are only available in packaged release builds.",
		});
		return;
	}

	if (isCheckingForUpdates) {
		await showUpdateMessageBox({
			message: "OpenGran is already checking for updates.",
		});
		return;
	}

	if (hasPendingUpdateDownload) {
		await promptToInstallDownloadedUpdate(
			pendingUpdateVersion ?? app.getVersion(),
		);
		return;
	}

	shouldShowUpdateResultDialogs = true;
	await autoUpdater.checkForUpdates();
};

const handleRestartApp = () => {
	isBypassingQuitConfirmation = true;
	isQuitting = true;
	app.relaunch();
	app.quit();
};

const handleDesktopSignOut = async () => {
	try {
		const desktopAuthClient = getDesktopAuthClient();
		await desktopAuthClient.$fetch("/sign-out", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({}),
			throw: true,
		});
		lastNavigation = { ...defaultLastNavigation };
		await saveLastNavigation();

		if (!mainWindow || mainWindow.isDestroyed()) {
			await showMainWindow(defaultLastNavigation);
			return;
		}

		await mainWindow.loadURL(await getNavigationUrl(defaultLastNavigation));

		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}

		ensureDockVisible();
		ensureAppActive();
		mainWindow.show();
		mainWindow.focus();
	} catch (error) {
		const errorDetails = toErrorLogDetails(error);
		console.error("Failed to sign out from desktop menu.", errorDetails);
		await showUpdateMessageBox({
			type: "error",
			title: "Sign Out Failed",
			message: `Couldn't sign out of ${app.getName()}.`,
			detail: errorDetails.message,
		});
	}
};

const buildApplicationMenu = () => {
	if (process.platform !== "darwin") {
		return null;
	}

	return Menu.buildFromTemplate([
		{
			label: app.getName(),
			submenu: [
				{
					label: `About ${app.getName()}`,
					click: () => {
						void showAboutMessageBox();
					},
				},
				{ type: "separator" },
				{
					label: "Check for updates...",
					click: () => {
						void handleCheckForUpdates();
					},
				},
				{
					label: "Settings",
					accelerator: "Command+,",
					click: () => {
						void showMainWindow({ pathname: "/settings" });
					},
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{
					label: `Hide ${app.getName()}`,
					accelerator: "Command+H",
					click: () => {
						hideApp();
					},
				},
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{
					label: "Quit",
					click: () => {
						void handleTrayQuit();
					},
				},
				{
					label: `Restart ${app.getName()}`,
					click: () => {
						handleRestartApp();
					},
				},
				{
					label: "Quit completely",
					accelerator: "Command+Q",
					click: () => {
						void confirmAndQuitCompletely();
					},
				},
				{ type: "separator" },
				{
					label: "Log out",
					click: () => {
						void handleDesktopSignOut();
					},
				},
			],
		},
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "togglefullscreen" },
				{ type: "separator" },
				{ role: "toggleDevTools" },
			],
		},
		{
			role: "window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				{ type: "separator" },
				{ role: "close" },
				{ type: "separator" },
				{ role: "front" },
			],
		},
	]);
};

const refreshApplicationMenu = () => {
	if (process.platform !== "darwin") {
		return;
	}

	Menu.setApplicationMenu(buildApplicationMenu());
};

const handleTrayQuit = async () => {
	if (!traySettings.keepOpenInMenuBar) {
		await confirmAndQuitCompletely();
		return;
	}

	hideApp({ hideDock: true });
};

const buildTrayMenu = () =>
	Menu.buildFromTemplate([
		...buildTrayCalendarMenuItems(),
		{
			label: "Open desktop",
			click: () => {
				void showMainWindow();
			},
		},
		{
			label: "Quick note",
			click: () => {
				void showMainWindow({
					pathname: "/note",
					search: "?capture=1",
				});
			},
		},
		{
			label: "Settings",
			click: () => {
				void showMainWindow({ pathname: "/settings/profile" });
			},
		},
		{
			label: `${app.getName()} v${app.getVersion()}`,
			enabled: false,
		},
		{
			label: trayStatusLabel,
			enabled: false,
		},
		{
			label: "Check for updates",
			click: () => {
				void handleCheckForUpdates();
			},
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				void handleTrayQuit();
			},
		},
		{
			label: "Quit options",
			submenu: [
				{
					label: "Keep OpenGran in the menu bar",
					type: "checkbox",
					checked: traySettings.keepOpenInMenuBar,
					click: (menuItem) => {
						traySettings = {
							...traySettings,
							keepOpenInMenuBar: menuItem.checked,
						};
						void saveTraySettings();
						refreshTrayMenu();
						void refreshTrayCalendar();
					},
				},
				{
					label: "Quit completely",
					click: () => {
						void confirmAndQuitCompletely();
					},
				},
			],
		},
	]);

const refreshTrayMenu = () => {
	if (!tray) {
		return;
	}

	tray.setTitle(getTrayTitle());
	tray.setContextMenu(buildTrayMenu());
};

const createTray = () => {
	if (tray || process.platform !== "darwin") {
		return;
	}

	const icon = nativeImage.createFromPath(trayIconPath);
	if (icon.isEmpty()) {
		console.warn(`Tray icon is missing or invalid at ${trayIconPath}.`);
		return;
	}

	icon.setTemplateImage(true);

	tray = new Tray(icon);
	tray.setToolTip(app.getName());
	refreshTrayMenu();
	tray.on("double-click", () => {
		void showMainWindow();
	});
};

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
	quitCompletely();
} else {
	app.on("second-instance", (_event, _argv) => {
		void showMainWindow();
	});

	app.whenReady().then(async () => {
		refreshTranscriptionPolicy();
		refreshApplicationMenu();

		powerMonitor.on("suspend", () => {
			if (
				!["starting", "listening", "reconnecting"].includes(
					latestTranscriptionSessionState.phase,
				)
			) {
				return;
			}

			void stopDesktopTranscriptionSession({
				preserveUtterances: true,
				resetError: true,
				resetRecovery: true,
			});
		});

		applyDockIcon();

		await loadTraySettings();
		await loadLastNavigation();
		await ensureLocalServer();
		await createMainWindow();
		await startMicrophoneActivityMonitor().catch((error) => {
			console.error("Failed to start meeting detection", error);
		});
		createTray();
		void refreshTrayCalendar();
		configureAutoUpdater();

		if (isUpdaterAvailable()) {
			setTrayStatusLabel("Checking for updates...");
			void autoUpdater.checkForUpdates().catch((error) => {
				console.error("Initial update check failed", error);
			});
		}

		app.on("activate", async () => {
			if (
				meetingWidgetWindow &&
				!meetingWidgetWindow.isDestroyed() &&
				meetingWidgetWindow.isVisible() &&
				!mainWindow?.isVisible()
			) {
				return;
			}

			await showMainWindow();
		});
	});

	app.on("window-all-closed", async () => {
		await stopDesktopRealtimeTransport("you");
		await stopDesktopRealtimeTransport("them");
		await stopMicrophoneActivityMonitor();
		await stopMicrophoneCapture();
		await stopSystemAudioCapture();
		await closeLocalServer();

		if (process.platform !== "darwin" || !traySettings.keepOpenInMenuBar) {
			quitCompletely();
		}
	});

	app.on("before-quit", (event) => {
		if (process.platform === "darwin" && !isBypassingQuitConfirmation) {
			event.preventDefault();
			void confirmAndQuitCompletely();
			return;
		}

		isQuitting = true;
		void stopDesktopRealtimeTransport("you");
		void stopDesktopRealtimeTransport("them");
		void stopMicrophoneActivityMonitor();
		void stopMicrophoneCapture();
		void stopSystemAudioCapture();
		void closeLocalServer();
	});
}
