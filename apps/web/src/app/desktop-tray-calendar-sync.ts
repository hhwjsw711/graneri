import { setDesktopTrayCalendarState } from "@workspace/platform/desktop";
import type { DesktopTrayCalendarState } from "@workspace/platform/desktop-bridge";
import type { UpcomingCalendarEvent } from "@/app/app-types";

const disconnectedDesktopTrayCalendarState = {
	status: "not_connected",
	events: [],
} satisfies DesktopTrayCalendarState;

const errorDesktopTrayCalendarState = {
	status: "error",
	events: [],
} satisfies DesktopTrayCalendarState;

const toDesktopTrayCalendarEvent = (event: UpcomingCalendarEvent) => ({
	calendarId: event.calendarId,
	calendarName: event.calendarName,
	endAt: event.endAt,
	htmlLink: event.htmlLink ?? null,
	id: event.id,
	isAllDay: event.isAllDay,
	isMeeting: event.isMeeting,
	location: event.location ?? null,
	meetingUrl: event.meetingUrl ?? null,
	startAt: event.startAt,
	title: event.title,
});

export const syncDisconnectedDesktopTrayCalendar = () => {
	void setDesktopTrayCalendarState(disconnectedDesktopTrayCalendarState);
};

export const syncErrorDesktopTrayCalendar = () => {
	void setDesktopTrayCalendarState(errorDesktopTrayCalendarState);
};

export const syncReadyDesktopTrayCalendar = ({
	connectedCalendarCount,
	events,
}: {
	connectedCalendarCount: number;
	events: UpcomingCalendarEvent[];
}) => {
	void setDesktopTrayCalendarState({
		status: "ready",
		connectedCalendarCount,
		events: events.map((event) => toDesktopTrayCalendarEvent(event)),
	});
};
