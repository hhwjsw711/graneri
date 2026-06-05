import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { BrowserWindow, screen, shell } from "electron";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";
import {
	createMeetingSignal,
	createMeetingSignalStatePatch,
	isMeetingSignalDismissed,
} from "./meeting-signal.mjs";
import { resolveNativeMeetingDetectionSourceName } from "./meeting-source.mjs";

const meetingDetectionDebounceMs = 8_000;
const meetingDetectionDismissMs = 30 * 60 * 1000;
const meetingWidgetAutoHideMs = 12 * 1000;

export const createInitialMeetingDetectionState = () => ({
	calendarEvent: null,
	candidateStartedAt: null,
	confidence: 0,
	dismissedUntil: null,
	hasMeetingSignal: false,
	isMicrophoneActive: false,
	isSuppressed: false,
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
	let microphoneActivityEventSequence = 0;
	let meetingWidgetWindow = null;
	let latestMeetingWidgetSize = { width: 360, height: 104 };
	let meetingWidgetAutoHideTimeoutId = null;
	let hasPlayedMeetingWidgetSoundForVisiblePrompt = false;
	let latestMeetingDetectionState = createInitialMeetingDetectionState();
	let meetingDetectionDebounceTimeoutId = null;
	let dismissedMeetingSignalKey = null;

	const getCurrentMeetingSignal = () => {
		return createMeetingSignal({
			calendarEvent: getDetectedMeetingCalendarEvent(),
			canUseCalendarEvent: isCalendarSignalEnabled(),
			isMicrophoneActive: latestMeetingDetectionState.isMicrophoneActive,
			sourceName: latestMeetingDetectionState.sourceName,
		});
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

	const syncMeetingDetectionState = (patch) => {
		const isMicrophoneActive = Boolean(
			patch?.isMicrophoneActive ??
				latestMeetingDetectionState.isMicrophoneActive,
		);

		latestMeetingDetectionState = {
			...latestMeetingDetectionState,
			...patch,
			hasMeetingSignal: isMicrophoneActive,
		};

		broadcastState(latestMeetingDetectionState);
	};

	const createClearedMeetingSignalPatch = (patch = {}) => ({
		calendarEvent: null,
		candidateStartedAt: null,
		confidence: 0,
		sourceName: null,
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

			if (
				!latestMeetingDetectionState.isMicrophoneActive ||
				isMeetingDetectionSuppressed()
			) {
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
		syncMeetingDetectionState({
			candidateStartedAt: Date.now(),
			calendarEvent: null,
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
		syncMeetingDetectionState(
			createClearedMeetingSignalPatch({
				dismissedUntil: null,
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

	const stopMicrophoneActivityMonitor = async () => {
		clearMeetingDetectionDebounceTimeout();

		if (!microphoneActivitySession) {
			syncMeetingDetectionState(
				createClearedMeetingSignalPatch({
					isMicrophoneActive: false,
					status: "idle",
				}),
			);
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
			calendarEvent: null,
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
					new Error(
						"Timed out while starting the microphone activity monitor.",
					),
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
					console.error(
						"[meeting-detection] microphone activity helper exited",
						{
							code,
							signal,
						},
					);
					syncMeetingDetectionState(
						createClearedMeetingSignalPatch({
							isMicrophoneActive: false,
							status: "idle",
						}),
					);
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
		startMicrophoneActivityMonitor,
		showMeetingWidgetForTest,
		stopMicrophoneActivityMonitor,
		updateMeetingWidgetWindowSize,
	};
};
