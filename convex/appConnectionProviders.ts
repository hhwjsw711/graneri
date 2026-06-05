export const APP_CONNECTION_PROVIDERS = [
	"yandex-tracker",
	"yandex-calendar",
	"jira",
	"jira-mcp",
	"posthog",
	"notion",
	"zoom",
	"context7",
	"figma",
	"linear",
] as const;

export type AppConnectionProvider = (typeof APP_CONNECTION_PROVIDERS)[number];

export const MCP_OAUTH_CONNECTION_PROVIDERS = [
	"figma",
	"jira-mcp",
	"linear",
	"notion",
	"posthog",
	"zoom",
] as const;

export type McpOAuthConnectionProvider =
	(typeof MCP_OAUTH_CONNECTION_PROVIDERS)[number];

const CHAT_SOURCE_PROVIDERS = [
	"yandex-calendar",
	"yandex-tracker",
	"jira-mcp",
	"posthog",
	"notion",
	"zoom",
	"context7",
	"figma",
	"linear",
] satisfies AppConnectionProvider[];

const TOKEN_REQUIRED_CHAT_SOURCE_PROVIDERS = [
	"figma",
	"linear",
] satisfies AppConnectionProvider[];

const DEFAULT_DISPLAY_NAMES = {
	context7: "Context7",
	figma: "Figma",
	jira: "Jira",
	"jira-mcp": "Jira",
	linear: "Linear",
	notion: "Notion",
	posthog: "PostHog",
	zoom: "Zoom",
	"yandex-calendar": "Yandex Calendar",
	"yandex-tracker": "Yandex Tracker",
} satisfies Record<AppConnectionProvider, string>;

export const getDefaultAppConnectionDisplayName = (
	provider: AppConnectionProvider,
) => DEFAULT_DISPLAY_NAMES[provider];

export const getMcpAppConnectionPreviewLabel = (
	provider: AppConnectionProvider,
) => `${getDefaultAppConnectionDisplayName(provider)} MCP`;

export const isChatSourceAppConnectionProvider = (
	provider: string,
): provider is (typeof CHAT_SOURCE_PROVIDERS)[number] =>
	(CHAT_SOURCE_PROVIDERS as readonly string[]).includes(provider);

export const requiresChatSourceToken = (provider: AppConnectionProvider) =>
	(TOKEN_REQUIRED_CHAT_SOURCE_PROVIDERS as readonly string[]).includes(
		provider,
	);
