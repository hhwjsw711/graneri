import { Notification, shell } from "electron";
import {
	createInitialTrayCalendarState,
	createLoadingTrayCalendarState,
	createUnavailableTrayCalendarState,
	getDetectedMeetingCalendarEventFromEvents,
	scheduledMeetingNotificationLeadTimeMs,
} from "./desktop-tray-calendar-detection.mjs";
import { logError } from "./logger.mjs";
import { toErrorLogDetails } from "./network.mjs";

export {
	createInitialTrayCalendarState,
	createLoadingTrayCalendarState,
	createUnavailableTrayCalendarState,
	getDetectedMeetingCalendarEventFromEvents,
	getUpcomingTrayEventsForDay,
} from "./desktop-tray-calendar-detection.mjs";

const trayCalendarActiveRefreshMs = 60 * 1000;
const trayCalendarIdleRefreshMs = 5 * 60 * 1000;
const trayCalendarUnavailableRefreshMs = 15 * 60 * 1000;
const trayCalendarUpcomingRefreshWindowMs = 30 * 60 * 1000;

export const isTrayEventLive = (event, currentDate) => {
	const startAt = new Date(event.startAt).getTime();
	const endAt = new Date(event.endAt).getTime();
	const now = currentDate.getTime();

	return now >= startAt && now <= endAt;
};

const createScheduledMeetingNotificationKey = (event) =>
	`${event.id}:${event.startAt}`;

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
	calendarSource,
	dockIconPath,
	getNotificationPreferences,
	onOpenMainWindow,
	onStateChange,
}) => {
	let state = createInitialTrayCalendarState();
	let refreshTimeoutId = null;
	let refreshPromise = null;
	let queuedRefreshOptions = null;
	const shownScheduledMeetingNotificationKeys = new Set();

	const notifyStateChange = () => {
		try {
			onStateChange();
		} catch (error) {
			logError({
				error: toErrorLogDetails(error),
				message: "Failed to rebuild tray calendar menu.",
			});
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

		return getDetectedMeetingCalendarEventFromEvents(state.events, currentDate);
	};

	const hasReadyCalendarState = () => state.status === "ready";

	const clearRefresh = () => {
		if (refreshTimeoutId != null) {
			clearTimeout(refreshTimeoutId);
			refreshTimeoutId = null;
		}
	};

	const shouldMaintainCalendar = () => process.platform === "darwin";

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
		const activeEventKeys = new Set(
			events.map((event) => createScheduledMeetingNotificationKey(event)),
		);

		for (const key of shownScheduledMeetingNotificationKeys) {
			if (!activeEventKeys.has(key)) {
				shownScheduledMeetingNotificationKeys.delete(key);
			}
		}
	};

	const maybeShowScheduledMeetingNotifications = (events) => {
		if (
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

			const notificationKey = createScheduledMeetingNotificationKey(event);

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
				logError({
					error: error,
					message: "Failed to show scheduled meeting notification.",
				});
			}
		}
	};

	const queueRefresh = ({ keepOpenInMenuBar } = {}) => {
		queuedRefreshOptions = {
			keepOpenInMenuBar:
				keepOpenInMenuBar ?? queuedRefreshOptions?.keepOpenInMenuBar,
		};
	};

	const runRefresh = async ({ keepOpenInMenuBar } = {}) => {
		try {
			if (!shouldMaintainCalendar()) {
				state = createInitialTrayCalendarState();
				return;
			}

			if (!hasReadyCalendarState()) {
				state = createLoadingTrayCalendarState({ previousState: state });
				notifyStateChange();
			}

			try {
				const result = await calendarSource.listCurrentDayEvents();

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
						: createUnavailableTrayCalendarState({
								status: "not_connected",
							});

				if (state.status === "ready") {
					maybeShowScheduledMeetingNotifications(state.events);
				} else {
					syncShownScheduledMeetingNotifications([]);
				}
			} catch (error) {
				logError({
					error: toErrorLogDetails(error),
					message: "Failed to refresh tray calendar.",
				});
				if (!hasReadyCalendarState()) {
					state = createUnavailableTrayCalendarState({
						previousState: state,
						status: "error",
					});
				}
			}
		} finally {
			notifyStateChange();
			scheduleRefresh({ keepOpenInMenuBar });
		}
	};

	const refresh = async ({ keepOpenInMenuBar } = {}) => {
		if (refreshPromise) {
			queueRefresh({ keepOpenInMenuBar });
			return await refreshPromise;
		}

		refreshPromise = (async () => {
			let refreshOptions = { keepOpenInMenuBar };

			while (refreshOptions) {
				queuedRefreshOptions = null;
				await runRefresh(refreshOptions);
				refreshOptions = queuedRefreshOptions;
			}
		})();

		try {
			return await refreshPromise;
		} finally {
			refreshPromise = null;
		}
	};

	return {
		clearRefresh,
		getDetectedMeetingCalendarEvent,
		getState: () => ({
			...state,
			events: state.events.map((event) => ({ ...event })),
			hasRefreshPromise: Boolean(refreshPromise),
			hasRefreshTimeout: refreshTimeoutId != null,
		}),
		openCalendarEventNote,
		refresh,
		scheduleRefresh,
	};
};
