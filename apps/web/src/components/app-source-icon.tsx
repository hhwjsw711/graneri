import { Icons } from "@workspace/ui/components/icons";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";

const GoogleCalendarLogo = Icons.googleCalendarLogo;
const GoogleDriveLogo = Icons.googleDriveLogo;
const JiraLogo = Icons.jiraLogo;
const NotionLogo = Icons.notionLogo;
const PlaneLogo = Icons.planeLogo;
const ZoomLogo = Icons.zoomLogo;
const YandexCalendarLogo = Icons.yandexCalendarLogo;
const YandexTrackerLogo = Icons.yandexTrackerLogo;

export function AppSourceIcon({
	provider,
	className,
}: {
	provider: ChatAppSourceProvider;
	className?: string;
}) {
	switch (provider) {
		case "google-calendar":
			return <GoogleCalendarLogo className={className} />;
		case "google-drive":
			return <GoogleDriveLogo className={className} />;
		case "jira":
		case "jira-mcp":
			return <JiraLogo className={className} />;
		case "notion":
			return <NotionLogo className={className} />;
		case "posthog":
			return <PlaneLogo className={className} />;
		case "zoom":
			return <ZoomLogo className={className} />;
		case "yandex-calendar":
			return <YandexCalendarLogo className={className} />;
		case "yandex-tracker":
			return (
				<YandexTrackerLogo className={`${className ?? ""} text-blue-500`} />
			);
	}

	const exhaustiveProvider: never = provider;
	return exhaustiveProvider;
}
