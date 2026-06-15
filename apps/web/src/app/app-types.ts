import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type AppUser = {
	name: string;
	email: string;
	avatar: string;
};

export type AppView =
	| "home"
	| "chat"
	| "automation"
	| "inbox"
	| "shared"
	| "project"
	| "note"
	| "notFound";

type UpcomingCalendarEventsResponse = FunctionReturnType<
	typeof api.calendar.listUpcomingGoogleEvents
>;

export type UpcomingCalendarEvent =
	UpcomingCalendarEventsResponse["events"][number];

export type UpcomingCalendarState =
	| { status: "checking"; events: [] }
	| { status: "ready"; events: UpcomingCalendarEvent[] }
	| { status: "not_connected"; events: [] }
	| { status: "error"; events: [] };

export type AppLocationState = {
	view: AppView;
	chatId: string | null;
	projectIdString: string | null;
	noteIdString: string | null;
	noteCaptureRequestId: string | null;
	shouldAutoStartNoteCapture: boolean;
	shouldStopNoteCaptureWhenMeetingEnds: boolean;
	scheduledAutoStartNoteCaptureAt: string | null;
	pendingCalendarEvent: UpcomingCalendarEvent | null;
	canonicalPath:
		| "/home"
		| "/chat"
		| "/automations"
		| "/inbox"
		| "/project"
		| "/shared"
		| "/note"
		| null;
	canonicalSearch: string;
};

export type SocialAuthProvider = "github" | "google";
