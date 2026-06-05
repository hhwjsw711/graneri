import assert from "node:assert/strict";
import test from "node:test";
import {
	createMeetingSignal,
	createMeetingSignalCalendarEvent,
	createMeetingSignalStatePatch,
	isMeetingSignalDismissed,
} from "../src/meeting-signal.mjs";

const calendarEvent = {
	id: "event-1",
	calendarId: "calendar-1",
	calendarName: "Work",
	endAt: "2026-06-05T10:30:00.000Z",
	isAllDay: false,
	isMeeting: true,
	startAt: "2026-06-05T10:00:00.000Z",
	title: "Product review",
};

test("does not create a meeting signal from inactive microphone state", () => {
	assert.equal(
		createMeetingSignal({
			calendarEvent,
			isMicrophoneActive: false,
			sourceName: "Google Meet",
		}),
		null,
	);
});

test("prefers calendar events over source-only signals", () => {
	assert.deepEqual(
		createMeetingSignal({
			calendarEvent,
			isMicrophoneActive: true,
			sourceName: "Google Meet",
		}),
		{
			calendarEvent,
			key: "calendar:event-1:2026-06-05T10:00:00.000Z",
			sourceName: "Google Meet",
		},
	);
});

test("uses source-only signal when calendar signals are disabled", () => {
	assert.deepEqual(
		createMeetingSignal({
			calendarEvent,
			canUseCalendarEvent: false,
			isMicrophoneActive: true,
			sourceName: "Telegram",
		}),
		{
			calendarEvent: null,
			key: "source:Telegram",
			sourceName: "Telegram",
		},
	);
});

test("does not prompt for calendar-only signal when calendar signals are disabled", () => {
	assert.equal(
		createMeetingSignal({
			calendarEvent,
			canUseCalendarEvent: false,
			isMicrophoneActive: true,
			sourceName: null,
		}),
		null,
	);
});

test("creates source-only signals for known microphone sources", () => {
	assert.deepEqual(
		createMeetingSignal({
			calendarEvent: null,
			isMicrophoneActive: true,
			sourceName: "Slack Huddle",
		}),
		{
			calendarEvent: null,
			key: "source:Slack Huddle",
			sourceName: "Slack Huddle",
		},
	);
});

test("does not prompt on generic microphone activity without source or calendar", () => {
	assert.equal(
		createMeetingSignal({
			calendarEvent: null,
			isMicrophoneActive: true,
			sourceName: null,
		}),
		null,
	);
});

test("serializes calendar event details for the desktop bridge", () => {
	assert.deepEqual(createMeetingSignalCalendarEvent(calendarEvent), {
		id: "event-1",
		calendarName: "Work",
		endAt: "2026-06-05T10:30:00.000Z",
		startAt: "2026-06-05T10:00:00.000Z",
		title: "Product review",
	});
});

test("projects meeting signal state for the desktop bridge", () => {
	const signal = createMeetingSignal({
		calendarEvent,
		isMicrophoneActive: true,
		sourceName: "Google Meet",
	});

	assert.deepEqual(createMeetingSignalStatePatch(signal), {
		calendarEvent: {
			id: "event-1",
			calendarName: "Work",
			endAt: "2026-06-05T10:30:00.000Z",
			startAt: "2026-06-05T10:00:00.000Z",
			title: "Product review",
		},
		sourceName: "Google Meet",
	});
	assert.deepEqual(createMeetingSignalStatePatch(null), {
		calendarEvent: null,
		sourceName: null,
	});
});

test("scopes dismissal to the current signal key", () => {
	const signal = createMeetingSignal({
		calendarEvent: null,
		isMicrophoneActive: true,
		sourceName: "FaceTime",
	});

	assert.equal(
		isMeetingSignalDismissed({
			dismissedUntil: 2_000,
			now: 1_000,
			signal,
			signalKey: "source:FaceTime",
		}),
		true,
	);
	assert.equal(
		isMeetingSignalDismissed({
			dismissedUntil: 2_000,
			now: 1_000,
			signal,
			signalKey: "source:Slack Huddle",
		}),
		false,
	);
});
