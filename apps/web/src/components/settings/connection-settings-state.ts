import type { DesktopPreferences } from "@workspace/platform/desktop-bridge";
import type {
	RemoteMcpConnectionFormState,
	RemoteMcpOAuthFields,
} from "@/lib/remote-mcp-connection-form";

export type YandexTrackerOrgType = "x-org-id" | "x-cloud-org-id";

export type YandexTrackerConnectionFormState = {
	orgType: YandexTrackerOrgType;
	orgId: string;
	token: string;
};

export type JiraConnectionFormState = {
	baseUrl: string;
	email: string;
	token: string;
};

export type RemoteMcpOAuthConnectionFormState = RemoteMcpConnectionFormState &
	RemoteMcpOAuthFields;

export type JiraMcpConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type PostHogConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type Context7ConnectionFormState = RemoteMcpConnectionFormState;
export type FigmaConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type LinearConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type NotionConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type ZoomConnectionFormState = RemoteMcpOAuthConnectionFormState;

export type RemoteMcpFormStateKey =
	| "jiraMcpFormState"
	| "context7FormState"
	| "figmaFormState"
	| "linearFormState"
	| "posthogFormState"
	| "notionFormState"
	| "zoomFormState";

export type RemoteMcpFormPatch = Partial<
	RemoteMcpConnectionFormState & RemoteMcpOAuthFields
>;

type RemoteMcpFormPatchAction = {
	type: "patchRemoteMcpFormState";
	key: RemoteMcpFormStateKey;
	value: RemoteMcpFormPatch;
};

export type YandexCalendarConnectionFormState = {
	email: string;
	password: string;
};

export type PreferencesSettingsState = {
	preferences: DesktopPreferences | null;
	isLoadingPreferences: boolean;
	savingPreference: keyof DesktopPreferences | null;
};

export type PreferencesSettingsAction =
	| {
			type: "loadSucceeded";
			value: DesktopPreferences;
	  }
	| {
			type: "finishLoading";
	  }
	| {
			type: "setSavingPreference";
			value: keyof DesktopPreferences | null;
	  }
	| {
			type: "setPreferences";
			value: DesktopPreferences | null;
	  }
	| {
			key: keyof DesktopPreferences;
			type: "setPreferenceOptimistic";
			value: boolean;
	  };

export type CalendarSettingsState = {
	isSavingCalendarPreferences: boolean;
};

export type CalendarSettingsAction = {
	type: "setIsSavingCalendarPreferences";
	value: boolean;
};

export type AppConnectionStatus = "connected" | "disconnected";

export type YandexTrackerConnectionSettings = {
	sourceId: string;
	provider: "yandex-tracker";
	status: AppConnectionStatus;
	displayName: string;
	orgType: "x-org-id" | "x-cloud-org-id";
	orgId: string;
};

export type YandexCalendarConnectionSettings = {
	sourceId: string;
	provider: "yandex-calendar";
	status: AppConnectionStatus;
	displayName: string;
	email: string;
	serverAddress: string;
	calendarHomePath: string;
};

export type JiraConnectionSettings = {
	sourceId: string;
	provider: "jira";
	status: AppConnectionStatus;
	displayName: string;
	baseUrl: string;
	email: string;
	accountId?: string;
	webhookSecret?: string;
	lastWebhookReceivedAt?: number;
	lastMentionSyncAt?: number;
};

