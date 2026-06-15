import { BrowserWindow, screen, shell } from "electron";
import { createBrowserMeetingWindowMonitor } from "./browser-meeting-window-monitor.mjs";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";
import {
	startLineEventHelperSession,
	stopLineEventHelperSession,
} from "./line-event-helper-session.mjs";
import { logError } from "./logger.mjs";
import {
	createMeetingSignal,
	createMeetingSignalStatePatch,
	hasMeetingSignal,
	isMeetingSignalDismissed,
} from "./meeting-signal.mjs";
import { resolveNativeMeetingDetectionSourceName } from "./meeting-source.mjs";
import {
	aggregateMeetingWindowState,
	createInactiveBrowserMeetingWindowState,
	createInitialMeetingWindowState,
	createUnavailableMeetingWindowState,
	getMeetingWindowSourceName,
	normalizeActiveMicApps,
	normalizeMeetingWindowState,
} from "./meeting-window-state.mjs";

const meetingDetectionDebounceMs = 8_000;
const meetingDetectionDismissMs = 30 * 60 * 1000;
const meetingWidgetAutoHideMs = 12 * 1000;

export const createInitialMeetingDetectionState = () => ({
	activeMicApps: [],
	calendarEvent: null,
	candidateStartedAt: null,
	confidence: 0,
	dismissedUntil: null,
	hasMeetingSignal: false,
	isMicrophoneActive: false,
	isSuppressed: false,
	meetingWindowState: createInitialMeetingWindowState(),
	sourceName: null,
	status: "idle",
});

