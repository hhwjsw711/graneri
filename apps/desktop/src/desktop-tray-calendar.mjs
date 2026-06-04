import { ConvexHttpClient } from "convex/browser";
import { Notification, shell } from "electron";
import { api } from "../../../convex/_generated/api.js";
import { toErrorLogDetails } from "./network.mjs";

const scheduledMeetingNotificationLeadTimeMs = 5 * 60 * 1000;
const trayCalendarActiveRefreshMs = 60 * 1000;
const trayCalendarIdleRefreshMs = 5 * 60 * 1000;
const trayCalendarUnavailableRefreshMs = 15 * 60 * 1000;
const trayCalendarUpcomingRefreshWindowMs = 30 * 60 * 1000;
const trayCalendarRefreshTimeoutMs = 15 * 1000;

export const createInitialTrayCalendarState = () => ({
	status: "idle",
	events: [],
	connectedCalendarCount: 0,
});

const createLoadingTrayCalendarState = () => ({
	status: "loading",
	events: [],
	connectedCalendarCount: 0,
});

const isSameCalendarDay = (left, right) =>
	left.getFullYear() === right.getFullYear() &&
	left.getMonth() === right.getMonth() &&
	left.getDate() === right.getDate();

export const isTrayEventLive = (event, currentDate) => {
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

export const getTrayTodayEvents = (events, currentDate) =>
	events
		.filter((event) => isTrayEventToday(event, currentDate))
		.sort(
			(left, right) =>
				new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
		);

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

const withTimeout = async (promise, timeoutMs, message) => {
	let timeoutId = null;
	const timeoutPromise = new Promise((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(message));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutId != null) {
			clearTimeout(timeoutId);
		}
	}
};

const createScheduledMeetingNotificationKey = (workspaceId, event) =>
	`${workspaceId}:${event.id}:${event.startAt}`;

const formatScheduledMeetingNotificationTime = (value) =>
	new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value));

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

export const createDesktopTrayCalendar = ({
	dockIconPath,
	getConvexUrl,
	getDesktopConvexToken,
	getNotificationPreferences,
	onOpenMainWindow,
	onStateChange,
}) => {
	let state = createInitialTrayCalendarState();
	let workspaceId = null;
	let refreshTimeoutId = null;
	let refreshPromise = null;
	const shownScheduledMeetingNotificationKeys = new Set();

	const notifyStateChange = () => {
		try {
			onStateChange();
		} catch (error) {
			console.warn(
				"Failed to rebuild tray calendar menu.",
				toErrorLogDetails(error),
			);
		}
	};

	const openTrayMeetingLink = async (event) => {
		if (!event?.meetingUrl) {
			return;
		}

		await shell.openExternal(event.meetingUrl);
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

	const getDetectedMeetingCalendarEvent = (currentDate = new Date()) => {
		if (state.status !== "ready") {
			return null;
		}

		const currentTimestamp = currentDate.getTime();
		const liveMeeting = getTrayTodayEvents(state.events, currentDate)
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

		return getTrayTodayEvents(state.events, currentDate)
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

	const clearRefresh = () => {
		if (refreshTimeoutId != null) {
			clearTimeout(refreshTimeoutId);
			refreshTimeoutId = null;
		}
	};

	const shouldMaintainCalendar = () => Boolean(workspaceId);

	const shouldUseActiveRefresh = (events) => {
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

	const getRefreshDelay = () => {
		if (!shouldMaintainCalendar()) {
			return null;
		}

		if (state.status === "ready" && shouldUseActiveRefresh(state.events)) {
			return trayCalendarActiveRefreshMs;
		}

		if (state.status === "ready") {
			return trayCalendarIdleRefreshMs;
		}

		return trayCalendarUnavailableRefreshMs;
	};

	const scheduleRefresh = ({ delayMs, keepOpenInMenuBar } = {}) => {
		clearRefresh();
		const resolvedDelayMs = delayMs ?? getRefreshDelay();

		if (resolvedDelayMs == null) {
			return;
		}

		refreshTimeoutId = setTimeout(() => {
			refreshTimeoutId = null;
			void refresh({ keepOpenInMenuBar });
		}, resolvedDelayMs);
	};

	const syncShownScheduledMeetingNotifications = (events) => {
		if (!workspaceId) {
			shownScheduledMeetingNotificationKeys.clear();
			return;
		}

		const activeEventKeys = new Set(
			events.map((event) =>
				createScheduledMeetingNotificationKey(workspaceId, event),
			),
		);

		for (const key of shownScheduledMeetingNotificationKeys) {
			if (key.startsWith(`${workspaceId}:`) && !activeEventKeys.has(key)) {
				shownScheduledMeetingNotificationKeys.delete(key);
			}
		}
	};

	const maybeShowScheduledMeetingNotifications = (events) => {
		if (
			!workspaceId ||
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
				workspaceId,
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

	const refresh = async ({ keepOpenInMenuBar } = {}) => {
		if (refreshPromise) {
			if (state.status === "loading") {
				return await refreshPromise;
			}

			refreshPromise = null;
		}

		refreshPromise = (async () => {
			try {
				if (!shouldMaintainCalendar()) {
					state = createInitialTrayCalendarState();
					return;
				}

				if (!workspaceId) {
					state = {
						...createInitialTrayCalendarState(),
						status: "not_connected",
					};
					return;
				}

				state = createLoadingTrayCalendarState();
				notifyStateChange();

				const convexToken = await withTimeout(
					getDesktopConvexToken(),
					trayCalendarRefreshTimeoutMs,
					"Timed out loading desktop auth token for tray calendar.",
				);

				if (!convexToken) {
					state = {
						...createInitialTrayCalendarState(),
						status: "not_connected",
					};
					return;
				}

				const convexClient = new ConvexHttpClient(getConvexUrl(), {
					auth: convexToken,
				});
				const result = await withTimeout(
					convexClient.action(api.calendar.listUpcomingGoogleEvents, {
						workspaceId,
						...getCurrentDayWindow(),
					}),
					trayCalendarRefreshTimeoutMs,
					"Timed out loading tray calendar events.",
				);

				state =
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

				if (state.status === "ready") {
					maybeShowScheduledMeetingNotifications(state.events);
				} else {
					syncShownScheduledMeetingNotifications([]);
				}
			} catch (error) {
				console.warn(
					"Failed to refresh tray calendar.",
					toErrorLogDetails(error),
				);
				state = {
					...createInitialTrayCalendarState(),
					status: "error",
				};
			} finally {
				refreshPromise = null;
				notifyStateChange();
				scheduleRefresh({ keepOpenInMenuBar });
			}
		})();

		return await refreshPromise;
	};

	return {
		clearRefresh,
		getDetectedMeetingCalendarEvent,
		getState: () => ({
			...state,
			events: state.events.map((event) => ({ ...event })),
			hasRefreshPromise: Boolean(refreshPromise),
			hasRefreshTimeout: refreshTimeoutId != null,
			workspaceId,
		}),
		openCalendarEventNote,
		refresh,
		scheduleRefresh,
		setWorkspaceId: (value) => {
			workspaceId = value;
		},
	};
};