export type JiraMcpConnectionSettings = {
	sourceId: string;
	provider: "jira-mcp";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type PostHogConnectionSettings = {
	sourceId: string;
	provider: "posthog";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type Context7ConnectionSettings = {
	sourceId: string;
	provider: "context7";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
};

export type FigmaConnectionSettings = {
	sourceId: string;
	provider: "figma";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type LinearConnectionSettings = {
	sourceId: string;
	provider: "linear";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type NotionConnectionSettings = {
	sourceId: string;
	provider: "notion";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type ZoomConnectionSettings = {
	sourceId: string;
	provider: "zoom";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type StableConnectionSettings = {
	yandexTracker: YandexTrackerConnectionSettings | null;
	yandexCalendar: YandexCalendarConnectionSettings | null;
	context7: Context7ConnectionSettings | null;
	figma: FigmaConnectionSettings | null;
	linear: LinearConnectionSettings | null;
	jira: JiraConnectionSettings | null;
	jiraMcp: JiraMcpConnectionSettings | null;
	posthog: PostHogConnectionSettings | null;
	notion: NotionConnectionSettings | null;
	zoom: ZoomConnectionSettings | null;
};

export type ConnectionQueryResults = {
	yandexTracker: YandexTrackerConnectionSettings | null | undefined;
	yandexCalendar: YandexCalendarConnectionSettings | null | undefined;
	context7: Context7ConnectionSettings | null | undefined;
	figma: FigmaConnectionSettings | null | undefined;
	linear: LinearConnectionSettings | null | undefined;
	jira: JiraConnectionSettings | null | undefined;
	jiraMcp: JiraMcpConnectionSettings | null | undefined;
	posthog: PostHogConnectionSettings | null | undefined;
	notion: NotionConnectionSettings | null | undefined;
	zoom: ZoomConnectionSettings | null | undefined;
};

export type ConnectionsSettingsState = {
	isYandexTrackerDialogOpen: boolean;
	isJiraDialogOpen: boolean;
	isJiraMcpDialogOpen: boolean;
	isContext7DialogOpen: boolean;
	isFigmaDialogOpen: boolean;
	isLinearDialogOpen: boolean;
	isPostHogDialogOpen: boolean;
	isNotionDialogOpen: boolean;
	isZoomDialogOpen: boolean;
	isSavingYandexTrackerConnection: boolean;
	isSavingJiraConnection: boolean;
	isSavingJiraMcpConnection: boolean;
	isSavingContext7Connection: boolean;
	isSavingFigmaConnection: boolean;
	isSavingLinearConnection: boolean;
	isDisablingConnection: boolean;
	isSavingPostHogConnection: boolean;
	isSavingNotionConnection: boolean;
	isSavingZoomConnection: boolean;
	yandexTrackerFormState: YandexTrackerConnectionFormState;
	jiraFormState: JiraConnectionFormState;
	jiraMcpFormState: JiraMcpConnectionFormState;
	context7FormState: Context7ConnectionFormState;
	figmaFormState: FigmaConnectionFormState;
	linearFormState: LinearConnectionFormState;
	posthogFormState: PostHogConnectionFormState;
	notionFormState: NotionConnectionFormState;
	zoomFormState: ZoomConnectionFormState;
};

export type ConnectionsSettingsAction =
	| {
			type: "setIsYandexTrackerDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsJiraDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsJiraMcpDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsContext7DialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsFigmaDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsLinearDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsPostHogDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsNotionDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsZoomDialogOpen";
			value: boolean;
	  }
	| {
			type: "setIsSavingYandexTrackerConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingJiraConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingJiraMcpConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingContext7Connection";
			value: boolean;
	  }
	| {
			type: "setIsSavingFigmaConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingLinearConnection";
			value: boolean;
	  }
	| {
			type: "setIsDisablingConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingPostHogConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingNotionConnection";
			value: boolean;
	  }
	| {
			type: "setIsSavingZoomConnection";
			value: boolean;
	  }
	| {
			type: "setYandexTrackerFormState";
			value: YandexTrackerConnectionFormState;
	  }
	| {
			type: "patchYandexTrackerFormState";
			value: Partial<YandexTrackerConnectionFormState>;
	  }
	| {
			type: "setJiraFormState";
			value: JiraConnectionFormState;
	  }
	| {
			type: "patchJiraFormState";
			value: Partial<JiraConnectionFormState>;
	  }
	| {
			type: "setJiraMcpFormState";
			value: JiraMcpConnectionFormState;
	  }
	| {
			type: "patchJiraMcpFormState";
			value: Partial<JiraMcpConnectionFormState>;
	  }
	| RemoteMcpFormPatchAction
	| {
			type: "setContext7FormState";
			value: Context7ConnectionFormState;
	  }
	| {
			type: "patchContext7FormState";
			value: Partial<Context7ConnectionFormState>;
	  }
	| {
			type: "setFigmaFormState";
			value: FigmaConnectionFormState;
	  }
	| {
			type: "patchFigmaFormState";
			value: Partial<FigmaConnectionFormState>;
	  }
	| {
			type: "setLinearFormState";
			value: LinearConnectionFormState;
	  }
	| {
			type: "patchLinearFormState";
			value: Partial<LinearConnectionFormState>;
	  }
	| {
			type: "setPostHogFormState";
			value: PostHogConnectionFormState;
	  }
	| {
			type: "patchPostHogFormState";
			value: Partial<PostHogConnectionFormState>;
	  }
	| {
			type: "setNotionFormState";
			value: NotionConnectionFormState;
	  }
	| {
			type: "patchNotionFormState";
			value: Partial<NotionConnectionFormState>;
	  }
	| {
			type: "setZoomFormState";
			value: ZoomConnectionFormState;
	  }
	| {
			type: "patchZoomFormState";
			value: Partial<ZoomConnectionFormState>;
	  };

export const initialYandexTrackerConnectionFormState: YandexTrackerConnectionFormState =
	{
		orgType: "x-org-id",
		orgId: "",
		token: "",
	};

export const initialYandexCalendarConnectionFormState: YandexCalendarConnectionFormState =
	{
		email: "",
		password: "",
	};

export const initialJiraConnectionFormState: JiraConnectionFormState = {
	baseUrl: "",
	email: "",
	token: "",
};

export const initialJiraMcpConnectionFormState: JiraMcpConnectionFormState = {
	name: "Jira",
	baseUrl: "https://mcp.atlassian.com/v1/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialPostHogConnectionFormState: PostHogConnectionFormState = {
	name: "PostHog",
	baseUrl: "https://mcp.posthog.com/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialContext7ConnectionFormState: Context7ConnectionFormState = {
	name: "Context7",
	baseUrl: "https://mcp.context7.com/mcp",
	envVars: [],
};

export const initialFigmaConnectionFormState: FigmaConnectionFormState = {
	name: "Figma",
	baseUrl: "https://mcp.figma.com/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialLinearConnectionFormState: LinearConnectionFormState = {
	name: "Linear",
	baseUrl: "https://mcp.linear.app/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialNotionConnectionFormState: NotionConnectionFormState = {
	name: "Notion",
	baseUrl: "https://mcp.notion.com/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialZoomConnectionFormState: ZoomConnectionFormState = {
	name: "Zoom",
	baseUrl: "https://mcp.zoom.us/mcp/zoom/streamable",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialCalendarSettingsState: CalendarSettingsState = {
	isSavingCalendarPreferences: false,
};

export const initialConnectionsSettingsState: ConnectionsSettingsState = {
	isYandexTrackerDialogOpen: false,
	isJiraDialogOpen: false,
	isJiraMcpDialogOpen: false,
	isContext7DialogOpen: false,
	isFigmaDialogOpen: false,
	isLinearDialogOpen: false,
	isPostHogDialogOpen: false,
	isNotionDialogOpen: false,
	isZoomDialogOpen: false,
	isSavingYandexTrackerConnection: false,
	isSavingJiraConnection: false,
	isSavingJiraMcpConnection: false,
	isSavingContext7Connection: false,
	isSavingFigmaConnection: false,
	isSavingLinearConnection: false,
	isDisablingConnection: false,
	isSavingPostHogConnection: false,
	isSavingNotionConnection: false,
	isSavingZoomConnection: false,
	yandexTrackerFormState: initialYandexTrackerConnectionFormState,
	jiraFormState: initialJiraConnectionFormState,
	jiraMcpFormState: initialJiraMcpConnectionFormState,
	context7FormState: initialContext7ConnectionFormState,
	figmaFormState: initialFigmaConnectionFormState,
	linearFormState: initialLinearConnectionFormState,
	posthogFormState: initialPostHogConnectionFormState,
	notionFormState: initialNotionConnectionFormState,
	zoomFormState: initialZoomConnectionFormState,
};

const emptyStableConnectionSettings = (): StableConnectionSettings => ({
	yandexTracker: null,
	yandexCalendar: null,
	jira: null,
	jiraMcp: null,
	context7: null,
	figma: null,
	linear: null,
	posthog: null,
	notion: null,
	zoom: null,
});

export const getStableConnectionSettingsKey = ({
	email,
	workspaceId,
}: {
	email?: string | null;
	workspaceId?: string | null;
}) => (workspaceId && email ? `${email}:${workspaceId}` : null);

export const resolveConnectionSettings = ({
	cachedSettings,
	results,
}: {
	cachedSettings?: StableConnectionSettings;
	results: ConnectionQueryResults;
}): StableConnectionSettings => {
	const cached = cachedSettings ?? emptyStableConnectionSettings();

	return {
		yandexTracker:
			results.yandexTracker === undefined
				? cached.yandexTracker
				: results.yandexTracker,
		yandexCalendar:
			results.yandexCalendar === undefined
				? cached.yandexCalendar
				: results.yandexCalendar,
		jira: results.jira === undefined ? cached.jira : results.jira,
		jiraMcp: results.jiraMcp === undefined ? cached.jiraMcp : results.jiraMcp,
		context7:
			results.context7 === undefined ? cached.context7 : results.context7,
		figma: results.figma === undefined ? cached.figma : results.figma,
		linear: results.linear === undefined ? cached.linear : results.linear,
		posthog: results.posthog === undefined ? cached.posthog : results.posthog,
		notion: results.notion === undefined ? cached.notion : results.notion,
		zoom: results.zoom === undefined ? cached.zoom : results.zoom,
	};
};

export const createStableConnectionSettingsStore = () => {
	const settingsByKey = new Map<string, StableConnectionSettings>();

	return {
		get(key: string) {
			return settingsByKey.get(key);
		},
		update(key: string, results: ConnectionQueryResults) {
			const nextSettings = resolveConnectionSettings({
				cachedSettings: settingsByKey.get(key),
				results,
			});
			settingsByKey.set(key, nextSettings);
			return nextSettings;
		},
	};
};

export const stableConnectionSettingsStore =
	createStableConnectionSettingsStore();

export const preferencesSettingsReducer = (
	state: PreferencesSettingsState,
	action: PreferencesSettingsAction,
): PreferencesSettingsState => {
	switch (action.type) {
		case "loadSucceeded":
			return {
				...state,
				preferences: action.value,
				isLoadingPreferences: false,
			};
		case "finishLoading":
			return { ...state, isLoadingPreferences: false };
		case "setSavingPreference":
			return { ...state, savingPreference: action.value };
		case "setPreferences":
			return { ...state, preferences: action.value };
		case "setPreferenceOptimistic":
			return state.preferences
				? {
						...state,
						preferences: {
							...state.preferences,
							[action.key]: action.value,
						},
					}
				: state;
	}
};

export const calendarSettingsReducer = (
	state: CalendarSettingsState,
	action: CalendarSettingsAction,
): CalendarSettingsState => {
	switch (action.type) {
		case "setIsSavingCalendarPreferences":
			return { ...state, isSavingCalendarPreferences: action.value };
	}
};

const patchRemoteMcpFormState = (
	state: ConnectionsSettingsState,
	action: RemoteMcpFormPatchAction,
): ConnectionsSettingsState => {
	switch (action.key) {
		case "jiraMcpFormState":
			return {
				...state,
				jiraMcpFormState: { ...state.jiraMcpFormState, ...action.value },
			};
		case "context7FormState":
			return {
				...state,
				context7FormState: { ...state.context7FormState, ...action.value },
			};
		case "figmaFormState":
			return {
				...state,
				figmaFormState: { ...state.figmaFormState, ...action.value },
			};
		case "linearFormState":
			return {
				...state,
				linearFormState: { ...state.linearFormState, ...action.value },
			};
		case "posthogFormState":
			return {
				...state,
				posthogFormState: { ...state.posthogFormState, ...action.value },
			};
		case "notionFormState":
			return {
				...state,
				notionFormState: { ...state.notionFormState, ...action.value },
			};
		case "zoomFormState":
			return {
				...state,
				zoomFormState: { ...state.zoomFormState, ...action.value },
			};
	}
};

export const connectionsSettingsReducer = (
	state: ConnectionsSettingsState,
	action: ConnectionsSettingsAction,
): ConnectionsSettingsState => {
	switch (action.type) {
		case "setIsYandexTrackerDialogOpen":
			return { ...state, isYandexTrackerDialogOpen: action.value };
		case "setIsJiraDialogOpen":
			return { ...state, isJiraDialogOpen: action.value };
		case "setIsJiraMcpDialogOpen":
			return { ...state, isJiraMcpDialogOpen: action.value };
		case "setIsContext7DialogOpen":
			return { ...state, isContext7DialogOpen: action.value };
		case "setIsFigmaDialogOpen":
			return { ...state, isFigmaDialogOpen: action.value };
		case "setIsLinearDialogOpen":
			return { ...state, isLinearDialogOpen: action.value };
		case "setIsPostHogDialogOpen":
			return { ...state, isPostHogDialogOpen: action.value };
		case "setIsNotionDialogOpen":
			return { ...state, isNotionDialogOpen: action.value };
		case "setIsZoomDialogOpen":
			return { ...state, isZoomDialogOpen: action.value };
		case "setIsSavingYandexTrackerConnection":
			return { ...state, isSavingYandexTrackerConnection: action.value };
		case "setIsSavingJiraConnection":
			return { ...state, isSavingJiraConnection: action.value };
		case "setIsSavingJiraMcpConnection":
			return { ...state, isSavingJiraMcpConnection: action.value };
		case "setIsSavingContext7Connection":
			return { ...state, isSavingContext7Connection: action.value };
		case "setIsSavingFigmaConnection":
			return { ...state, isSavingFigmaConnection: action.value };
		case "setIsSavingLinearConnection":
			return { ...state, isSavingLinearConnection: action.value };
		case "setIsDisablingConnection":
			return { ...state, isDisablingConnection: action.value };
		case "setIsSavingPostHogConnection":
			return { ...state, isSavingPostHogConnection: action.value };
		case "setIsSavingNotionConnection":
			return { ...state, isSavingNotionConnection: action.value };
		case "setIsSavingZoomConnection":
			return { ...state, isSavingZoomConnection: action.value };
		case "setYandexTrackerFormState":
			return { ...state, yandexTrackerFormState: action.value };
		case "patchYandexTrackerFormState":
			return {
				...state,
				yandexTrackerFormState: {
					...state.yandexTrackerFormState,
					...action.value,
				},
			};
		case "setJiraFormState":
			return { ...state, jiraFormState: action.value };
		case "patchJiraFormState":
			return {
				...state,
				jiraFormState: {
					...state.jiraFormState,
					...action.value,
				},
			};
		case "setJiraMcpFormState":
			return { ...state, jiraMcpFormState: action.value };
		case "patchJiraMcpFormState":
			return {
				...state,
				jiraMcpFormState: {
					...state.jiraMcpFormState,
					...action.value,
				},
			};
		case "patchRemoteMcpFormState":
			return patchRemoteMcpFormState(state, action);
		case "setContext7FormState":
			return { ...state, context7FormState: action.value };
		case "patchContext7FormState":
			return {
				...state,
				context7FormState: {
					...state.context7FormState,
					...action.value,
				},
			};
		case "setFigmaFormState":
			return { ...state, figmaFormState: action.value };
		case "patchFigmaFormState":
			return {
				...state,
				figmaFormState: {
					...state.figmaFormState,
					...action.value,
				},
			};
		case "setLinearFormState":
			return { ...state, linearFormState: action.value };
		case "patchLinearFormState":
			return {
				...state,
				linearFormState: {
					...state.linearFormState,
					...action.value,
				},
			};
		case "setPostHogFormState":
			return { ...state, posthogFormState: action.value };
		case "patchPostHogFormState":
			return {
				...state,
				posthogFormState: {
					...state.posthogFormState,
					...action.value,
				},
			};
		case "setNotionFormState":
			return { ...state, notionFormState: action.value };
		case "patchNotionFormState":
			return {
				...state,
				notionFormState: {
					...state.notionFormState,
					...action.value,
				},
			};
		case "setZoomFormState":
			return { ...state, zoomFormState: action.value };
		case "patchZoomFormState":
			return {
				...state,
				zoomFormState: {
					...state.zoomFormState,
					...action.value,
				},
			};
	}
};
