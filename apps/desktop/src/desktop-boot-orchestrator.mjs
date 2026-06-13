const activeTranscriptionPhases = new Set([
	"starting",
	"listening",
	"reconnecting",
]);

export const createDesktopBootOrchestrator = ({
	app,
	applyDockIcon,
	checkForUpdatesQuietly,
	closeLocalServer,
	configureUpdater,
	confirmAndQuitCompletely,
	createMainWindow,
	createTray,
	ensureLocalServer,
	getExistingMainWindow,
	getProtocolRegistrars,
	getTranscriptionPhase,
	isBypassingQuitConfirmation,
	isKeepOpenInMenuBarEnabled,
	isMeetingWidgetVisible,
	isUpdaterAvailable,
	loadDesktopNavigationState,
	loadDesktopPreferences = async () => {},
	loadTraySettings,
	markQuitting,
	powerMonitor,
	processPlatform = process.platform,
	quitCompletely,
	refreshApplicationMenu,
	refreshTranscriptionPolicy,
	refreshTrayCalendar,
	registerDesktopAppProtocols,
	rendererDistDir,
	setTrayStatusLabel,
	showMainWindow,
	startGlobalDictation = () => {},
	startMeetingDetectionMonitors,
	stopDesktopTranscriptionSession,
	stopGlobalDictation = async () => {},
	stopMeetingDetectionMonitors,
	stopMicrophoneCapture,
	stopRealtimeTransport,
	stopSystemAudioCapture,
}) => {
	const stopDesktopRuntime = async () => {
		await stopRealtimeTransport("you");
		await stopRealtimeTransport("them");
		await stopGlobalDictation();
		await stopMeetingDetectionMonitors();
		await stopMicrophoneCapture();
		await stopSystemAudioCapture();
		await closeLocalServer();
	};

	const registerReadyHandler = () => {
		app.whenReady().then(async () => {
			refreshTranscriptionPolicy();
			refreshApplicationMenu();
			registerDesktopAppProtocols({
				protocolRegistrars: getProtocolRegistrars(),
				rendererDistDir,
			});

			powerMonitor.on("suspend", () => {
				if (!activeTranscriptionPhases.has(getTranscriptionPhase())) {
					return;
				}

				void stopDesktopTranscriptionSession({
					preserveUtterances: true,
					resetError: true,
					resetRecovery: true,
				});
			});

			applyDockIcon();

			await loadDesktopPreferences();
			await loadTraySettings();
			await loadDesktopNavigationState();
			await ensureLocalServer();
			await createMainWindow();
			createTray();
			void refreshTrayCalendar();
			configureUpdater();
			startGlobalDictation();
			void startMeetingDetectionMonitors().catch((error) => {
				console.error("Failed to start meeting detection", error);
			});

			if (isUpdaterAvailable()) {
				setTrayStatusLabel("Checking for updates...");
				void checkForUpdatesQuietly().catch((error) => {
					console.error("Initial update check failed", error);
				});
			}

			app.on("activate", async () => {
				const window = getExistingMainWindow();
				if (isMeetingWidgetVisible() && !window?.isVisible()) {
					return;
				}

				await showMainWindow();
			});
		});
	};

	const registerWindowAllClosedHandler = () => {
		app.on("window-all-closed", async () => {
			await stopDesktopRuntime();

			if (processPlatform !== "darwin" || !isKeepOpenInMenuBarEnabled()) {
				quitCompletely();
			}
		});
	};

	const registerBeforeQuitHandler = () => {
		app.on("before-quit", (event) => {
			if (processPlatform === "darwin" && !isBypassingQuitConfirmation()) {
				event.preventDefault();
				void confirmAndQuitCompletely();
				return;
			}

			markQuitting();
			void stopDesktopRuntime();
		});
	};

	const start = () => {
		if (!app.requestSingleInstanceLock()) {
			quitCompletely();
			return;
		}

		app.on("second-instance", () => {
			void showMainWindow();
		});

		registerReadyHandler();
		registerWindowAllClosedHandler();
		registerBeforeQuitHandler();
	};

	return {
		start,
	};
};
