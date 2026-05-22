export const appSourceProviders = [
	"google-calendar",
	"google-drive",
	"jira-mcp",
	"notion",
	"posthog",
	"yandex-calendar",
	"yandex-tracker",
	"zoom",
];

export const automationAppSourceProviders = appSourceProviders;

export const appSourceLabels = {
	"google-calendar": "Google Calendar",
	"google-drive": "Google Drive",
	"jira-mcp": "Jira",
	notion: "Notion",
	posthog: "PostHog",
	"yandex-calendar": "Yandex Calendar",
	"yandex-tracker": "Yandex Tracker",
	zoom: "Zoom",
};

const getConnectionDisplayName = (connection) =>
	connection.displayName ??
	connection.title ??
	appSourceLabels[connection.provider];

const appSourceInstructionBuilders = {
	"google-calendar": () =>
		"The selected app source for this chat is Google Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	"google-drive": () =>
		"The selected app source for this chat is Google Drive. Treat it as the preferred source for connected Google docs, spreadsheets, presentations, and file metadata. Only read-only Drive tools are available in this chat.",
	"jira-mcp": (connection) =>
		`The selected app source for this chat is Jira (${getConnectionDisplayName(connection)}). Treat it as the preferred source for project history, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Jira, use the Jira MCP tools before saying the context is unavailable.`,
	notion: (connection) =>
		`The selected app source for this chat is Notion (${getConnectionDisplayName(connection)}). Treat it as the preferred source for workspace pages, specs, meeting notes, project docs, and databases. If the user's request could plausibly be answered from Notion, use the Notion tools before saying the context is unavailable. When the user provides a Notion URL or an exact Notion page or database reference, fetch it directly.`,
	posthog: (connection) =>
		`The selected app source for this chat is PostHog (${getConnectionDisplayName(connection)}). Treat it as the preferred source for product analytics, saved insights, dashboards, feature flags, experiments, errors, event schema, surveys, and queryable product usage context. If the user's request could plausibly be answered from PostHog, use the PostHog MCP tools before saying the context is unavailable.`,
	"yandex-calendar": () =>
		"The selected app source for this chat is Yandex Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	"yandex-tracker": (connection) =>
		`The selected app source for this chat is Yandex Tracker (${getConnectionDisplayName(connection)}). Treat it as the preferred source for project history, integrations, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Tracker, search Tracker first before saying the context is unavailable.`,
};

export const buildSelectedAppSourceInstructions = (connections) =>
	connections
		.map((connection) => {
			const buildInstruction = appSourceInstructionBuilders[connection.provider];
			return buildInstruction ? buildInstruction(connection) : "";
		})
		.filter(Boolean)
		.join("\n\n");
