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

export const getSelectedScopeLabel = ({
	appSources,
	projectSources = [],
	selectedSourceIds,
}: {
	appSources: Array<{
		id: string;
		provider: ChatAppSourceProvider;
	}>;
	projectSources?: Array<{
		id: string;
		title: string;
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

	const projectSource = projectSources.find(
		(source) => source.id === selectedSourceId,
	);

	return projectSource?.title ?? "1 source";
};
