import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { Menu, Notification, nativeImage, shell, Tray } from "electron";
import { api } from "../../../convex/_generated/api.js";
import { toErrorLogDetails } from "./network.mjs";

const scheduledMeetingNotificationLeadTimeMs = 5 * 60 * 1000;
const trayCalendarActiveRefreshMs = 60 * 1000;
const trayCalendarIdleRefreshMs = 5 * 60 * 1000;
const trayCalendarUnavailableRefreshMs = 15 * 60 * 1000;
const trayCalendarUpcomingRefreshWindowMs = 30 * 60 * 1000;
const trayCalendarMenuEventLimit = 5;

const defaultTraySettings = {
	keepOpenInMenuBar: true,
};

const createInitialTrayCalendarState = () => ({
	status: "idle",
	events: [],
	connectedCalendarCount: 0,
});

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

const createScheduledMeetingNotificationKey = (workspaceId, event) =>
	`${workspaceId}:${event.id}:${event.startAt}`;

const formatScheduledMeetingNotificationTime = (value) =>
	new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value));

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
	let trayCalendarState = createInitialTrayCalendarState();
	let trayCalendarWorkspaceId = null;
	let trayCalendarRefreshTimeoutId = null;
	let trayCalendarRefreshPromise = null;
	let trayStatusLabel = "Updates are unavailable in development builds";
	const shownScheduledMeetingNotificationKeys = new Set();

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

	const getDetectedMeetingCalendarEvent = (currentDate = new Date()) => {
		if (trayCalendarState.status !== "ready") {
			return null;
		}

		const currentTimestamp = currentDate.getTime();
		const liveMeeting = getTrayTodayEvents(
			trayCalendarState.events,
			currentDate,
		)
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

		await onOpenMainWindow({
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
		const todayEvents = getTrayTodayEvents(
			trayCalendarState.events,
			currentDate,
		);

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
		const todayLabel = `Today (${trayDateFormatter.format(currentDate)})`;
		const todayEvents = getTrayTodayEvents(
			trayCalendarState.events,
			currentDate,
		).slice(0, trayCalendarMenuEventLimit);

		if (
			trayCalendarState.status === "not_connected" ||
			trayCalendarState.status === "error"
		) {
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
						label: "Keep OpenGran in the menu bar",
						type: "checkbox",
						checked: traySettings.keepOpenInMenuBar,
						click: (menuItem) => {
							traySettings = {
								...traySettings,
								keepOpenInMenuBar: menuItem.checked,
							};
							void saveSettings();
							refreshMenu();
							void refreshCalendar();
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

	const clearCalendarRefresh = () => {
		if (trayCalendarRefreshTimeoutId != null) {
			clearTimeout(trayCalendarRefreshTimeoutId);
			trayCalendarRefreshTimeoutId = null;
		}
	};

	const shouldMaintainCalendar = () =>
		Boolean(trayCalendarWorkspaceId) &&
		(traySettings.keepOpenInMenuBar ||
			getNotificationPreferences().notifyForScheduledMeetings);

	const shouldUseActiveCalendarRefresh = (events) => {
		const now = Date.now();

		return events.some((event) => {
			if (!event?.isMeeting || event.isAllDay) {
				return false;
			}

			const startAt = Date.parse(event.startAt);
			const endAt = Date.parse(event.endAt);

			if (
				!Number.isFinite(startAt) ||
				!Number.isFinite(endAt) ||
				endAt <= now
			) {
				return false;
			}

			return startAt - now <= trayCalendarUpcomingRefreshWindowMs;
		});
	};

	const getCalendarRefreshDelay = () => {
		if (!shouldMaintainCalendar()) {
			return null;
		}

		if (
			trayCalendarState.status === "ready" &&
			shouldUseActiveCalendarRefresh(trayCalendarState.events)
		) {
			return trayCalendarActiveRefreshMs;
		}

		if (trayCalendarState.status === "ready") {
			return trayCalendarIdleRefreshMs;
		}

		return trayCalendarUnavailableRefreshMs;
	};

	const scheduleCalendarRefresh = (delayMs = getCalendarRefreshDelay()) => {
		clearCalendarRefresh();

		if (delayMs == null) {
			return;
		}

		trayCalendarRefreshTimeoutId = setTimeout(() => {
			trayCalendarRefreshTimeoutId = null;
			void refreshCalendar();
		}, delayMs);
	};

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
			!getNotificationPreferences().notifyForScheduledMeetings ||
			!Notification.isSupported()
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
			const notification = new Notification({
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

	const refreshCalendar = async () => {
		if (trayCalendarRefreshPromise) {
			return await trayCalendarRefreshPromise;
		}

		trayCalendarRefreshPromise = (async () => {
			try {
				if (!shouldMaintainCalendar()) {
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
				refreshMenu();
				scheduleCalendarRefresh();
				trayCalendarRefreshPromise = null;
			}
		})();

		return await trayCalendarRefreshPromise;
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
		clearCalendarRefresh,
		create,
		getDetectedMeetingCalendarEvent,
		isKeepOpenInMenuBarEnabled: () => traySettings.keepOpenInMenuBar,
		loadSettings,
		openCalendarEventNote,
		refreshCalendar,
		refreshMenu,
		scheduleCalendarRefresh,
		setActiveWorkspaceId: (workspaceId) => {
			trayCalendarWorkspaceId = workspaceId;
		},
		setStatusLabel: (value) => {
			trayStatusLabel = value;
			refreshMenu();
		},
	};
};
