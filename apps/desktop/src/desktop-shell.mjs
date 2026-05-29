import { nativeImage } from "electron";

export const createDesktopShell = ({ app, dockIconPath, getMainWindow }) => {
	let cachedDockIconImage;

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
		const mainWindow = getMainWindow();
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

	const getVisibleMainWindow = () => {
		const mainWindow = getMainWindow();
		return mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
			? mainWindow
			: undefined;
	};

	return {
		applyDockIcon,
		ensureAppActive,
		ensureDockVisible,
		getVisibleMainWindow,
		hideApp,
		hideMainWindow,
	};
};
