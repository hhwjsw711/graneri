import type { UIMessage } from "ai";
import type { AppLocationState, UpcomingCalendarEvent } from "@/app/app-types";
import type { SettingsPage } from "@/components/settings/settings-types";

const SETTINGS_PAGE_BY_SLUG = {
	profile: "Profile",
	appearance: "Appearance",
	preferences: "Preferences",
	notifications: "Notifications",
	workspace: "Workspace",
	calendar: "Calendar",
	connections: "Connections",
	"data-controls": "Data controls",
} as const satisfies Record<string, SettingsPage>;

const SETTINGS_SLUG_BY_PAGE: Record<SettingsPage, string> = {
	Profile: "profile",
	Appearance: "appearance",
	Preferences: "preferences",
	Notifications: "notifications",
	Workspace: "workspace",
	Calendar: "calendar",
	Connections: "connections",
	"Data controls": "data-controls",
};

const WELCOME_FIREWORK_COLOR_VARIABLES = [
	"--chart-1",
	"--chart-2",
	"--chart-3",
	"--chart-4",
	"--chart-5",
] as const;

const upcomingEventDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	weekday: "short",
});

const upcomingEventTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const isSameCalendarDay = (left: Date, right: Date) =>
	left.getFullYear() === right.getFullYear() &&
	left.getMonth() === right.getMonth() &&
	left.getDate() === right.getDate();

const appendCalendarEventSearchParams = ({
	event,
	searchParams,
}: {
	event: UpcomingCalendarEvent;
	searchParams: URLSearchParams;
}) => {
	searchParams.set("calendarEventId", event.id);
	searchParams.set("calendarId", event.calendarId);
	searchParams.set("calendarName", event.calendarName);
	searchParams.set("eventTitle", event.title);
	searchParams.set("startAt", event.startAt);
	searchParams.set("endAt", event.endAt);
	searchParams.set("isAllDay", event.isAllDay ? "1" : "0");

	if (event.meetingUrl?.trim()) {
		searchParams.set("meetingUrl", event.meetingUrl);
	}

	if (event.location?.trim()) {
		searchParams.set("location", event.location);
	}

	if (event.htmlLink?.trim()) {
		searchParams.set("htmlLink", event.htmlLink);
	}
};

const getScheduledAutoStartNoteCaptureAt = (url: URL): string | null => {
	const captureAt = url.searchParams.get("captureAt")?.trim();

	if (!captureAt) {
		return null;
	}

	return Number.isNaN(new Date(captureAt).getTime()) ? null : captureAt;
};

const normalizePathname = (pathname: string) => {
	const normalizedPath = pathname.replace(/\/+$/, "");
	return normalizedPath === "" ? "/" : normalizedPath;
};

const getNoteIdStringFromUrl = (url: URL) => {
	const nextValue = url.searchParams.get("noteId")?.trim();

	return nextValue ? nextValue : null;
};

const getChatIdFromUrl = (url: URL) => {
	const nextValue = url.searchParams.get("chatId")?.trim();

	return nextValue ? nextValue : null;
};

export function getThemeFireworkColors() {
	if (typeof window === "undefined") {
		return ["#afabff", "#8f88ff", "#7166ff", "#564dff", "#4138d9"];
	}

	const styles = window.getComputedStyle(document.documentElement);
	return WELCOME_FIREWORK_COLOR_VARIABLES.flatMap((variableName) => {
		const value = styles.getPropertyValue(variableName).trim();
		return value ? [value] : [];
	});
}

export const createCalendarEventKey = (event: UpcomingCalendarEvent) =>
	[event.calendarId, event.id, event.startAt].join("::");

const getCurrentDayWindow = (currentDate: Date) => {
	const timeMin = new Date(currentDate);
	timeMin.setHours(0, 0, 0, 0);

	const timeMax = new Date(currentDate);
	timeMax.setHours(23, 59, 59, 999);

	return {
		timeMin: timeMin.toISOString(),
		timeMax: timeMax.toISOString(),
	};
};

export const getDayWindowFromDayKey = (dayKey: string) => {
	const [year, month, day] = dayKey.split("-").map((value) => Number(value));
	return getCurrentDayWindow(new Date(year, month - 1, day));
};

export const isUpcomingEventLive = (
	event: UpcomingCalendarEvent,
	currentDate: Date,
) => {
	const startAt = new Date(event.startAt).getTime();
	const endAt = new Date(event.endAt).getTime();
	const now = currentDate.getTime();
	const liveWindowStart = startAt - 5 * 60 * 1000;

	return now >= liveWindowStart && now <= endAt;
};

