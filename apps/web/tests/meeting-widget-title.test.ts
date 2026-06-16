import type { DesktopMeetingDetectionState } from "@workspace/platform/desktop-bridge";
import { describe, expect, it } from "vitest";
import {
	getMeetingWidgetDetail,
	getMeetingWidgetTitle,
} from "../src/lib/meeting-widget-title";

const createState = (
	overrides: Partial<DesktopMeetingDetectionState> = {},
): DesktopMeetingDetectionState => ({
	activeMicApps: [],
	calendarEvent: null,
	candidateStartedAt: Date.now(),
	confidence: 0.82,
	dismissedUntil: null,
	hasMeetingSignal: true,
	isMicrophoneActive: true,
	isSuppressed: false,
	meetingWindowState: {
		appName: null,
		bundleId: null,
		permissionGranted: false,
		pid: null,
		provider: null,
		source: "accessibility",
		status: "unavailable",
		title: null,
	},
	sourceName: null,
	status: "prompting",
	...overrides,
});

describe("meeting widget title", () => {
	it("uses call-specific language for known ad-hoc sources", () => {
		expect(
			getMeetingWidgetTitle(createState({ sourceName: "Slack Huddle" })),
		).toBe("Huddle detected");
		expect(getMeetingWidgetTitle(createState({ sourceName: "FaceTime" }))).toBe(
			"Call detected",
		);
		expect(getMeetingWidgetTitle(createState({ sourceName: "WhatsApp" }))).toBe(
			"Call detected",
		);
	});

	it("uses meeting language for scheduled and browser meeting sources", () => {
		expect(
			getMeetingWidgetTitle(createState({ sourceName: "Google Meet" })),
		).toBe("Meeting detected");
		expect(getMeetingWidgetTitle(createState({ sourceName: "Zoom" }))).toBe(
			"Meeting detected",
		);
	});

	it("keeps meeting language stable while monitoring an active signal", () => {
		expect(getMeetingWidgetTitle(createState({ status: "monitoring" }))).toBe(
			"Meeting detected",
		);
	});

	it("listens for calls when there is no active meeting signal", () => {
		expect(
			getMeetingWidgetTitle(
				createState({ hasMeetingSignal: false, status: "monitoring" }),
			),
		).toBe("Listening for calls");
		expect(
			getMeetingWidgetDetail(
				createState({
					hasMeetingSignal: false,
					sourceName: "Google Meet",
					status: "monitoring",
				}),
			),
		).toBe(null);
	});

	it("shows source detail while monitoring an active signal", () => {
		expect(
			getMeetingWidgetDetail(
				createState({ sourceName: "Google Meet", status: "monitoring" }),
			),
		).toBe("Google Meet");
		expect(
			getMeetingWidgetDetail(
				createState({
					calendarEvent: {
						id: "event-1",
						calendarName: "Work",
						endAt: "2026-06-05T10:30:00.000Z",
						startAt: "2026-06-05T10:00:00.000Z",
						title: "Product review",
					},
					status: "monitoring",
				}),
			),
		).toBe("Product review");
	});

	it("listens for calls without state", () => {
		expect(getMeetingWidgetTitle(null)).toBe("Listening for calls");
		expect(getMeetingWidgetDetail(null)).toBe(null);
	});

	it("explains the source of the prompt", () => {
		expect(
			getMeetingWidgetDetail(createState({ sourceName: "Google Meet" })),
		).toBe("Google Meet");
		expect(
			getMeetingWidgetDetail(createState({ sourceName: "Telegram" })),
		).toBe("Telegram");
		expect(
			getMeetingWidgetDetail(
				createState({
					calendarEvent: {
						id: "event-1",
						calendarName: "Work",
						endAt: "2026-06-05T10:30:00.000Z",
						startAt: "2026-06-05T10:00:00.000Z",
						title: "Product review",
					},
					sourceName: "Google Meet",
				}),
			),
		).toBe("Product review");
	});
});
