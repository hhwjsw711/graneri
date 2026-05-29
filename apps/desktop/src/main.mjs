import { randomUUID } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	ipcMain,
	nativeImage,
	nativeTheme,
	powerMonitor,
	shell,
	systemPreferences,
} from "electron";
import electronUpdater from "electron-updater";
import WebSocket from "ws";
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
import { createDesktopAppMenu } from "./desktop-app-menu.mjs";
import {
	createDesktopNavigationState,
	getDefaultDesktopNavigation,
} from "./desktop-navigation-state.mjs";
import { createDesktopShell } from "./desktop-shell.mjs";
import { createDesktopStorage } from "./desktop-storage.mjs";
import { createDesktopTray } from "./desktop-tray.mjs";
import { createDesktopUpdater } from "./desktop-updater.mjs";
import { createDesktopWindow } from "./desktop-window.mjs";
import { loadRootEnv } from "./env.mjs";
import { startLocalServer } from "./local-server.mjs";
import {
	createInitialMeetingDetectionState,
	createMeetingDetection,
} from "./meeting-detection.mjs";
import { createNativeAudioCapture } from "./native-audio-capture.mjs";
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
const desktopRealtimeConnectTimeoutMs = 10_000;
const desktopRealtimePendingAudioChunkLimit = 50;
const desktopRealtimeStopFlushTimeoutMs = 1_500;
const desktopRealtimeStopFlushSettleTimeoutMs = 750;
const maxRecoveryAttempts = 3;
const recoveryBackoffMs = [750, 1_500, 3_000];
const systemAudioAttachRetryBackoffMs = [750, 1_500, 3_000];
const realtimeSessionRolloverMs = 29 * 60 * 1000;
const shouldLogDesktopTurnDebug =
	app.isPackaged !== true ||
	process.env.OPENGRAN_ENABLE_TRANSCRIPTION_DEBUG === "1";
