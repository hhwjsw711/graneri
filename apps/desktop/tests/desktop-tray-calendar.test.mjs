import assert from "node:assert/strict";
import test from "node:test";
import { getDetectedMeetingCalendarEventFromEvents } from "../src/desktop-tray-calendar-detection.mjs";

const createMeetingEvent = (overrides = {}) => ({
	calendarId: "calendar-1",
	calendarName: "Work",
	endAt: "2026-06-08T10:30:00.000Z",
	htmlLink: null,
	id: "event-1",
	isAllDay: false,
	isMeeting: true,
	location: null,
	meetingUrl: "https://meet.google.com/abc-defg-hij",
	startAt: "2026-06-08T10:00:00.000Z",
	title: "Product review",
	...overrides,
});

test("detects live calendar meetings", () => {
	const event = createMeetingEvent();

	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T10:05:00.000Z"),
		),
		event,
	);
});

test("associates ad-hoc calls with meetings started within the last 15 minutes", () => {
	const event = createMeetingEvent({
		endAt: "2026-06-08T10:05:00.000Z",
	});

	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T10:14:59.000Z"),
		),
		event,
	);
	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T10:15:01.000Z"),
		),
		null,
	);
});

test("does not use future calendar meetings as detected meeting context", () => {
	const event = createMeetingEvent();

	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T09:59:01.000Z"),
		),
		null,
	);
	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T09:55:00.000Z"),
		),
		null,
	);
});
