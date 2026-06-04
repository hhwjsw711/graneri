import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Menu, nativeImage, Tray } from "electron";
import {
	createDesktopTrayCalendar,
	getTrayTodayEvents,
	isTrayEventLive,
} from "./desktop-tray-calendar.mjs";

const trayCalendarMenuEventLimit = 5;

const defaultTraySettings = {
	keepOpenInMenuBar: true,
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

export const createDesktopTray = ({
	app,
	confirmAndQuitCompletely,
	dockIconPath,
	getConvexUrl,
	getDesktopConvexToken,
	getNotificationPreferences,
	onCheckForUpdates,
	onOpenMainWindow,
	onQuit,
	trayIconPath,
	traySettingsPath,
	userDataPath,
}) => {
	let tray = null;
	let traySettings = { ...defaultTraySettings };
	let trayStatusLabel = "Updates are unavailable in development builds";
	const calendar = createDesktopTrayCalendar({
		dockIconPath,
		getConvexUrl,
		getDesktopConvexToken,
		getNotificationPreferences,
		onOpenMainWindow,
		onStateChange: () => refreshMenu(),
	});

	const saveSettings = async () => {
		try {
			await mkdir(userDataPath, { recursive: true });
			await writeFile(
				traySettingsPath,
				JSON.stringify(traySettings, null, 2),
				"utf8",
			);
		} catch (error) {
			console.warn("Failed to save tray settings.", error);
		}
	};

	const loadSettings = async () => {
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

	const buildTrayEventMenuItem = (event) => ({
		label: formatTrayEventMenuLabel(event),
		enabled: event?.isMeeting === true,
		click: () => {
			void calendar.openCalendarEventNote(event);
		},
	});

	const getTrayTitle = () => {
		const currentDate = new Date();
		const calendarState = calendar.getState();
		const todayEvents = getTrayTodayEvents(calendarState.events, currentDate);

		if (todayEvents.length === 0) {
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
		const calendarState = calendar.getState();
		const todayLabel = `Today (${trayDateFormatter.format(currentDate)})`;
		const todayEvents = getTrayTodayEvents(
			calendarState.events,
			currentDate,
		).slice(0, trayCalendarMenuEventLimit);

		if (
			calendarState.status === "not_connected" ||
			calendarState.status === "error"
		) {
			return [];
		}

		if (calendarState.status === "idle" || calendarState.status === "loading") {
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

	const buildTrayMenu = () =>
		Menu.buildFromTemplate([
			...buildTrayCalendarMenuItems(),
			{
				label: "Open desktop",
				click: () => {
					void onOpenMainWindow();
				},
			},
			{
				label: "Quick note",
				click: () => {
					void onOpenMainWindow({
						pathname: "/note",
						search: "?capture=1",
					});
				},
			},
			{
				label: "Settings",
				click: () => {
					void onOpenMainWindow({ pathname: "/settings/profile" });
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
					void onCheckForUpdates();
				},
			},
			{ type: "separator" },
			{
				label: "Quit",
				click: () => {
					void onQuit();
				},
			},
			{
				label: "Quit options",
				submenu: [
					{
						label: "Keep Graneri in the menu bar",
						type: "checkbox",
						checked: traySettings.keepOpenInMenuBar,
						click: (menuItem) => {
							traySettings = {
								...traySettings,
								keepOpenInMenuBar: menuItem.checked,
							};
							void saveSettings();
							refreshMenu();
							void calendar.refresh({
								keepOpenInMenuBar: traySettings.keepOpenInMenuBar,
							});
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

	const refreshMenu = () => {
		if (!tray) {
			return;
		}

		tray.setTitle(getTrayTitle());
		tray.setContextMenu(buildTrayMenu());
	};

	const create = () => {
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
		refreshMenu();
		tray.on("double-click", () => {
			void onOpenMainWindow();
		});
	};

	return {
		clearCalendarRefresh: calendar.clearRefresh,
		create,
		getDetectedMeetingCalendarEvent: calendar.getDetectedMeetingCalendarEvent,
		isKeepOpenInMenuBarEnabled: () => traySettings.keepOpenInMenuBar,
		loadSettings,
		openCalendarEventNote: calendar.openCalendarEventNote,
		refreshCalendar: () =>
			calendar.refresh({
				keepOpenInMenuBar: traySettings.keepOpenInMenuBar,
			}),
		refreshMenu,
		scheduleCalendarRefresh: (delayMs) => {
			calendar.scheduleRefresh({
				delayMs,
				keepOpenInMenuBar: traySettings.keepOpenInMenuBar,
			});
		},
		setActiveWorkspaceId: (workspaceId) => {
			calendar.setWorkspaceId(workspaceId);
		},
		setStatusLabel: (value) => {
			trayStatusLabel = value;
			refreshMenu();
		},
	};
};
