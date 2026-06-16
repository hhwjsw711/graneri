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
	meetingWindowState,
	sourceName,
}) => {
	const hasActiveMeetingWindow = meetingWindowState?.status === "active";
	const hasActiveStandaloneMeetingWindow =
		hasActiveMeetingWindow && meetingWindowState?.source !== "browser";
	const hasCorroboratedBrowserMeetingWindow =
		hasActiveMeetingWindow &&
		meetingWindowState?.source === "browser" &&
		(isMicrophoneActive || (canUseCalendarEvent && calendarEvent));

	if (
		!isMicrophoneActive &&
		!hasActiveStandaloneMeetingWindow &&
		!hasCorroboratedBrowserMeetingWindow
	) {
		return null;
	}

	if (canUseCalendarEvent && calendarEvent) {
		return {
			calendarEvent,
			key: `calendar:${calendarEvent.id}:${calendarEvent.startAt}`,
			sourceName,
		};
	}

	if (hasActiveStandaloneMeetingWindow) {
		const provider = meetingWindowState.provider ?? "Meeting";
		return {
			calendarEvent: null,
			key: `window:${provider}:${meetingWindowState.pid ?? "unknown"}:${meetingWindowState.title ?? ""}`,
			sourceName: provider,
		};
	}

	if (hasCorroboratedBrowserMeetingWindow) {
		const provider = meetingWindowState.provider ?? "Meeting";
		return {
			calendarEvent: null,
			key: `browser-window:${provider}:${meetingWindowState.title ?? ""}`,
			sourceName: provider,
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

export const hasMeetingSignal = (options) =>
	Boolean(createMeetingSignal(options));

export const isMeetingSignalDismissed = ({
	dismissedUntil,
	now = Date.now(),
	signal,
	signalKey,
}) =>
	Boolean(signal && signalKey === signal.key && (dismissedUntil ?? 0) > now);
