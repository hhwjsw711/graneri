export const scheduledMeetingNotificationLeadTimeMs = 60 * 1000;
export const detectedMeetingCalendarPostStartWindowMs = 15 * 60 * 1000;

export const createInitialTrayCalendarState = () => ({
	status: "idle",
	events: [],
	connectedCalendarCount: 0,
});

export const createLoadingTrayCalendarState = ({ previousState } = {}) =>
	previousState?.status === "ready"
		? previousState
		: {
				status: "loading",
				events: [],
				connectedCalendarCount: 0,
			};

export const createUnavailableTrayCalendarState = ({
	previousState,
	status,
}) =>
	previousState?.status === "ready"
		? previousState
		: {
				...createInitialTrayCalendarState(),
				status,
			};

const isSameCalendarDay = (left, right) =>
	left.getFullYear() === right.getFullYear() &&
	left.getMonth() === right.getMonth() &&
	left.getDate() === right.getDate();

const isTrayEventToday = (event, currentDate) => {
	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt).getTime();

	return (
		isSameCalendarDay(startAt, currentDate) && endAt >= currentDate.getTime()
	);
};

export const getUpcomingTrayEventsForDay = (events, currentDate) =>
	events
		.filter((event) => isTrayEventToday(event, currentDate))
		.sort(
			(left, right) =>
				new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
		);

const getTraySameDayEvents = (events, currentDate) =>
	events
		.filter((event) => isSameCalendarDay(new Date(event.startAt), currentDate))
		.sort(
			(left, right) =>
				new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
		);

export const getDetectedMeetingCalendarEventFromEvents = (
	events,
	currentDate = new Date(),
) => {
	const currentTimestamp = currentDate.getTime();
	const todayMeetings = getTraySameDayEvents(events, currentDate).filter(
		(event) => event?.isMeeting,
	);
	const liveMeeting = todayMeetings.find((event) => {
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

	const recentlyStartedMeeting = todayMeetings.find((event) => {
		const startAt = new Date(event.startAt).getTime();

		return (
			Number.isFinite(startAt) &&
			startAt <= currentTimestamp &&
			currentTimestamp - startAt <= detectedMeetingCalendarPostStartWindowMs
		);
	});

	if (recentlyStartedMeeting) {
		return recentlyStartedMeeting;
	}

	return null;
};
