export type ChatAppSourceProvider =
	| "google-calendar"
	| "google-drive"
	| "jira"
	| "notion"
	| "posthog"
	| "yandex-calendar"
	| "yandex-tracker";

export const CHAT_APP_SOURCE_PROVIDERS = [
	"google-calendar",
	"google-drive",
	"jira",
	"notion",
	"posthog",
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
	notion: "Notion",
	posthog: "PostHog",
	"yandex-calendar": "Yandex Calendar",
	"yandex-tracker": "Yandex Tracker",
};

export const getAppSourceLabel = (provider: ChatAppSourceProvider) =>
	APP_SOURCE_LABELS[provider];

export const getSelectedScopeLabel = ({
	appSources,
	selectedSourceIds,
}: {
	appSources: Array<{
		id: string;
		provider: ChatAppSourceProvider;
	}>;
	selectedSourceIds: string[];
}) => {
	if (selectedSourceIds.length === 0) {
		return "All sources";
	}

	if (selectedSourceIds.length > 1) {
		return `${selectedSourceIds.length} sources`;
	}

	const [selectedSourceId] = selectedSourceIds;
	const appSource = appSources.find((source) => source.id === selectedSourceId);
	if (appSource) {
		return getAppSourceLabel(appSource.provider);
	}

	return "1 source";
};
