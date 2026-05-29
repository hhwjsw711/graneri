import { BrowserWindow, desktopCapturer } from "electron";

const minimumWindowSize = {
	width: 420,
	height: 700,
};

const defaultWindowSize = {
	width: 1200,
	height: 840,
};

export const createDesktopWindow = ({
	desktopNavigationChannel,
	dockIconPath,
	getBackgroundColor,
	getDefaultNavigation,
	getNavigationUrl,
	isQuitting,
	onClosed,
	onHideRequested,
	onWindowCreated,
	preloadPath,
	rememberNavigation,
	shell,
	shouldHideInsteadOfClose,
}) => {
	let hasConfiguredDisplayMediaHandler = false;
	let mainWindow = null;

	const getWindow = () => mainWindow;

	const create = async (targetUrl) => {
		const navigationUrl =
			targetUrl ?? (await getNavigationUrl(getDefaultNavigation()));
		const isMac = process.platform === "darwin";

		mainWindow = new BrowserWindow({
			width: defaultWindowSize.width,
			height: defaultWindowSize.height,
			minWidth: minimumWindowSize.width,
			minHeight: minimumWindowSize.height,
			title: "OpenGran",
			icon: dockIconPath,
			backgroundColor: getBackgroundColor(),
			autoHideMenuBar: true,
			titleBarStyle: isMac ? "hiddenInset" : "default",
			trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
			vibrancy: isMac ? "sidebar" : undefined,
			visualEffectState: isMac ? "active" : undefined,
			webPreferences: {
				preload: preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false,
			},
		});
		onWindowCreated(mainWindow);

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
			if (isQuitting() || !shouldHideInsteadOfClose()) {
				return;
			}

			event.preventDefault();
			onHideRequested();
		});

		mainWindow.on("closed", () => {
			mainWindow = null;
			onClosed();
		});

		mainWindow.webContents.on("before-input-event", (event, input) => {
			const key = input.key?.toLowerCase();

			if (key === "r" && (input.meta || input.control)) {
				event.preventDefault();
			}
		});

		mainWindow.webContents.on("did-navigate", (_event, url) => {
			void rememberNavigation(url);
		});
		mainWindow.webContents.on("did-navigate-in-page", (_event, url) => {
			void rememberNavigation(url);
		});

		await mainWindow.loadURL(navigationUrl);
		shell.ensureDockVisible();
		return mainWindow;
	};

	const navigate = async (options = {}) => {
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
		await rememberNavigation(targetUrl.toString());
	};

	const focus = () => {
		if (!mainWindow) {
			return;
		}

		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}

		shell.ensureDockVisible();
		shell.ensureAppActive();
		mainWindow.show();
		mainWindow.focus();
	};

	const show = async (options = {}) => {
		const hasExplicitNavigation =
			"pathname" in options || "search" in options || "hash" in options;

		if (!mainWindow) {
			const targetUrl = await getNavigationUrl(
				hasExplicitNavigation ? options : getDefaultNavigation(),
			);
			await create(targetUrl);
		} else if (hasExplicitNavigation) {
			await navigate(options);
		}

		focus();
	};

	const loadUrlAndFocus = async (targetUrl) => {
		if (!mainWindow) {
			await create(targetUrl);
		} else {
			await mainWindow.loadURL(targetUrl);
		}

		focus();
	};

	return {
		create,
		focus,
		getWindow,
		loadUrlAndFocus,
		navigate,
		show,
	};
};
