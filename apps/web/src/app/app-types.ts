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

export type UpcomingCalendarEvent = {
	id: string;
	calendarId: string;
	calendarName: string;
	title: string;
	startAt: string;
	endAt: string;
	isAllDay: boolean;
	isMeeting: boolean;
	htmlLink?: string;
	meetingUrl?: string;
	location?: string;
};

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