const transcriptionDebugLogPath = join(
	app.getPath("temp"),
	"opengran-transcription-debug.log",
);
let hasLoggedDesktopTurnDebugSessionHeader = false;
const getMainWindowBackgroundColor = () => {
	if (process.platform === "darwin") {
		return "#00000000";
	}

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

const createInitialNotificationPreferences = () => ({
	notifyForScheduledMeetings: false,
	notifyForAutoDetectedMeetings: false,
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

const isLikelySystemAudioPermissionError = (error) => {
	const message = error instanceof Error ? error.message : String(error);

	return (
		message.includes("system-audio tap") ||
		message.includes("System audio capture exited before it became ready") ||
		message.includes("Timed out while starting macOS system audio capture")
	);
};

let mainWindow = null;
let localServer = null;
let desktopAppMenu = null;
let desktopShell = null;
let desktopTray = null;
let desktopUpdater = null;
let desktopWindow = null;
let isQuitting = false;
let isBypassingQuitConfirmation = false;
let isPromptingForQuitConfirmation = false;
let activeWorkspaceId = null;
let activeWorkspaceNotificationPreferences =
	createInitialNotificationPreferences();
const desktopStorage = createDesktopStorage({
	noteDraftsDirPath,
	transcriptDraftsDirPath,
});
let systemAudioPermissionState = "prompt";
let latestTranscriptionSessionState = createInitialTranscriptionSessionState();
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
let desktopNavigationState = null;
const areDesktopTestHooksEnabled =
	app.isPackaged !== true || process.env.OPENGRAN_ENABLE_TEST_HOOKS === "1";

const isUpdaterAvailable = () =>
	process.platform === "darwin" &&
	app.isPackaged === true &&
	process.env.OPENGRAN_DISABLE_UPDATER !== "1";

const applyDockIcon = () => {
	desktopShell?.applyDockIcon();
};
const ensureDockVisible = () => {
	desktopShell?.ensureDockVisible();
};
const ensureAppActive = () => {
	desktopShell?.ensureAppActive();
};
const hideMainWindow = () => {
	desktopShell?.hideMainWindow();
};
const hideApp = (options) => {
	desktopShell?.hideApp(options);
};

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
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

const nativeAudioCapture = createNativeAudioCapture({
	emitMicrophoneCaptureEvent,
	emitSystemAudioCaptureEvent,
	getSystemAudioPermissionState: () => systemAudioPermissionState,
	isPackaged: app.isPackaged,
	logDesktopTurnDebug: (...args) => logDesktopTurnDebug(...args),
	markSystemAudioPermissionBlocked,
	markSystemAudioPermissionGranted,
	markSystemAudioPermissionPrompt,
	runtimeDir,
});
const resolveMicrophoneHelperPath =
	nativeAudioCapture.resolveMicrophoneHelperPath;
const resolveSystemAudioHelperPath =
	nativeAudioCapture.resolveSystemAudioHelperPath;
const startMicrophoneCapture = nativeAudioCapture.startMicrophoneCapture;
const startSystemAudioCapture = nativeAudioCapture.startSystemAudioCapture;
const stopMicrophoneCapture = nativeAudioCapture.stopMicrophoneCapture;
const stopSystemAudioCapture = nativeAudioCapture.stopSystemAudioCapture;
let meetingDetection = null;
const getMeetingDetectionState = () =>
	meetingDetection?.getMeetingDetectionState() ??
	createInitialMeetingDetectionState();
const reevaluateMeetingDetection = () => {
	meetingDetection?.reevaluateMeetingDetection();
};
const startMicrophoneActivityMonitor = async () =>
	(await meetingDetection?.startMicrophoneActivityMonitor()) ?? false;
const stopMicrophoneActivityMonitor = async () => {
	await meetingDetection?.stopMicrophoneActivityMonitor();
};
const startDetectedMeetingNote = async () => {
	await meetingDetection?.startDetectedMeetingNote();
};
const dismissDetectedMeetingWidget = () => {
	meetingDetection?.dismissDetectedMeetingWidget();
};
const showMeetingWidgetForTest = async () => {
	await meetingDetection?.showMeetingWidgetForTest();
};
const resetMeetingDetectionForTest = () => {
	meetingDetection?.resetMeetingDetectionForTest();
};
const updateMeetingWidgetWindowSize = (size) => {
	meetingDetection?.updateMeetingWidgetWindowSize(size);
};
const isMeetingWidgetSender = (sender) =>
	meetingDetection?.isMeetingWidgetSender(sender) ?? false;
const isMeetingWidgetVisible = () =>
	meetingDetection?.isMeetingWidgetVisible() ?? false;
const getDetectedMeetingCalendarEvent = (...args) =>
	desktopTray?.getDetectedMeetingCalendarEvent(...args) ?? null;
const openCalendarEventNote = async (...args) => {
	await desktopTray?.openCalendarEventNote(...args);
};
const refreshTrayCalendar = async () => {
	await desktopTray?.refreshCalendar();
};
const scheduleTrayCalendarRefresh = (delayMs) => {
	desktopTray?.scheduleCalendarRefresh(delayMs);
};
const setTrayStatusLabel = (value) => {
	desktopTray?.setStatusLabel(value);
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
			getAllowedOrigins: () => {
				const developmentUrl = process.env.OPENGRAN_RENDERER_URL?.trim();
				if (!developmentUrl) {
					return [];
				}

				try {
					return [new URL(developmentUrl).origin];
				} catch {
					return [];
				}
			},
			getSharedLocalFolders: desktopStorage.getSharedLocalFolders,
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

desktopNavigationState = createDesktopNavigationState({
	lastNavigationPath,
	resolveRendererUrl,
	userDataPath: app.getPath("userData"),
});

desktopShell = createDesktopShell({
	app,
	dockIconPath,
	getMainWindow: () => mainWindow,
});

const rememberRendererNavigation = async (urlString) => {
	await desktopNavigationState?.remember(urlString);
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

	const captureSampleRate = nativeAudioCapture.getCaptureSampleRate(source);

	if (!captureSampleRate) {
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
		const resampleChunk = createPcm16Resampler(captureSampleRate, 24_000);
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

desktopWindow = createDesktopWindow({
	desktopNavigationChannel,
	dockIconPath,
	getBackgroundColor: getMainWindowBackgroundColor,
	getDefaultNavigation: () =>
		desktopNavigationState?.get() ?? getDefaultDesktopNavigation(),
	getNavigationUrl,
	isQuitting: () => isQuitting,
	onClosed: () => {
		mainWindow = null;
	},
	onHideRequested: () => hideMainWindow(),
	onWindowCreated: (window) => {
		mainWindow = window;
	},
	preloadPath: join(runtimeDir, "preload.cjs"),
	rememberNavigation: rememberRendererNavigation,
	shell: {
		ensureAppActive,
		ensureDockVisible,
	},
	shouldHideInsteadOfClose: () =>
		process.platform === "darwin" && desktopTray?.isKeepOpenInMenuBarEnabled(),
});

const showMainWindow = async (options = {}) => {
	await desktopWindow?.show(options);
};

desktopTray = createDesktopTray({
	app,
	confirmAndQuitCompletely: () => confirmAndQuitCompletely(),
	dockIconPath,
	getConvexUrl,
	getDesktopConvexToken,
	getNotificationPreferences: () => activeWorkspaceNotificationPreferences,
	onCheckForUpdates: () => handleCheckForUpdates(),
	onOpenMainWindow: (options) => showMainWindow(options),
	onQuit: () => handleTrayQuit(),
	trayIconPath,
	traySettingsPath,
	userDataPath: app.getPath("userData"),
});

desktopUpdater = createDesktopUpdater({
	appVersion: () => app.getVersion(),
	autoUpdater,
	isAvailable: isUpdaterAvailable,
	onBeforeInstall: () => {
		isBypassingQuitConfirmation = true;
		isQuitting = true;
	},
	setNativeProgress: (progressFraction) => {
		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}

		mainWindow.setProgressBar(progressFraction);
	},
	setTrayStatusLabel,
	showMessageBox: (options) => showUpdateMessageBox(options),
});

meetingDetection = createMeetingDetection({
	broadcastState: (state) =>
		broadcastToDesktopWindows({
			channel: meetingDetectionStateChannel,
			payload: state,
		}),
	dockIconPath,
	ensureDockVisible,
	getDetectedMeetingCalendarEvent,
	getNavigationUrl,
	getTranscriptionPhase: () => latestTranscriptionSessionState.phase,
	isNotificationEnabled: () =>
		activeWorkspaceNotificationPreferences.notifyForAutoDetectedMeetings,
	isPackaged: app.isPackaged,
	openCalendarEventNote,
	preloadPath: join(runtimeDir, "preload.cjs"),
	runtimeDir,
	showMainWindow,
});

const handleDesktopAuthCallback = async (callbackUrl) => {
	const incomingUrl = new URL(callbackUrl);
	const oneTimeToken = incomingUrl.searchParams.get("ott");

	if (oneTimeToken) {
		await verifyDesktopOneTimeToken(oneTimeToken);
	}

	const targetUrl = await buildAuthCallbackUrl(callbackUrl);

	await desktopWindow?.loadUrlAndFocus(targetUrl);
};

const createMainWindow = async (targetUrl) => {
	return await desktopWindow?.create(targetUrl);
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
	const server = await ensureLocalServer();
	return await getRuntimeConfig({ localApiOrigin: server.origin });
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
	return getMeetingDetectionState();
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
	if (!isMeetingWidgetSender(event.sender)) {
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

	activeWorkspaceId = workspaceId;
	desktopTray?.setActiveWorkspaceId(workspaceId);
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

		if (workspaceId !== activeWorkspaceId) {
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

	return await desktopStorage.loadTranscriptDraft(noteKey.trim());
});

ipcMain.handle("app:save-transcript-draft", async (_event, noteKey, draft) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Transcript draft key must be a non-empty string.");
	}

	if (!draft || typeof draft !== "object") {
		throw new Error("Transcript draft payload must be an object.");
	}

	return await desktopStorage.saveTranscriptDraft({
		noteKey: noteKey.trim(),
		draft,
	});
});

ipcMain.handle("app:clear-transcript-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Transcript draft key must be a non-empty string.");
	}

	return await desktopStorage.clearTranscriptDraft(noteKey.trim());
});

ipcMain.handle("app:load-note-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	return await desktopStorage.loadNoteDraft(noteKey.trim());
});