export const createMeetingDetection = ({
	broadcastState,
	dockIconPath,
	ensureDockVisible,
	getDetectedMeetingCalendarEvent,
	getNavigationUrl,
	getTranscriptionPhase,
	isCalendarSignalEnabled,
	isNotificationEnabled,
	openCalendarEventNote,
	preloadPath,
	runtimeDir,
	showMainWindow,
}) => {
	let microphoneActivitySession = null;
	let meetingWindowSession = null;
	let microphoneActivityEventSequence = 0;
	let meetingWindowEventSequence = 0;
	let meetingWidgetWindow = null;
	let latestMeetingWidgetSize = { width: 360, height: 104 };
	let meetingWidgetAutoHideTimeoutId = null;
	let hasPlayedMeetingWidgetSoundForVisiblePrompt = false;
	let latestMeetingDetectionState = createInitialMeetingDetectionState();
	let meetingDetectionDebounceTimeoutId = null;
	let dismissedMeetingSignalKey = null;
	let nativeMeetingWindowState =
		createInitialMeetingDetectionState().meetingWindowState;
	let microphoneSourceName = null;
	let browserMeetingWindowState = createInactiveBrowserMeetingWindowState();
	const browserMeetingWindowMonitor = createBrowserMeetingWindowMonitor({
		onState: (meetingWindowState) => {
			setBrowserMeetingWindowState(meetingWindowState);
			syncMeetingDetectionState();
			reevaluateMeetingDetection();
		},
	});
	const createMeetingSignalInput = (state = latestMeetingDetectionState) => ({
		calendarEvent: getDetectedMeetingCalendarEvent(),
		canUseCalendarEvent: isCalendarSignalEnabled(),
		isMicrophoneActive: state.isMicrophoneActive,
		meetingWindowState: state.meetingWindowState,
		sourceName: state.sourceName,
	});

	const getCurrentMeetingSignal = () => {
		return createMeetingSignal(createMeetingSignalInput());
	};

	const hasCurrentMeetingSignal = (state = latestMeetingDetectionState) => {
		return hasMeetingSignal(createMeetingSignalInput(state));
	};

	const getAggregateMeetingWindowState = () =>
		aggregateMeetingWindowState({
			browserState: browserMeetingWindowState,
			nativeState: nativeMeetingWindowState,
		});

	const setBrowserMeetingWindowState = (meetingWindowState) => {
		browserMeetingWindowState = normalizeMeetingWindowState({
			...meetingWindowState,
			source: "browser",
		});
	};

	const setNativeMeetingWindowState = (meetingWindowState) => {
		nativeMeetingWindowState = normalizeMeetingWindowState({
			...meetingWindowState,
			source: "accessibility",
		});
	};

	const syncMeetingDetectionState = (patch) => {
		const nextActiveMicApps =
			"activeMicApps" in (patch ?? {})
				? normalizeActiveMicApps(patch.activeMicApps)
				: latestMeetingDetectionState.activeMicApps;
		const aggregateWindowState = getAggregateMeetingWindowState();
		const nextMeetingDetectionState = {
			...latestMeetingDetectionState,
			...(patch ?? {}),
			activeMicApps: nextActiveMicApps,
			meetingWindowState: aggregateWindowState,
			sourceName:
				getMeetingWindowSourceName(aggregateWindowState) ??
				microphoneSourceName,
		};

		latestMeetingDetectionState = {
			...nextMeetingDetectionState,
			hasMeetingSignal: hasCurrentMeetingSignal(nextMeetingDetectionState),
		};

		broadcastState(latestMeetingDetectionState);
	};

	const isCurrentMeetingSignalDismissed = (signal) =>
		isMeetingSignalDismissed({
			dismissedUntil: latestMeetingDetectionState.dismissedUntil,
			signal,
			signalKey: dismissedMeetingSignalKey,
		});

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

	const createClearedMeetingSignalPatch = (patch = {}) => ({
		calendarEvent: null,
		candidateStartedAt: null,
		confidence: 0,
		...patch,
	});

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
			title: "Graneri meeting widget",
			icon: dockIconPath,
			webPreferences: {
				preload: preloadPath,
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

	const isMeetingDetectionSuppressed = () =>
		["starting", "listening", "reconnecting", "stopping"].includes(
			getTranscriptionPhase(),
		) || isCurrentMeetingSignalDismissed(getCurrentMeetingSignal());

	const autoHideMeetingWidgetPrompt = () => {
		hideMeetingWidgetWindow();

		const meetingSignal = getCurrentMeetingSignal();

		if (!meetingSignal || isMeetingDetectionSuppressed()) {
			syncMeetingDetectionState(
				createClearedMeetingSignalPatch({
					isSuppressed: isMeetingDetectionSuppressed(),
					status: "idle",
				}),
			);
			return;
		}

		syncMeetingDetectionState({
			...createMeetingSignalStatePatch(meetingSignal),
			confidence: 0.35,
			isSuppressed: false,
			status: "monitoring",
		});
	};

	const showMeetingWidgetWindow = async () => {
		clearMeetingWidgetAutoHideTimeout();

		if (!getCurrentMeetingSignal() || isMeetingDetectionSuppressed()) {
			hideMeetingWidgetWindow();
			return;
		}

		const nextWindow = await ensureMeetingWidgetWindow();
		if (!getCurrentMeetingSignal() || isMeetingDetectionSuppressed()) {
			hideMeetingWidgetWindow();
			return;
		}

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

	const clearMeetingDetectionDebounceTimeout = () => {
		if (meetingDetectionDebounceTimeoutId == null) {
			return;
		}

		clearTimeout(meetingDetectionDebounceTimeoutId);
		meetingDetectionDebounceTimeoutId = null;
	};

	const reevaluateMeetingDetection = () => {
		const isSuppressed = isMeetingDetectionSuppressed();
		const meetingSignal = getCurrentMeetingSignal();
		const confidence = 0.35;
		const promptConfidence = 0.82;

		if (!meetingSignal || isSuppressed) {
			clearMeetingDetectionDebounceTimeout();
			hideMeetingWidgetWindow();
			syncMeetingDetectionState(
				createClearedMeetingSignalPatch({
					isSuppressed,
					status: "idle",
				}),
			);
			return;
		}

		syncMeetingDetectionState({
			...createMeetingSignalStatePatch(meetingSignal),
			confidence,
			isSuppressed: false,
			status: "monitoring",
		});

		if (!isNotificationEnabled()) {
			clearMeetingDetectionDebounceTimeout();
			hideMeetingWidgetWindow();
			return;
		}

		if (meetingDetectionDebounceTimeoutId != null) {
			return;
		}

		meetingDetectionDebounceTimeoutId = setTimeout(() => {
			meetingDetectionDebounceTimeoutId = null;

			if (isMeetingDetectionSuppressed()) {
				reevaluateMeetingDetection();
				return;
			}

			const currentMeetingSignal = getCurrentMeetingSignal();
			if (!currentMeetingSignal) {
				reevaluateMeetingDetection();
				return;
			}

			syncMeetingDetectionState({
				...createMeetingSignalStatePatch(currentMeetingSignal),
				candidateStartedAt: Date.now(),
				confidence: promptConfidence,
				isSuppressed: false,
				status: "prompting",
			});
			void showMeetingWidgetWindow();
		}, meetingDetectionDebounceMs);
	};

	const dismissDetectedMeetingWidget = () => {
		const meetingSignal = getCurrentMeetingSignal();
		dismissedMeetingSignalKey = meetingSignal?.key ?? null;
		clearMeetingDetectionDebounceTimeout();
		hideMeetingWidgetWindow();
		syncMeetingDetectionState(
			createClearedMeetingSignalPatch({
				dismissedUntil: dismissedMeetingSignalKey
					? Date.now() + meetingDetectionDismissMs
					: null,
				isSuppressed: Boolean(dismissedMeetingSignalKey),
				status: "idle",
			}),
		);
	};

	const startDetectedMeetingNote = async () => {
		clearMeetingDetectionDebounceTimeout();
		hideMeetingWidgetWindow();
		dismissedMeetingSignalKey = null;
		syncMeetingDetectionState(
			createClearedMeetingSignalPatch({
				dismissedUntil: null,
				isSuppressed: true,
				status: "idle",
			}),
		);

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
		microphoneSourceName = "Test Meeting";
		syncMeetingDetectionState({
			activeMicApps: [],
			candidateStartedAt: Date.now(),
			calendarEvent: null,
			confidence: 1,
			dismissedUntil: null,
			isMicrophoneActive: true,
			isSuppressed: false,
			status: "prompting",
		});
		await showMeetingWidgetWindow();
	};

	const resetMeetingDetectionForTest = () => {
		clearMeetingDetectionDebounceTimeout();
		hideMeetingWidgetWindow();
		browserMeetingWindowState = createInactiveBrowserMeetingWindowState();
		nativeMeetingWindowState = createUnavailableMeetingWindowState();
		microphoneSourceName = null;
		syncMeetingDetectionState(
			createClearedMeetingSignalPatch({
				dismissedUntil: null,
				activeMicApps: [],
				isMicrophoneActive: false,
				isSuppressed: false,
				status: "idle",
			}),
		);
	};

	const resolveMicrophoneActivityHelperPath = () => {
		return resolveDesktopRuntimeExecutablePath({
			envPath: process.env.GRANERI_MICROPHONE_ACTIVITY_HELPER_PATH,
			executableName: "graneri-microphone-activity-helper",
			runtimeDir,
		});
	};

	const resolveMeetingWindowHelperPath = () => {
		return resolveDesktopRuntimeExecutablePath({
			envPath: process.env.GRANERI_MEETING_WINDOW_HELPER_PATH,
			executableName: "graneri-meeting-window-helper",
			runtimeDir,
		});
	};

	const stopMicrophoneActivityMonitor = async () => {
		clearMeetingDetectionDebounceTimeout();

		if (!microphoneActivitySession) {
			syncMeetingDetectionState(
				createClearedMeetingSignalPatch({
					activeMicApps: [],
					isMicrophoneActive: false,
					status: "idle",
				}),
			);
			hideMeetingWidgetWindow();
			return;
		}

		const session = microphoneActivitySession;
		microphoneActivitySession = null;
		microphoneSourceName = null;
		await stopLineEventHelperSession(session);

		syncMeetingDetectionState({
			activeMicApps: [],
			calendarEvent: null,
			candidateStartedAt: null,
			confidence: 0,
			isMicrophoneActive: false,
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
			logError({
				event: "meeting_detection.microphone_activity_helper_missing",
				message: "[meeting-detection] microphone activity helper is missing",
			});
			return false;
		}

		await stopMicrophoneActivityMonitor();

		const session = await startLineEventHelperSession({
			helperPath,
			isExpectedEvent: (event) =>
				event?.type === "ready" || event?.type === "active-changed",
			label: "microphone-activity-helper",
			onEvent: async ({ event, resolveReady, session }) => {
				const eventSequence = ++microphoneActivityEventSequence;
				const isActive = event.active === true;
				const activeMicApps = normalizeActiveMicApps(event.activeClients);
				const activeMicApp =
					activeMicApps.find((client) => client.name === event.sourceName) ??
					activeMicApps[0] ??
					event.sourceName;
				const sourceName = isActive
					? await resolveNativeMeetingDetectionSourceName(activeMicApp)
					: null;

				if (microphoneActivitySession === session) {
					if (eventSequence !== microphoneActivityEventSequence) {
						return;
					}

					microphoneSourceName = sourceName;
					syncMeetingDetectionState({
						...(event.type === "ready"
							? {
									dismissedUntil:
										latestMeetingDetectionState.dismissedUntil ?? null,
								}
							: {}),
						activeMicApps,
						isMicrophoneActive: isActive,
					});
					reevaluateMeetingDetection();
				}

				if (event.type === "ready") {
					resolveReady();
				}
			},
			onSessionStarted: (session) => {
				microphoneActivitySession = session;
			},
			onStartFailure: (session) => {
				if (microphoneActivitySession === session) {
					microphoneActivitySession = null;
				}
			},
			onUnexpectedExit: ({ code, session, signal }) => {
				if (microphoneActivitySession === session) {
					microphoneActivitySession = null;
					microphoneSourceName = null;
				}

				logError({
					error: {
						code,
						signal,
					},
					message: "[meeting-detection] microphone activity helper exited",
				});
				syncMeetingDetectionState(
					createClearedMeetingSignalPatch({
						activeMicApps: [],
						isMicrophoneActive: false,
						status: "idle",
					}),
				);
				hideMeetingWidgetWindow();
			},
			startupTimeoutMessage:
				"Timed out while starting the microphone activity monitor.",
		});
		return Boolean(session);
	};

	const stopMeetingWindowMonitor = async () => {
		if (!meetingWindowSession) {
			setNativeMeetingWindowState(createUnavailableMeetingWindowState());
			syncMeetingDetectionState();
			return;
		}

		const session = meetingWindowSession;
		meetingWindowSession = null;
		await stopLineEventHelperSession(session);

		setNativeMeetingWindowState(createUnavailableMeetingWindowState());
		syncMeetingDetectionState();
	};

	const startMeetingWindowMonitor = async () => {
		if (process.platform !== "darwin") {
			return false;
		}

		const helperPath = resolveMeetingWindowHelperPath();
		if (!helperPath) {
			logError({
				event: "meeting_detection.meeting_window_helper_missing",
				message: "[meeting-detection] meeting window helper is missing",
			});
			return false;
		}

		await stopMeetingWindowMonitor();

		const session = await startLineEventHelperSession({
			helperPath,
			isExpectedEvent: (event) =>
				event?.type === "ready" || event?.type === "window-changed",
			label: "meeting-window-helper",
			onEvent: ({ event, resolveReady, session }) => {
				const eventSequence = ++meetingWindowEventSequence;
				if (
					meetingWindowSession !== session ||
					eventSequence !== meetingWindowEventSequence
				) {
					return;
				}

				setNativeMeetingWindowState(event);
				syncMeetingDetectionState();
				reevaluateMeetingDetection();

				if (event.type === "ready") {
					resolveReady();
				}
			},
			onSessionStarted: (session) => {
				meetingWindowSession = session;
			},
			onStartFailure: (session) => {
				if (meetingWindowSession === session) {
					meetingWindowSession = null;
				}
			},
			onUnexpectedExit: ({ code, session, signal }) => {
				if (meetingWindowSession === session) {
					meetingWindowSession = null;
				}

				logError({
					error: {
						code,
						signal,
					},
					message: "[meeting-detection] meeting window helper exited",
				});
				setNativeMeetingWindowState(createUnavailableMeetingWindowState());
				syncMeetingDetectionState();
			},
			startupTimeoutMessage:
				"Timed out while starting the meeting window monitor.",
		});
		return Boolean(session);
	};

	const startMeetingDetectionMonitors = async () => {
		const monitorStarts = [
			{
				label: "microphone activity detection",
				start: startMicrophoneActivityMonitor,
			},
			{
				label: "meeting window detection",
				start: startMeetingWindowMonitor,
			},
			{
				label: "browser meeting detection",
				start: browserMeetingWindowMonitor.start,
			},
		];

		const results = await Promise.all(
			monitorStarts.map(async ({ label, start }) => {
				try {
					return await start();
				} catch (error) {
					logError({
						error: error,
						message: `Failed to start ${label}`,
					});
					return false;
				}
			}),
		);

		return results.some(Boolean);
	};

	const stopMeetingDetectionMonitors = async () => {
		await Promise.all([
			stopMicrophoneActivityMonitor(),
			stopMeetingWindowMonitor(),
			Promise.resolve(browserMeetingWindowMonitor.stop()),
		]);
	};

	return {
		dismissDetectedMeetingWidget,
		getMeetingDetectionState: () => latestMeetingDetectionState,
		isMeetingWidgetSender: (sender) =>
			Boolean(
				meetingWidgetWindow &&
					!meetingWidgetWindow.isDestroyed() &&
					sender === meetingWidgetWindow.webContents,
			),
		isMeetingWidgetVisible: () =>
			Boolean(
				meetingWidgetWindow &&
					!meetingWidgetWindow.isDestroyed() &&
					meetingWidgetWindow.isVisible(),
			),
		reevaluateMeetingDetection,
		resetMeetingDetectionForTest,
		startDetectedMeetingNote,
		startMeetingDetectionMonitors,
		showMeetingWidgetForTest,
		stopMeetingDetectionMonitors,
		updateMeetingWidgetWindowSize,
	};
};
