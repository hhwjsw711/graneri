import { buildContext7Tools } from "./context7-tools.mjs";
import { capabilityMetadataDefinitions } from "./capability-metadata.mjs";
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
const YANDEX_CALENDAR_LOOKAHEAD_MS = 30 * DAY_MS;

const normalizeYandexCalendarEvents = (
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

const buildYandexCalendarSources = (events) =>
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

const fetchYandexCalendarEvents = async (adapter, args = {}) => {
	const result = await adapter.listUpcomingEvents({
		lookaheadMs: YANDEX_CALENDAR_LOOKAHEAD_MS,
	});
	const events = normalizeYandexCalendarEvents(result.events, args);

	return {
		connection: result.connection,
		events,
		sources: buildYandexCalendarSources(events),
	};
};

const buildYandexCalendarToolAdapter = (adapter) => ({
	listEvents: async ({ limit, meetingsOnly }) =>
		await fetchYandexCalendarEvents(adapter, {
			limit,
			meetingsOnly,
		}),
	searchEvents: async ({ query, limit, meetingsOnly }) =>
		await fetchYandexCalendarEvents(adapter, {
			query,
			limit,
			meetingsOnly,
		}),
});

const capabilityToolBuilders = {
	"google-calendar": async (_connection, adapters) =>
			adapters.googleCalendar
				? buildGoogleCalendarTools(adapters.googleCalendar)
				: {},
	"google-drive": async (_connection, adapters) =>
		adapters.googleDrive ? buildGoogleDriveTools(adapters.googleDrive) : {},
	context7: buildContext7Tools,
	figma: buildFigmaTools,
	"jira-mcp": buildJiraMcpTools,
	linear: buildLinearTools,
	notion: buildNotionTools,
	posthog: buildPostHogTools,
	"yandex-calendar": async (connection, adapters) =>
			adapters.yandexCalendar
				? buildYandexCalendarTools(
						buildYandexCalendarToolAdapter(
							adapters.yandexCalendar(connection),
						),
					)
				: {},
	"yandex-tracker": buildYandexTrackerTools,
	zoom: buildZoomMcpTools,
};

export const graneriCapabilityRegistry = Object.fromEntries(
	capabilityMetadataDefinitions.map((capability) => [
		capability.id,
		{
			...capability,
			buildTools: capabilityToolBuilders[capability.id],
		},
	]),
);

export const getGraneriCapability = (provider) =>
	graneriCapabilityRegistry[provider] ?? null;

export const buildCapabilityToolSet = async (connections, adapters = {}) => {
	const toolSets = await Promise.all(
		connections.map(async (connection) => {
			const capability = getGraneriCapability(connection.provider);

			if (!capability?.buildTools) {
				return {};
			}

			return await capability.buildTools(connection, adapters);
		}),
	);

	return Object.assign({}, ...toolSets);
};
