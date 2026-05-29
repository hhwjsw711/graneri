import { Menu } from "electron";

export const createDesktopAppMenu = ({
	appName,
	confirmAndQuitCompletely,
	handleCheckForUpdates,
	handleDesktopSignOut,
	handleRestartApp,
	handleTrayQuit,
	hideApp,
	showAboutMessageBox,
	showMainWindow,
}) => {
	const build = () => {
		if (process.platform !== "darwin") {
			return null;
		}

		return Menu.buildFromTemplate([
			{
				label: appName(),
				submenu: [
					{
						label: `About ${appName()}`,
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
						label: `Hide ${appName()}`,
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
						label: `Restart ${appName()}`,
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

	const refresh = () => {
		if (process.platform !== "darwin") {
			return;
		}

		Menu.setApplicationMenu(build());
	};

	return {
		refresh,
	};
};