export const getUpcomingCalendarIndicator = ({
	hasLiveMeeting,
	status,
}: {
	hasLiveMeeting: boolean;
	status: "idle" | "ready" | "not_connected" | "error";
}) => {
	if (hasLiveMeeting) {
		return {
			label: "Live now",
			dotClassName: "bg-status-live",
		};
	}

	if (status === "idle") {
		return {
			label: "Checking",
			dotClassName: "bg-warning-foreground",
		};
	}

	if (status === "ready") {
		return {
			label: "Connected",
			dotClassName: "bg-chart-1",
		};
	}

	if (status === "error") {
		return {
			label: "Sync issue",
			dotClassName: "bg-destructive",
		};
	}

	return {
		label: "Not connected",
		dotClassName: "bg-muted-foreground/60",
	};
};

export const formatUpcomingEventMeta = (
	event: UpcomingCalendarEvent,
	currentDate: Date,
) => {
	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt);

	if (event.isAllDay) {
		return isSameCalendarDay(startAt, currentDate)
			? "Today · All day"
			: `${upcomingEventDateFormatter.format(startAt)} · All day`;
	}

	const timeRange = `${upcomingEventTimeFormatter.format(startAt)} - ${upcomingEventTimeFormatter.format(endAt)}`;

	if (isUpcomingEventLive(event, currentDate)) {
		return `Now · ${timeRange}`;
	}

	return isSameCalendarDay(startAt, currentDate)
		? timeRange
		: `${upcomingEventDateFormatter.format(startAt)} · ${timeRange}`;
};

export const isUpcomingEventToday = (
	event: UpcomingCalendarEvent,
	currentDate: Date,
) => {
	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt).getTime();

	return (
		isSameCalendarDay(startAt, currentDate) && endAt >= currentDate.getTime()
	);
};

export const buildCalendarEventNoteDocument = ({
	currentDate,
	event,
}: {
	currentDate: Date;
	event: UpcomingCalendarEvent;
}) => {
	const details = [
		`When: ${formatUpcomingEventMeta(event, currentDate)}`,
		`Calendar: ${event.calendarName}`,
		event.location?.trim() ? `Location: ${event.location.trim()}` : null,
		event.meetingUrl?.trim() ? `Join link: ${event.meetingUrl.trim()}` : null,
	].filter((value): value is string => Boolean(value));

	return JSON.stringify({
		type: "doc",
		content: details.map((detail) => ({
			type: "paragraph",
			content: [{ type: "text", text: detail }],
		})),
	});
};

export const buildCalendarEventSearchableText = ({
	currentDate,
	event,
}: {
	currentDate: Date;
	event: UpcomingCalendarEvent;
}) =>
	[
		event.title.trim(),
		`When: ${formatUpcomingEventMeta(event, currentDate)}`,
		`Calendar: ${event.calendarName}`,
		event.location?.trim() ? `Location: ${event.location.trim()}` : null,
		event.meetingUrl?.trim() ? `Join link: ${event.meetingUrl.trim()}` : null,
	]
		.filter((value): value is string => Boolean(value))
		.join("\n");

const getPendingCalendarEventFromUrl = (
	url: URL,
): UpcomingCalendarEvent | null => {
	const id = url.searchParams.get("calendarEventId")?.trim();
	const calendarId = url.searchParams.get("calendarId")?.trim();
	const calendarName = url.searchParams.get("calendarName")?.trim();
	const title = url.searchParams.get("eventTitle")?.trim();
	const startAt = url.searchParams.get("startAt")?.trim();
	const endAt = url.searchParams.get("endAt")?.trim();

	if (!id || !calendarId || !calendarName || !title || !startAt || !endAt) {
		return null;
	}

	return {
		id,
		calendarId,
		calendarName,
		title,
		startAt,
		endAt,
		isAllDay: url.searchParams.get("isAllDay") === "1",
		isMeeting: true,
		htmlLink: url.searchParams.get("htmlLink")?.trim() || undefined,
		location: url.searchParams.get("location")?.trim() || undefined,
		meetingUrl: url.searchParams.get("meetingUrl")?.trim() || undefined,
	};
};

export const createNoteSearch = ({
	autoStartCapture = false,
	calendarEvent,
	noteId,
	scheduledAutoStartAt,
	stopCaptureWhenMeetingEnds = false,
}: {
	autoStartCapture?: boolean;
	calendarEvent?: UpcomingCalendarEvent | null;
	noteId?: string | null;
	scheduledAutoStartAt?: string | null;
	stopCaptureWhenMeetingEnds?: boolean;
}) => {
	const searchParams = new URLSearchParams();

	if (noteId?.trim()) {
		searchParams.set("noteId", noteId);
	}

	if (autoStartCapture) {
		searchParams.set("capture", "1");
	}

	if (stopCaptureWhenMeetingEnds) {
		searchParams.set("meeting", "1");
	}

	if (scheduledAutoStartAt?.trim()) {
		searchParams.set("captureAt", scheduledAutoStartAt);
	}

	if (calendarEvent && !noteId) {
		appendCalendarEventSearchParams({
			event: calendarEvent,
			searchParams,
		});
	}

	const search = searchParams.toString();
	return search ? `?${search}` : "";
};

