import { api } from "../../../convex/_generated/api.js";
import { buildCapabilityToolSet } from "./capability-registry.mjs";

const hasConnection = (connections, provider) =>
	connections.some((connection) => connection.provider === provider);

export const buildConvexWorkspaceToolSet = async ({
	connections,
	convexClient,
	workspaceId,
}) => {
	const canUseWorkspaceTools = Boolean(convexClient && workspaceId);

	return await buildCapabilityToolSet(connections, {
		...(hasConnection(connections, "google-calendar") &&
		convexClient &&
		canUseWorkspaceTools
			? {
					googleCalendar: {
						listEvents: async ({ limit, meetingsOnly }) =>
							await convexClient.action(
								api.calendar.listGoogleCalendarEventsForTool,
								{
									...(typeof limit === "number" ? { limit } : {}),
									...(typeof meetingsOnly === "boolean"
										? { meetingsOnly }
										: {}),
								},
							),
						searchEvents: async ({ query, limit, meetingsOnly }) =>
							await convexClient.action(
								api.calendar.searchGoogleCalendarEventsForTool,
								{
									query: query ?? "",
									...(typeof limit === "number" ? { limit } : {}),
									...(typeof meetingsOnly === "boolean"
										? { meetingsOnly }
										: {}),
								},
							),
					},
				}
			: {}),
		...(hasConnection(connections, "google-drive") && convexClient
			? {
					googleDrive: {
						searchFiles: async ({ query, limit }) =>
							await convexClient.action(
								api.googleTools.searchGoogleDriveFilesForTool,
								{
									query,
									...(typeof limit === "number" ? { limit } : {}),
								},
							),
						getFile: async ({ fileId }) =>
							await convexClient.action(
								api.googleTools.getGoogleDriveFileForTool,
								{
									fileId,
								},
							),
					},
				}
			: {}),
		...(hasConnection(connections, "yandex-calendar") &&
		convexClient &&
		canUseWorkspaceTools
			? {
					yandexCalendar: () => ({
						listUpcomingEvents: async () => {
							const result = await convexClient.action(
								api.calendar.listYandexCalendarEventsForTool,
								{
									workspaceId,
									limit: 25,
								},
							);

							return {
								connection: result.connection,
								events: result.events,
							};
						},
					}),
				}
			: {}),
	});
};
