export type ChatAppSourceProvider =
	| "google-calendar"
	| "google-drive"
	| "jira"
	| "notion"
	| "posthog"
	| "yandex-calendar"
	| "yandex-tracker";

const APP_SOURCE_LABELS: Record<ChatAppSourceProvider, string> = {
	"google-calendar": "Google Calendar",
	"google-drive": "Google Drive",
	jira: "Jira",
	notion: "Notion",
	posthog: "PostHog",
	"yandex-calendar": "Yandex Calendar",
	"yandex-tracker": "Yandex Tracker",
};

export const getAppSourceLabel = (provider: ChatAppSourceProvider) =>
	APP_SOURCE_LABELS[provider];
