export const createMeetingSignalCalendarEvent = (event) => {
	if (!event) {
		return null;
	}

	return {
		id: event.id,
		calendarName: event.calendarName,
		endAt: event.endAt,
		startAt: event.startAt,
		title: event.title,
	};
};

export const createMeetingSignalStatePatch = (signal) => ({
	calendarEvent: createMeetingSignalCalendarEvent(signal?.calendarEvent),
	sourceName: signal?.sourceName ?? null,
});

export const createMeetingSignal = ({
	calendarEvent,
	canUseCalendarEvent = true,
	isMicrophoneActive,
	sourceName,
}) => {
	if (!isMicrophoneActive) {
		return null;
	}

	if (canUseCalendarEvent && calendarEvent) {
		return {
			calendarEvent,
			key: `calendar:${calendarEvent.id}:${calendarEvent.startAt}`,
			sourceName,
		};
	}

	if (sourceName) {
		return {
			calendarEvent: null,
			key: `source:${sourceName}`,
			sourceName,
		};
	}

	return null;
};

export const isMeetingSignalDismissed = ({
	dismissedUntil,
	now = Date.now(),
	signal,
	signalKey,
}) =>
	Boolean(signal && signalKey === signal.key && (dismissedUntil ?? 0) > now);
