import { listYandexUpcomingEvents } from "../../../convex/yandexCalendar.ts";
import { buildContext7Tools } from "./context7-tools.mjs";
import { buildFigmaTools } from "./figma-tools.mjs";
import { buildGoogleCalendarTools } from "./google-calendar-tools.mjs";
import { buildGoogleDriveTools } from "./google-drive-tools.mjs";
import { buildJiraMcpTools } from "./jira-mcp-tools.mjs";
import { buildLinearTools } from "./linear-tools.mjs";
import { buildNotionTools } from "./notion-tools.mjs";
import { buildPostHogTools } from "./posthog-tools.mjs";
import { buildYandexCalendarTools } from "./yandex-calendar-tools.mjs";
import { buildYandexTrackerTools } from "./yandex-tracker-tools.mjs";
import { buildZoomMcpTools } from "./zoom-mcp-tools.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_LOOKAHEAD_MS = 30 * DAY_MS;

const normalizeCalendarEvents = (
	events,
	{ limit, meetingsOnly, query } = {},
) => {
	const normalizedQuery =
		typeof query === "string" ? query.trim().toLowerCase() : "";

	return events
		.filter((event) => {
			if (meetingsOnly && !event.isMeeting) {
				return false;
			}

			if (!normalizedQuery) {
				return true;
			}

			return [
				event.title,
				event.calendarName,
				event.location,
				event.meetingUrl,
				event.description,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(normalizedQuery);
		})
		.slice(0, Math.max(1, Math.min(limit ?? 10, 25)));
};

const buildCalendarSources = (events) =>
	events
		.map((event) =>
			event.meetingUrl
				? {
						type: "url",
						url: event.meetingUrl,
						title: event.title || event.calendarName,
					}
				: null,
		)
		.filter(Boolean);

const fetchYandexCalendarEvents = async (connection, args = {}) => {
	const now = Date.now();
	const result = await listYandexUpcomingEvents({
		connection,
		now,
		timeMin: now,
		timeMax: now + CALENDAR_LOOKAHEAD_MS,
	});
	const events = normalizeCalendarEvents(result.events, args);

	return {
		connection: connection.displayName,
		events,
		sources: buildCalendarSources(events),
	};
};

const defaultYandexCalendarAdapter = (connection) => ({
	listEvents: async ({ limit, meetingsOnly }) =>
		await fetchYandexCalendarEvents(connection, {
			limit,
			meetingsOnly,
		}),
	searchEvents: async ({ query, limit, meetingsOnly }) =>
		await fetchYandexCalendarEvents(connection, {
			query,
			limit,
			meetingsOnly,
		}),
});

export const buildWorkspaceToolSet = async (connections, adapters = {}) => {
	const tools = {};

	for (const connection of connections) {
		if (connection.provider === "jira-mcp") {
			Object.assign(tools, await buildJiraMcpTools(connection));
		}

		if (connection.provider === "notion") {
			Object.assign(tools, await buildNotionTools(connection));
		}

		if (connection.provider === "posthog") {
			Object.assign(tools, await buildPostHogTools(connection));
		}

		if (connection.provider === "google-calendar" && adapters.googleCalendar) {
			Object.assign(tools, buildGoogleCalendarTools(adapters.googleCalendar));
		}

		if (connection.provider === "google-drive" && adapters.googleDrive) {
			Object.assign(tools, buildGoogleDriveTools(adapters.googleDrive));
		}

		if (connection.provider === "yandex-calendar") {
			Object.assign(
				tools,
				buildYandexCalendarTools({
					...defaultYandexCalendarAdapter(connection),
					...adapters.yandexCalendar,
				}),
			);
		}

		if (connection.provider === "yandex-tracker") {
			Object.assign(tools, buildYandexTrackerTools(connection));
		}

		if (connection.provider === "zoom") {
			Object.assign(tools, await buildZoomMcpTools(connection));
		}

		if (connection.provider === "context7") {
			Object.assign(tools, await buildContext7Tools(connection));
		}

		if (connection.provider === "figma") {
			Object.assign(tools, await buildFigmaTools(connection));
		}

		if (connection.provider === "linear") {
			Object.assign(tools, await buildLinearTools(connection));
		}
	}

	return tools;
};
