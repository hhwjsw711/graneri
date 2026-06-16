const isRecord = (value) =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trimString = (value) => (typeof value === "string" ? value.trim() : "");

const parseTimestamp = (value) => {
	const timestamp = Date.parse(trimString(value));
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const normalizeSyncedCalendarEvent = (event) => {
	if (!isRecord(event)) {
		return null;
	}

	const id = trimString(event.id);
	const calendarId = trimString(event.calendarId);
	const calendarName = trimString(event.calendarName);
	const title = trimString(event.title);
	const startAt = parseTimestamp(event.startAt);
	const endAt = parseTimestamp(event.endAt);

	if (!id || !calendarId || !calendarName || !title || !startAt || !endAt) {
		return null;
	}

	return {
		calendarId,
		calendarName,
		endAt,
		htmlLink: trimString(event.htmlLink) || null,
		id,
		isAllDay: event.isAllDay === true,
		isMeeting: event.isMeeting === true,
		location: trimString(event.location) || null,
		meetingUrl: trimString(event.meetingUrl) || null,
		startAt,
		title,
	};
};

const createUnavailableCalendarResult = (status) => ({
	connectedCalendarCount: 0,
	events: [],
	status,
});

const cloneCalendarState = (value) => ({
	...value,
	events: value.events.map((event) => ({ ...event })),
});

const normalizeSyncedCalendarState = (payload) => {
	if (!isRecord(payload)) {
		throw new Error("Tray calendar payload must be an object.");
	}

	if (payload.status === "not_connected" || payload.status === "error") {
		return createUnavailableCalendarResult(payload.status);
	}

	if (payload.status !== "ready") {
		throw new Error("Tray calendar status is invalid.");
	}

	return {
		connectedCalendarCount:
			typeof payload.connectedCalendarCount === "number"
				? payload.connectedCalendarCount
				: 0,
		events: Array.isArray(payload.events)
			? payload.events
					.map((event) => normalizeSyncedCalendarEvent(event))
					.filter(Boolean)
			: [],
		status: "ready",
	};
};

export const createDesktopSyncedCalendar = () => {
	let state = createUnavailableCalendarResult("not_connected");

	return {
		listCurrentDayEvents: async () => cloneCalendarState(state),
		setState: (payload) => {
			state = normalizeSyncedCalendarState(payload);
		},
	};
};