export const getSettingsPageFromPath = (
	pathname: string,
): SettingsPage | null => {
	const normalizedPath = pathname.replace(/\/+$/, "") || "/";

	if (normalizedPath === "/settings") {
		return "Profile";
	}

	if (!normalizedPath.startsWith("/settings/")) {
		return null;
	}

	const slug = normalizedPath.slice("/settings/".length);
	return (
		SETTINGS_PAGE_BY_SLUG[slug as keyof typeof SETTINGS_PAGE_BY_SLUG] ??
		"Profile"
	);
};

export const getSettingsPath = (page: SettingsPage) =>
	`/settings/${SETTINGS_SLUG_BY_PAGE[page]}`;

export const getAppLocationState = (url: URL): AppLocationState => {
	const pathname = normalizePathname(url.pathname);
	const noteIdString = getNoteIdStringFromUrl(url);
	const chatId = getChatIdFromUrl(url);
	const hashView =
		pathname === "/" || pathname === "/home"
			? url.hash === "#note"
				? "note"
				: url.hash === "#chat"
					? "chat"
					: url.hash === "#automations"
						? "automation"
						: url.hash === "#inbox"
							? "inbox"
							: url.hash === "#shared"
								? "shared"
								: null
			: null;
	const pathView =
		pathname === "/"
			? "home"
			: pathname === "/home"
				? "home"
				: pathname === "/note"
					? "note"
					: pathname === "/chat"
						? "chat"
						: pathname === "/automations"
							? "automation"
							: pathname === "/inbox"
								? "inbox"
								: pathname === "/shared"
									? "shared"
									: null;
	const view = hashView ?? pathView;

	if (view === null) {
		return {
			view: "notFound",
			chatId: null,
			noteIdString: null,
			shouldAutoStartNoteCapture: false,
			shouldStopNoteCaptureWhenMeetingEnds: false,
			scheduledAutoStartNoteCaptureAt: null,
			pendingCalendarEvent: null,
			canonicalPath: null,
			canonicalSearch: "",
		};
	}

	const shouldAutoStartNoteCapture =
		view === "note" && url.searchParams.get("capture") === "1";
	const shouldStopNoteCaptureWhenMeetingEnds =
		view === "note" && url.searchParams.get("meeting") === "1";
	const scheduledAutoStartNoteCaptureAt =
		view === "note" ? getScheduledAutoStartNoteCaptureAt(url) : null;
	const pendingCalendarEvent =
		view === "note" && noteIdString === null
			? getPendingCalendarEventFromUrl(url)
			: null;

	return {
		view,
		chatId: view === "chat" ? chatId : null,
		noteIdString: view === "note" ? noteIdString : null,
		shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds,
		scheduledAutoStartNoteCaptureAt,
		pendingCalendarEvent,
		canonicalPath:
			view === "home"
				? "/home"
				: view === "chat"
					? "/chat"
					: view === "automation"
						? "/automations"
						: view === "inbox"
							? "/inbox"
							: view === "shared"
								? "/shared"
								: "/note",
		canonicalSearch:
			view === "note"
				? createNoteSearch({
						autoStartCapture: shouldAutoStartNoteCapture,
						calendarEvent: pendingCalendarEvent,
						noteId: noteIdString,
						scheduledAutoStartAt: scheduledAutoStartNoteCaptureAt,
						stopCaptureWhenMeetingEnds: shouldStopNoteCaptureWhenMeetingEnds,
					})
				: view === "chat" && chatId
					? `?chatId=${encodeURIComponent(chatId)}`
					: "",
	};
};

export const shouldAutoStartNoteCaptureFromUrl = (url: URL) =>
	getAppLocationState(url).shouldAutoStartNoteCapture;

export const getInitialNonSettingsLocation = () => {
	if (typeof window === "undefined") {
		return "/home";
	}

	const url = new URL(window.location.href);
	const settingsPage = getSettingsPageFromPath(url.pathname);

	if (settingsPage || url.hash === "#settings") {
		return "/home";
	}

	return `${url.pathname}${url.search}${url.hash}`;
};

export const getSharedNoteShareId = (pathname: string) => {
	const sharedPrefix = "/shared/";

	if (!pathname.startsWith(sharedPrefix)) {
		return null;
	}

	const nextValue = pathname.slice(sharedPrefix.length).trim();
	return nextValue ? decodeURIComponent(nextValue) : null;
};

export const toStoredChatMessages = (
	messages: Array<{
		id: string;
		role: "system" | "user" | "assistant";
		partsJson: string;
		metadataJson?: string;
		createdAt?: number;
	}>,
): UIMessage[] =>
	messages.map((message) => ({
		id: message.id,
		role: message.role,
		metadata: message.metadataJson
			? (JSON.parse(message.metadataJson) as UIMessage["metadata"])
			: undefined,
		parts: JSON.parse(message.partsJson) as UIMessage["parts"],
		createdAt: message.createdAt,
	}));