ipcMain.handle("app:save-note-draft", async (_event, noteKey, draft) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	if (!draft || typeof draft !== "object") {
		throw new Error("Note draft payload must be an object.");
	}

	return await desktopStorage.saveNoteDraft({
		noteKey: noteKey.trim(),
		draft,
	});
});

ipcMain.handle("app:clear-note-draft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	return await desktopStorage.clearNoteDraft(noteKey.trim());
});

ipcMain.handle("app:share-local-folders", async (_event, paths) => {
	return await desktopStorage.shareLocalFolders(paths);
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
		const parentWindow = desktopShell?.getVisibleMainWindow();
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

const showUpdateMessageBox = async ({
	type = "info",
	title = "Software Update",
	message,
	detail,
	buttons = ["OK"],
	defaultId = 0,
	cancelId = defaultId,
}) => {
	const parentWindow = desktopShell?.getVisibleMainWindow();
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
	const parentWindow = desktopShell?.getVisibleMainWindow();
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

const handleCheckForUpdates = async () => {
	await desktopUpdater?.checkForUpdates();
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
		await desktopNavigationState?.reset();
		const defaultLastNavigation = getDefaultDesktopNavigation();

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

desktopAppMenu = createDesktopAppMenu({
	appName: () => app.getName(),
	confirmAndQuitCompletely,
	handleCheckForUpdates,
	handleDesktopSignOut,
	handleRestartApp,
	handleTrayQuit: () => handleTrayQuit(),
	hideApp,
	showAboutMessageBox,
	showMainWindow,
});

const refreshApplicationMenu = () => {
	desktopAppMenu?.refresh();
};

const handleTrayQuit = async () => {
	if (!desktopTray?.isKeepOpenInMenuBarEnabled()) {
		await confirmAndQuitCompletely();
		return;
	}

	hideApp({ hideDock: true });
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

		await desktopTray?.loadSettings();
		await desktopNavigationState?.load();
		await ensureLocalServer();
		await createMainWindow();
		await startMicrophoneActivityMonitor().catch((error) => {
			console.error("Failed to start meeting detection", error);
		});
		desktopTray?.create();
		void refreshTrayCalendar();
		desktopUpdater?.configure();

		if (isUpdaterAvailable()) {
			setTrayStatusLabel("Checking for updates...");
			void desktopUpdater?.checkForUpdatesQuietly().catch((error) => {
				console.error("Initial update check failed", error);
			});
		}

		app.on("activate", async () => {
			if (isMeetingWidgetVisible() && !mainWindow?.isVisible()) {
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

		if (
			process.platform !== "darwin" ||
			!desktopTray?.isKeepOpenInMenuBarEnabled()
		) {
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
