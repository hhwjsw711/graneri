import { logError } from "./logger.mjs";
export const isDesktopUpdaterAvailable = ({
	hasReleaseUpdateConfig,
	isDisabled,
	isPackaged,
	platform,
}) =>
	platform === "darwin" &&
	isPackaged === true &&
	isDisabled !== true &&
	hasReleaseUpdateConfig === true;

export const createDesktopUpdater = ({
	appVersion,
	autoUpdater,
	isAvailable,
	onBeforeInstall,
	setNativeProgress,
	setTrayStatusLabel,
	showMessageBox,
}) => {
	let hasPendingUpdateDownload = false;
	let isCheckingForUpdates = false;
	let pendingUpdateVersion = null;
	let shouldShowUpdateResultDialogs = false;

	const promptToInstallDownloadedUpdate = async (version) => {
		const { response } = await showMessageBox({
			type: "question",
			message: `Graneri ${version} has finished downloading.`,
			detail: "Install now or keep working and update on quit.",
			buttons: ["Later", "Install and Restart"],
			defaultId: 1,
			cancelId: 0,
		});

		if (response !== 1) {
			return;
		}

		onBeforeInstall();
		autoUpdater.quitAndInstall();
	};

	const configure = () => {
		if (!isAvailable()) {
			return;
		}

		autoUpdater.autoDownload = true;
		autoUpdater.autoInstallOnAppQuit = true;

		autoUpdater.on("checking-for-update", () => {
			isCheckingForUpdates = true;
			setTrayStatusLabel("Checking for updates...");
			setNativeProgress(0.02);
		});

		autoUpdater.on("update-available", (info) => {
			hasPendingUpdateDownload = false;
			pendingUpdateVersion = info.version;
			setTrayStatusLabel(`Downloading Graneri ${info.version}...`);
			setNativeProgress(0.03);
		});

		autoUpdater.on("download-progress", (progress) => {
			setTrayStatusLabel(
				`Downloading update... ${Math.round(progress.percent)}%`,
			);
			setNativeProgress(
				Math.max(0.03, Math.min(1, Number(progress.percent ?? 0) / 100)),
			);
		});

		autoUpdater.on("update-not-available", async () => {
			isCheckingForUpdates = false;
			hasPendingUpdateDownload = false;
			pendingUpdateVersion = null;
			setTrayStatusLabel("Graneri is up to date");
			setNativeProgress(-1);

			if (!shouldShowUpdateResultDialogs) {
				return;
			}

			shouldShowUpdateResultDialogs = false;
			await showMessageBox({
				message: "You're up to date.",
				detail: `Graneri ${appVersion()} is currently the newest version available.`,
			});
		});

		autoUpdater.on("update-downloaded", async (info) => {
			isCheckingForUpdates = false;
			hasPendingUpdateDownload = true;
			pendingUpdateVersion = info.version;
			shouldShowUpdateResultDialogs = false;
			setTrayStatusLabel(`Graneri ${info.version} is ready to install`);
			setNativeProgress(-1);
			await promptToInstallDownloadedUpdate(info.version);
		});

		autoUpdater.on("error", async (error) => {
			isCheckingForUpdates = false;
			setTrayStatusLabel("Update check failed");
			setNativeProgress(-1);
			logError({
				error: error,
				message: "Auto updater failed",
			});

			if (!shouldShowUpdateResultDialogs) {
				return;
			}

			shouldShowUpdateResultDialogs = false;
			await showMessageBox({
				type: "error",
				message: "Update check failed.",
				detail: [
					"Graneri couldn't check for updates.",
					error instanceof Error ? error.message : String(error),
				]
					.filter(Boolean)
					.join("\n\n"),
			});
		});
	};

	const checkForUpdates = async () => {
		if (!isAvailable()) {
			await showMessageBox({
				message: "Updates are unavailable.",
				detail: "Updates are only available in packaged release builds.",
			});
			return;
		}

		if (isCheckingForUpdates) {
			await showMessageBox({
				message: "Graneri is already checking for updates.",
			});
			return;
		}

		if (hasPendingUpdateDownload) {
			await promptToInstallDownloadedUpdate(
				pendingUpdateVersion ?? appVersion(),
			);
			return;
		}

		shouldShowUpdateResultDialogs = true;
		await autoUpdater.checkForUpdates();
	};

	const checkForUpdatesQuietly = async () => {
		if (!isAvailable()) {
			return;
		}

		await autoUpdater.checkForUpdates();
	};

	return {
		checkForUpdates,
		checkForUpdatesQuietly,
		configure,
	};
};
