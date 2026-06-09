export const APP_SOURCE_PREFIX = "app:";

const getConnectionDisplayName = (connection, capability) =>
	connection.displayName ??
	connection.title ??
	capability?.displayName ??
	connection.provider;

const withDisplayName = (connection, capability, buildInstruction) =>
	buildInstruction(getConnectionDisplayName(connection, capability));

export const capabilityMetadataDefinitions = [
	{
		id: "google-calendar",
		displayName: "Google Calendar",
		sourceInstruction: () =>
			"The selected app source for this chat is Google Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	},
	{
		id: "google-drive",
		displayName: "Google Drive",
		sourceInstruction: () =>
			"The selected app source for this chat is Google Drive. Treat it as the preferred source for connected Google docs, spreadsheets, presentations, and file metadata. Only read-only Drive tools are available in this chat.",
	},
	{
		id: "context7",
		displayName: "Context7",
		toolPrefix: "context7_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Context7 (${displayName}). Treat it as the preferred source for up-to-date library and API documentation. If the user's request needs current framework, SDK, package, or API docs, use the Context7 MCP tools before answering from memory.`,
			),
	},
	{
		id: "figma",
		displayName: "Figma",
		toolPrefix: "figma_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Figma (${displayName}). Treat it as the preferred source for design context, frames, components, variables, and design-to-code references. If the user provides a Figma URL or asks about a design, use the Figma MCP tools before answering from memory.`,
			),
	},
	{
		id: "jira-mcp",
		displayName: "Jira",
		toolPrefix: "jira_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Jira (${displayName}). Treat it as the preferred source for project history, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Jira, use the Jira MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "linear",
		displayName: "Linear",
		toolPrefix: "linear_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Linear (${displayName}). Treat it as the preferred source for issues, projects, cycles, teams, comments, assignees, and roadmap context. If the user's request could be answered from Linear, use the Linear MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "notion",
		displayName: "Notion",
		toolPrefix: "notion_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Notion (${displayName}). Treat it as the preferred source for workspace pages, specs, meeting notes, project docs, and databases. If the user's request could plausibly be answered from Notion, use the Notion tools before saying the context is unavailable. When the user provides a Notion URL or an exact Notion page or database reference, fetch it directly.`,
			),
	},
	{
		id: "posthog",
		displayName: "PostHog",
		toolPrefix: "posthog_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is PostHog (${displayName}). Treat it as the preferred source for product analytics, saved insights, dashboards, feature flags, experiments, errors, event schema, surveys, and queryable product usage context. If the user's request could plausibly be answered from PostHog, use the PostHog MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "yandex-calendar",
		displayName: "Yandex Calendar",
		sourceInstruction: () =>
			"The selected app source for this chat is Yandex Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	},
	{
		id: "yandex-tracker",
		displayName: "Yandex Tracker",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Yandex Tracker (${displayName}). Treat it as the preferred source for project history, integrations, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Tracker, search Tracker first before saying the context is unavailable.`,
			),
	},
	{
		id: "zoom",
		displayName: "Zoom",
		toolPrefix: "zoom_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Zoom (${displayName}). Treat it as the preferred source for meeting transcripts, recordings, summaries, and Zoom workspace context. If the user's request could plausibly be answered from Zoom, use the Zoom MCP tools before saying the context is unavailable.`,
			),
	},
];

export const capabilityMetadataRegistry = Object.fromEntries(
	capabilityMetadataDefinitions.map((capability) => [capability.id, capability]),
);

export const appSourceProviders = capabilityMetadataDefinitions.map(
	(capability) => capability.id,
);

export const automationAppSourceProviders = appSourceProviders;

export const appSourceLabels = Object.fromEntries(
	capabilityMetadataDefinitions.map((capability) => [
		capability.id,
		capability.displayName,
	]),
);

export const remoteMcpToolPrefixes = capabilityMetadataDefinitions
	.filter((capability) => capability.toolPrefix)
	.map((capability) => ({
		prefix: capability.toolPrefix,
		provider: capability.id,
		label: capability.displayName,
	}));

export const getCapabilityMetadata = (provider) =>
	capabilityMetadataRegistry[provider] ?? null;

export const getSelectedAppSourceIds = (selectedSourceIds) =>
	(selectedSourceIds ?? []).filter((value) =>
		value.startsWith(APP_SOURCE_PREFIX),
	);

export const getSelectedNoteSourceIds = ({ mentions }) =>
	Array.from(new Set(mentions ?? [])).filter(Boolean);

export const buildSelectedAppSourceInstructions = (connections) =>
	connections
		.map((connection) => {
			const capability = getCapabilityMetadata(connection.provider);
			return capability?.sourceInstruction
				? capability.sourceInstruction(connection, capability)
				: "";
		})
		.filter(Boolean)
		.join("\n\n");
