export const appSourceProviders = [
	"google-calendar",
	"google-drive",
	"context7",
	"figma",
	"jira-mcp",
	"linear",
	"notion",
	"posthog",
	"yandex-calendar",
	"yandex-tracker",
	"zoom",
];

export const automationAppSourceProviders = appSourceProviders;
export const APP_SOURCE_PREFIX = "app:";

export const appSourceLabels = {
	"google-calendar": "Google Calendar",
	"google-drive": "Google Drive",
	context7: "Context7",
	figma: "Figma",
	"jira-mcp": "Jira",
	linear: "Linear",
	notion: "Notion",
	posthog: "PostHog",
	"yandex-calendar": "Yandex Calendar",
	"yandex-tracker": "Yandex Tracker",
	zoom: "Zoom",
};

export const remoteMcpToolPrefixes = [
	{ prefix: "context7_", provider: "context7", label: "Context7" },
	{ prefix: "figma_", provider: "figma", label: "Figma" },
	{ prefix: "jira_", provider: "jira-mcp", label: "Jira" },
	{ prefix: "linear_", provider: "linear", label: "Linear" },
	{ prefix: "notion_", provider: "notion", label: "Notion" },
	{ prefix: "posthog_", provider: "posthog", label: "PostHog" },
	{ prefix: "zoom_", provider: "zoom", label: "Zoom" },
];

export const getSelectedAppSourceIds = (selectedSourceIds) =>
	(selectedSourceIds ?? []).filter((value) =>
		value.startsWith(APP_SOURCE_PREFIX),
	);

export const getSelectedNoteSourceIds = ({ mentions }) =>
	Array.from(new Set(mentions ?? [])).filter(Boolean);

const getConnectionDisplayName = (connection) =>
	connection.displayName ??
	connection.title ??
	appSourceLabels[connection.provider];

const appSourceInstructionBuilders = {
	"google-calendar": () =>
		"The selected app source for this chat is Google Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	"google-drive": () =>
		"The selected app source for this chat is Google Drive. Treat it as the preferred source for connected Google docs, spreadsheets, presentations, and file metadata. Only read-only Drive tools are available in this chat.",
	context7: (connection) =>
		`The selected app source for this chat is Context7 (${getConnectionDisplayName(connection)}). Treat it as the preferred source for up-to-date library and API documentation. If the user's request needs current framework, SDK, package, or API docs, use the Context7 MCP tools before answering from memory.`,
	figma: (connection) =>
		`The selected app source for this chat is Figma (${getConnectionDisplayName(connection)}). Treat it as the preferred source for design context, frames, components, variables, and design-to-code references. If the user provides a Figma URL or asks about a design, use the Figma MCP tools before answering from memory.`,
	"jira-mcp": (connection) =>
		`The selected app source for this chat is Jira (${getConnectionDisplayName(connection)}). Treat it as the preferred source for project history, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Jira, use the Jira MCP tools before saying the context is unavailable.`,
	linear: (connection) =>
		`The selected app source for this chat is Linear (${getConnectionDisplayName(connection)}). Treat it as the preferred source for issues, projects, cycles, teams, comments, assignees, and roadmap context. If the user's request could be answered from Linear, use the Linear MCP tools before saying the context is unavailable.`,
	notion: (connection) =>
		`The selected app source for this chat is Notion (${getConnectionDisplayName(connection)}). Treat it as the preferred source for workspace pages, specs, meeting notes, project docs, and databases. If the user's request could plausibly be answered from Notion, use the Notion tools before saying the context is unavailable. When the user provides a Notion URL or an exact Notion page or database reference, fetch it directly.`,
	posthog: (connection) =>
		`The selected app source for this chat is PostHog (${getConnectionDisplayName(connection)}). Treat it as the preferred source for product analytics, saved insights, dashboards, feature flags, experiments, errors, event schema, surveys, and queryable product usage context. If the user's request could plausibly be answered from PostHog, use the PostHog MCP tools before saying the context is unavailable.`,
	"yandex-calendar": () =>
		"The selected app source for this chat is Yandex Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	"yandex-tracker": (connection) =>
		`The selected app source for this chat is Yandex Tracker (${getConnectionDisplayName(connection)}). Treat it as the preferred source for project history, integrations, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Tracker, search Tracker first before saying the context is unavailable.`,
	zoom: (connection) =>
		`The selected app source for this chat is Zoom (${getConnectionDisplayName(connection)}). Treat it as the preferred source for meeting transcripts, recordings, summaries, and Zoom workspace context. If the user's request could plausibly be answered from Zoom, use the Zoom MCP tools before saying the context is unavailable.`,
};

export const buildSelectedAppSourceInstructions = (connections) =>
	connections
		.map((connection) => {
			const buildInstruction = appSourceInstructionBuilders[connection.provider];
			return buildInstruction ? buildInstruction(connection) : "";
		})
		.filter(Boolean)
		.join("\n\n");
