export type ChatAppSourceProvider =
	| "google-calendar"
	| "google-drive"
	| "jira"
	| "jira-mcp"
	| "notion"
	| "posthog"
	| "zoom"
	| "yandex-calendar"
	| "yandex-tracker";

export const CHAT_APP_SOURCE_PROVIDERS = [
	"google-calendar",
	"google-drive",
	"jira",
	"jira-mcp",
	"notion",
	"posthog",
	"zoom",
	"yandex-calendar",
	"yandex-tracker",
] as const satisfies readonly ChatAppSourceProvider[];

export const isChatAppSourceProvider = (
	value: unknown,
): value is ChatAppSourceProvider =>
	typeof value === "string" &&
	(CHAT_APP_SOURCE_PROVIDERS as readonly string[]).includes(value);

const APP_SOURCE_LABELS: Record<ChatAppSourceProvider, string> = {
	"google-calendar": "Google Calendar",
	"google-drive": "Google Drive",
	jira: "Jira",
	"jira-mcp": "Jira",
	notion: "Notion",
	posthog: "PostHog",
	zoom: "Zoom",
	"yandex-calendar": "Yandex Calendar",
	"yandex-tracker": "Yandex Tracker",
};

export const getAppSourceLabel = (provider: ChatAppSourceProvider) =>
	APP_SOURCE_LABELS[provider];
