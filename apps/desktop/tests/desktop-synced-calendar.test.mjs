import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopSyncedCalendar } from "../src/desktop-synced-calendar.mjs";

test("stores normalized renderer-synced tray calendar events", async () => {
	const calendar = createDesktopSyncedCalendar();

	calendar.setState({
		connectedCalendarCount: 1,
		events: [
			{
				calendarId: "calendar-1",
				calendarName: "Work",
				endAt: "2026-06-16T17:00:00Z",
				htmlLink: "https://calendar.example/event",
				id: "event-1",
				isAllDay: false,
				isMeeting: true,
				location: null,
				meetingUrl: "https://meet.google.com/abc-defg-hij",
				startAt: "2026-06-16T16:00:00Z",
				title: "Planning",
			},
		],
		status: "ready",
	});

	assert.deepEqual(await calendar.listCurrentDayEvents(), {
		connectedCalendarCount: 1,
		events: [
			{
				calendarId: "calendar-1",
				calendarName: "Work",
				endAt: "2026-06-16T17:00:00.000Z",
				htmlLink: "https://calendar.example/event",
				id: "event-1",
				isAllDay: false,
				isMeeting: true,
				location: null,
				meetingUrl: "https://meet.google.com/abc-defg-hij",
				startAt: "2026-06-16T16:00:00.000Z",
				title: "Planning",
			},
		],
		status: "ready",
	});
});

test("rejects invalid tray calendar status", () => {
	const calendar = createDesktopSyncedCalendar();

	assert.throws(
		() => calendar.setState({ events: [], status: "checking" }),
		/Tray calendar status is invalid/,
	);
});

test("clears synced tray calendar events when disconnected", async () => {
	const calendar = createDesktopSyncedCalendar();

	calendar.setState({
		connectedCalendarCount: 1,
		events: [
			{
				calendarId: "calendar-1",
				calendarName: "Work",
				endAt: "2026-06-16T17:00:00Z",
				htmlLink: null,
				id: "event-1",
				isAllDay: false,
				isMeeting: false,
				location: null,
				meetingUrl: null,
				startAt: "2026-06-16T16:00:00Z",
				title: "Planning",
			},
		],
		status: "ready",
	});
	calendar.setState({ events: [], status: "not_connected" });

	assert.deepEqual(await calendar.listCurrentDayEvents(), {
		connectedCalendarCount: 0,
		events: [],
		status: "not_connected",
	});
});

test("does not expose mutable synced calendar state", async () => {
	const calendar = createDesktopSyncedCalendar();

	calendar.setState({
		connectedCalendarCount: 1,
		events: [
			{
				calendarId: "calendar-1",
				calendarName: "Work",
				endAt: "2026-06-16T17:00:00Z",
				htmlLink: null,
				id: "event-1",
				isAllDay: false,
				isMeeting: true,
				location: null,
				meetingUrl: "https://meet.google.com/abc-defg-hij",
				startAt: "2026-06-16T16:00:00Z",
				title: "Planning",
			},
		],
		status: "ready",
	});

	const firstRead = await calendar.listCurrentDayEvents();
	firstRead.events[0].title = "Mutated";
	firstRead.events.push({ ...firstRead.events[0], id: "event-2" });

	const secondRead = await calendar.listCurrentDayEvents();
	assert.equal(secondRead.events.length, 1);
	assert.equal(secondRead.events[0].title, "Planning");
});
