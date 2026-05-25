import {
	getDesktopAuthCallbackUrl,
	getDesktopPreferences,
	isDesktopRuntime,
	openDesktopExternalUrl,
	setDesktopLaunchAtLogin,
} from "@workspace/platform/desktop";
import type { DesktopPreferences } from "@workspace/platform/desktop-bridge";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@workspace/ui/components/input-group";
import { Label } from "@workspace/ui/components/label";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@workspace/ui/components/select";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { Switch } from "@workspace/ui/components/switch";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	Bell,
	CalendarDays,
	Check,
	ChevronDown,
	Copy,
	Database,
	FolderKanban,
	ImageUp,
	LoaderCircle,
	Paintbrush,
	Plus,
	SlidersHorizontal,
	UserRound,
	Workflow,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { AppSourceIcon } from "@/components/app-source-icon";
import { writeTextToClipboard } from "@/components/note/share-note";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { SettingsSwitchRow } from "@/components/settings/settings-switch-row";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { authClient } from "@/lib/auth-client";
import { getAvatarSrc } from "@/lib/avatar";
import {
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_SCOPES,
	GOOGLE_DRIVE_SCOPE,
	GOOGLE_DRIVE_SCOPES,
	getGoogleLinkedAccount,
	hasGoogleScope,
} from "@/lib/google-integrations";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import {
	mergeUserPreferencesForOptimisticUpdate,
	type UserPreferencesState,
} from "@/lib/user-preferences";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type {
	SettingsDialogProps,
	SettingsPage,
	SettingsUser,
} from "./settings-types";

type SettingsEnvVar = {
	key: string;
	value: string;
};

const getNonEmptyEnvRecord = (
	envVars: SettingsEnvVar[],
	options: { requireValue: boolean },
) => {
	const entries: Array<[string, string]> = [];
	for (const envVar of envVars) {
		const key = envVar.key.trim();
		const value = envVar.value;
		if (key.length === 0 || (options.requireValue && value.length === 0)) {
			continue;
		}
		entries.push([key, value]);
	}
	return Object.fromEntries(entries);
};

function useResetStateWhenValueChanges<T>(
	value: T,
	resetState: (value: T) => void,
) {
	useEffect(() => {
		resetState(value);
	}, [resetState, value]);
}

const settingsNav = [
	{ name: "Profile", icon: UserRound },
	{ name: "Appearance", icon: Paintbrush },
	{ name: "Preferences", icon: SlidersHorizontal },
	{ name: "Notifications", icon: Bell },
	{ name: "Workspace", icon: FolderKanban },
	{ name: "Calendar", icon: CalendarDays },
	{ name: "Connections", icon: Workflow },
	{ name: "Data controls", icon: Database },
] as const;

const getSettingsNav = (isDesktopApp: boolean) =>
	isDesktopApp
		? settingsNav
		: settingsNav.filter((item) => item.name !== "Preferences");

const SETTINGS_LABEL_CLASSNAME = "text-xs text-muted-foreground";
const SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME =
	"group w-full justify-between px-0 text-sm font-medium text-foreground hover:!bg-transparent hover:text-foreground active:!bg-transparent aria-expanded:!bg-transparent aria-expanded:hover:!bg-transparent focus-visible:!bg-transparent";
const MAX_PROFILE_AVATAR_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const withoutTrailingPeriod = (message: string) =>
	message.trimEnd().replace(/\.+$/u, "");

const getConvexErrorDataMessage = (error: unknown) => {
	if (!(error instanceof Error)) {
		return "";
	}

	const match = error.message.match(/Uncaught ConvexError:\s*(\{.*?\})\s+at/su);
	if (!match?.[1]) {
		return "";
	}

	try {
		const data = JSON.parse(match[1]) as unknown;
		return data &&
			typeof data === "object" &&
			"message" in data &&
			typeof data.message === "string"
			? data.message
			: "";
	} catch {
		return "";
	}
};

const getConnectionErrorMessage = (error: unknown, fallback: string) => {
	const convexMessage = getConvexErrorDataMessage(error);
	if (convexMessage) {
		return withoutTrailingPeriod(convexMessage);
	}

	return error instanceof Error
		? withoutTrailingPeriod(error.message)
		: fallback;
};

const createOAuthNavigationTarget = () =>
	isDesktopRuntime() ? null : window.open("about:blank", "_blank");

const navigateToOAuthUrl = async (
	authorizationUrl: string,
	target: Window | null,
) => {
	if (target) {
		target.opener = null;
		target.location.href = authorizationUrl;
		return;
	}

	if (await openDesktopExternalUrl(authorizationUrl)) {
		return;
	}

	const oauthWindow = window.open(authorizationUrl, "_blank");
	if (oauthWindow) {
		oauthWindow.opener = null;
		return;
	}

	window.location.assign(authorizationUrl);
};

type WorkspaceFormState = {
	name: string;
	iconStorageId: Id<"_storage"> | null;
	iconPreviewUrl: string | null;
};

type ProfileFormState = {
	name: string;
	jobTitle: string;
	companyName: string;
	avatarStorageId: Id<"_storage"> | null;
	avatarPreviewUrl: string | null;
};

type DataControlsState = {
	showDeleteAccountDialog: boolean;
	isDeletingAccount: boolean;
	showDeleteAllNotesDialog: boolean;
	isDeletingAllNotes: boolean;
	showDeleteAllChatsDialog: boolean;
	isDeletingAllChats: boolean;
};

type YandexTrackerOrgType = "x-org-id" | "x-cloud-org-id";

type YandexTrackerConnectionFormState = {
	orgType: YandexTrackerOrgType;
	orgId: string;
	token: string;
};

type JiraConnectionFormState = {
	baseUrl: string;
	email: string;
	token: string;
};

type JiraMcpConnectionFormState = {
	name: string;
	baseUrl: string;
	envVars: Array<{ id: string; key: string; value: string }>;
	oauthClientId: string;
	oauthClientSecret: string;
};

type PostHogConnectionFormState = {
	name: string;
	baseUrl: string;
	envVars: Array<{ id: string; key: string; value: string }>;
	oauthClientId: string;
	oauthClientSecret: string;
};

type NotionConnectionFormState = {
	name: string;
	baseUrl: string;
	envVars: Array<{ id: string; key: string; value: string }>;
	oauthClientId: string;
	oauthClientSecret: string;
};

type ZoomConnectionFormState = {
	name: string;
	baseUrl: string;
	envVars: Array<{ id: string; key: string; value: string }>;
	oauthClientId: string;
	oauthClientSecret: string;
};

type YandexCalendarConnectionFormState = {
	email: string;
	password: string;
};

type PreferencesSettingsState = {
	preferences: DesktopPreferences | null;
	isLoadingPreferences: boolean;
	isSavingLaunchAtLogin: boolean;
};

type PreferencesSettingsAction =
	| {
			type: "loadSucceeded";
			value: DesktopPreferences;
	  }
	| {
			type: "finishLoading";
	  }
	| {
			type: "setIsSavingLaunchAtLogin";
			value: boolean;
	  }
	| {
			type: "setPreferences";
			value: DesktopPreferences | null;
	  }
	| {
			type: "setLaunchAtLoginOptimistic";
			value: boolean;
	  };

type CalendarSettingsState = {
	isSavingCalendarPreferences: boolean;
};

type CalendarSettingsAction = {
	type: "setIsSavingCalendarPreferences";
	value: boolean;
};

type CalendarVisibilityPreferences = {
	showGoogleCalendar: boolean;
	showGoogleDrive: boolean;
	showYandexCalendar: boolean;
};

type VisibleCalendarRowProps = {
	id: string;
	icon: React.ReactNode;
	name: string;
	checked: boolean;
	disabled: boolean;
	onCheckedChange: (checked: boolean) => void;
};

type ToolConnectionRowProps = {
	icon: React.ReactNode;
	name: string;
	buttonLabel: string;
	buttonVariant?: "default" | "outline";
	buttonDisabled?: boolean;
	buttonIcon?: React.ReactNode;
	onButtonClick: () => void;
};

type AppConnectionStatus = "connected" | "disconnected";

type YandexTrackerConnectionSettings = {
	sourceId: string;
	provider: "yandex-tracker";
	status: AppConnectionStatus;
	displayName: string;
	orgType: "x-org-id" | "x-cloud-org-id";
	orgId: string;
};

type YandexCalendarConnectionSettings = {
	sourceId: string;
	provider: "yandex-calendar";
	status: AppConnectionStatus;
	displayName: string;
	email: string;
	serverAddress: string;
	calendarHomePath: string;
};

type JiraConnectionSettings = {
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

type JiraMcpConnectionSettings = {
	sourceId: string;
	provider: "jira-mcp";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type PostHogConnectionSettings = {
	sourceId: string;
	provider: "posthog";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type NotionConnectionSettings = {
	sourceId: string;
	provider: "notion";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type ZoomConnectionSettings = {
	sourceId: string;
	provider: "zoom";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type StableConnectionSettings = {
	yandexTracker: YandexTrackerConnectionSettings | null;
	yandexCalendar: YandexCalendarConnectionSettings | null;
	jira: JiraConnectionSettings | null;
	jiraMcp: JiraMcpConnectionSettings | null;
	posthog: PostHogConnectionSettings | null;
	notion: NotionConnectionSettings | null;
	zoom: ZoomConnectionSettings | null;
};

const stableConnectionSettingsByWorkspace = new Map<
	string,
	StableConnectionSettings
>();

type ConnectionsSettingsState = {
	isYandexTrackerDialogOpen: boolean;
	isJiraDialogOpen: boolean;
	isJiraMcpDialogOpen: boolean;
	isPostHogDialogOpen: boolean;
	isNotionDialogOpen: boolean;
	isZoomDialogOpen: boolean;
	isSavingYandexTrackerConnection: boolean;
	isSavingJiraConnection: boolean;
	isSavingJiraMcpConnection: boolean;
	isDisablingConnection: boolean;
	isSavingPostHogConnection: boolean;
	isSavingNotionConnection: boolean;
	isSavingZoomConnection: boolean;
	yandexTrackerFormState: YandexTrackerConnectionFormState;
	jiraFormState: JiraConnectionFormState;
	jiraMcpFormState: JiraMcpConnectionFormState;
	posthogFormState: PostHogConnectionFormState;
	notionFormState: NotionConnectionFormState;
	zoomFormState: ZoomConnectionFormState;
};

type ConnectionsSettingsAction =
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

const getWorkspaceFormState = (
	workspace: WorkspaceRecord | null,
): WorkspaceFormState => ({
	name: workspace?.name ?? "",
	iconStorageId: workspace?.iconStorageId ?? null,
	iconPreviewUrl: null,
});

const getProfileFormState = ({
	user,
	userPreferences,
}: {
	user: SettingsUser;
	userPreferences: UserPreferencesState | null | undefined;
}): ProfileFormState => ({
	name: user.name,
	jobTitle: userPreferences?.jobTitle ?? "",
	companyName: userPreferences?.companyName ?? "",
	avatarStorageId: userPreferences?.avatarStorageId ?? null,
	avatarPreviewUrl: null,
});

const initialDataControlsState: DataControlsState = {
	showDeleteAccountDialog: false,
	isDeletingAccount: false,
	showDeleteAllNotesDialog: false,
	isDeletingAllNotes: false,
	showDeleteAllChatsDialog: false,
	isDeletingAllChats: false,
};

const initialYandexTrackerConnectionFormState: YandexTrackerConnectionFormState =
	{
		orgType: "x-org-id",
		orgId: "",
		token: "",
	};

const initialYandexCalendarConnectionFormState: YandexCalendarConnectionFormState =
	{
		email: "",
		password: "",
	};

const initialJiraConnectionFormState: JiraConnectionFormState = {
	baseUrl: "",
	email: "",
	token: "",
};

const initialJiraMcpConnectionFormState: JiraMcpConnectionFormState = {
	name: "Jira",
	baseUrl: "https://mcp.atlassian.com/v1/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

const initialPostHogConnectionFormState: PostHogConnectionFormState = {
	name: "PostHog",
	baseUrl: "https://mcp.posthog.com/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

const initialNotionConnectionFormState: NotionConnectionFormState = {
	name: "Notion",
	baseUrl: "https://mcp.notion.com/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

const initialZoomConnectionFormState: ZoomConnectionFormState = {
	name: "Zoom",
	baseUrl: "https://mcp.zoom.us/mcp/zoom/streamable",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

const getInitialPreferencesSettingsState = (): PreferencesSettingsState => ({
	preferences: null,
	isLoadingPreferences: isDesktopRuntime(),
	isSavingLaunchAtLogin: false,
});

const initialCalendarSettingsState: CalendarSettingsState = {
	isSavingCalendarPreferences: false,
};

const initialConnectionsSettingsState: ConnectionsSettingsState = {
	isYandexTrackerDialogOpen: false,
	isJiraDialogOpen: false,
	isJiraMcpDialogOpen: false,
	isPostHogDialogOpen: false,
	isNotionDialogOpen: false,
	isZoomDialogOpen: false,
	isSavingYandexTrackerConnection: false,
	isSavingJiraConnection: false,
	isSavingJiraMcpConnection: false,
	isDisablingConnection: false,
	isSavingPostHogConnection: false,
	isSavingNotionConnection: false,
	isSavingZoomConnection: false,
	yandexTrackerFormState: initialYandexTrackerConnectionFormState,
	jiraFormState: initialJiraConnectionFormState,
	jiraMcpFormState: initialJiraMcpConnectionFormState,
	posthogFormState: initialPostHogConnectionFormState,
	notionFormState: initialNotionConnectionFormState,
	zoomFormState: initialZoomConnectionFormState,
};

const preferencesSettingsReducer = (
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
		case "setIsSavingLaunchAtLogin":
			return { ...state, isSavingLaunchAtLogin: action.value };
		case "setPreferences":
			return { ...state, preferences: action.value };
		case "setLaunchAtLoginOptimistic":
			return state.preferences
				? {
						...state,
						preferences: {
							...state.preferences,
							launchAtLogin: action.value,
						},
					}
				: state;
	}
};

const calendarSettingsReducer = (
	state: CalendarSettingsState,
	action: CalendarSettingsAction,
): CalendarSettingsState => {
	switch (action.type) {
		case "setIsSavingCalendarPreferences":
			return { ...state, isSavingCalendarPreferences: action.value };
	}
};

const connectionsSettingsReducer = (
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

export function SettingsDialog({
	open,
	onOpenChange,
	user,
	workspace,
	initialPage = "Profile",
	onPageChange,
}: SettingsDialogProps) {
	const [selectedPage, setSelectedPage] = useReducer(
		(_current: SettingsPage | null, next: SettingsPage | null) => next,
		null,
	);
	const { data: session } = authClient.useSession();
	const isDesktopApp = isDesktopRuntime();
	const activePage = selectedPage ?? initialPage;
	const navItems = getSettingsNav(isDesktopApp);

	const handlePageSelect = (page: SettingsPage) => {
		setSelectedPage(page);
		onPageChange?.(page);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				setSelectedPage(null);
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<DialogHeader className="sr-only">
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Manage your OpenGran settings.</DialogDescription>
				</DialogHeader>
				<DialogDescription className="sr-only">
					Manage your OpenGran settings.
				</DialogDescription>
				<SidebarProvider className="items-start">
					<Sidebar collapsible="none" className="hidden md:flex">
						<SidebarContent>
							<SidebarGroup>
								<SidebarGroupContent>
									<SidebarMenu>
										{navItems.map((item) => (
											<SidebarMenuItem key={item.name}>
												<SidebarMenuButton
													asChild
													isActive={activePage === item.name}
												>
													<button
														type="button"
														onClick={() => handlePageSelect(item.name)}
													>
														<item.icon />
														<span>{item.name}</span>
													</button>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</SidebarContent>
					</Sidebar>
					<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
						<header className="flex min-h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
							<div className="flex items-center gap-2 px-4">
								<Breadcrumb className="hidden md:block">
									<BreadcrumbList>
										<BreadcrumbItem className="hidden md:block">
											<BreadcrumbLink href="#">Settings</BreadcrumbLink>
										</BreadcrumbItem>
										<BreadcrumbSeparator className="hidden md:block" />
										<BreadcrumbItem>
											<BreadcrumbPage>{activePage}</BreadcrumbPage>
										</BreadcrumbItem>
									</BreadcrumbList>
								</Breadcrumb>
								<ScrollArea
									className="md:hidden"
									scrollbarOrientation="horizontal"
									viewportClassName="w-full"
								>
									<div className="flex w-max gap-2 py-2">
										{navItems.map((item) => (
											<Button
												key={item.name}
												variant={
													activePage === item.name ? "secondary" : "ghost"
												}
												size="sm"
												onClick={() => handlePageSelect(item.name)}
											>
												<item.icon />
												{item.name}
											</Button>
										))}
									</div>
								</ScrollArea>
							</div>
						</header>
						<ScrollArea
							className="flex flex-1"
							viewportClassName="flex flex-col gap-4 p-4 pt-0"
						>
							{activePage === "Profile" ? (
								<ManageAccountForm
									user={user}
									onCancel={() => onOpenChange(false)}
									onSave={() => onOpenChange(false)}
								/>
							) : activePage === "Appearance" ? (
								<AppearanceSettings />
							) : activePage === "Preferences" ? (
								<PreferencesSettings />
							) : activePage === "Notifications" ? (
								<NotificationsSettings />
							) : activePage === "Workspace" ? (
								<WorkspaceSettings
									workspace={workspace}
									onCancel={() => onOpenChange(false)}
									onSave={() => onOpenChange(false)}
								/>
							) : activePage === "Calendar" ? (
								<CalendarSettings />
							) : activePage === "Connections" ? (
								<ConnectionsSettings />
							) : activePage === "Data controls" ? (
								<DataControlsSettings
									canDeleteData={Boolean(session?.user)}
									onClose={() => onOpenChange(false)}
								/>
							) : null}
						</ScrollArea>
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}

function NotificationsSettings() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const notificationPreferences = useQuery(
		api.notificationPreferences.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const updateNotificationPreferences = useMutation(
		api.notificationPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		localStore.setQuery(
			api.notificationPreferences.get,
			{ workspaceId: args.workspaceId },
			{
				notifyForScheduledMeetings: args.notifyForScheduledMeetings,
				notifyForAutoDetectedMeetings: args.notifyForAutoDetectedMeetings,
			},
		);
	});
	const [isSavingNotificationPreference, setIsSavingNotificationPreference] =
		useState(false);

	const handleNotificationPreferenceChange = async (preferences: {
		notifyForScheduledMeetings: boolean;
		notifyForAutoDetectedMeetings: boolean;
	}) => {
		if (!activeWorkspaceId) {
			return;
		}

		setIsSavingNotificationPreference(true);

		try {
			await updateNotificationPreferences({
				workspaceId: activeWorkspaceId,
				...preferences,
			});
		} catch (error) {
			console.error("Failed to update notification preferences", error);
			toast.error("Failed to update notification preferences");
		} finally {
			setIsSavingNotificationPreference(false);
		}
	};

	if (!activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific notification settings.
			</div>
		);
	}

	return (
		<div className="py-4">
			<FieldGroup className="gap-4">
				<SettingsSwitchRow
					id="settings-scheduled-meetings"
					label="Scheduled meetings"
					checked={notificationPreferences?.notifyForScheduledMeetings ?? false}
					disabled={isSavingNotificationPreference}
					onCheckedChange={(checked) => {
						void handleNotificationPreferenceChange({
							notifyForScheduledMeetings: checked,
							notifyForAutoDetectedMeetings:
								notificationPreferences?.notifyForAutoDetectedMeetings ?? true,
						});
					}}
				/>
				<SettingsSwitchRow
					id="settings-auto-detected-meetings"
					label="Auto-detected meetings"
					checked={
						notificationPreferences?.notifyForAutoDetectedMeetings ?? true
					}
					disabled={isSavingNotificationPreference}
					onCheckedChange={(checked) => {
						void handleNotificationPreferenceChange({
							notifyForScheduledMeetings:
								notificationPreferences?.notifyForScheduledMeetings ?? false,
							notifyForAutoDetectedMeetings: checked,
						});
					}}
				/>
			</FieldGroup>
		</div>
	);
}

function PreferencesSettings() {
	const [state, dispatch] = useReducer(
		preferencesSettingsReducer,
		getInitialPreferencesSettingsState(),
	);
	const { preferences, isLoadingPreferences, isSavingLaunchAtLogin } = state;

	useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		let isCancelled = false;

		const loadPreferences = async () => {
			try {
				const nextPreferences = await getDesktopPreferences();
				if (!isCancelled) {
					if (nextPreferences) {
						dispatch({ type: "loadSucceeded", value: nextPreferences });
					} else {
						dispatch({ type: "finishLoading" });
					}
				}
			} catch (error) {
				console.error("Failed to load desktop preferences", error);
				if (!isCancelled) {
					dispatch({ type: "finishLoading" });
					toast.error("Failed to load desktop preferences");
				}
			}
		};

		void loadPreferences();

		return () => {
			isCancelled = true;
		};
	}, []);

	const handleLaunchAtLoginChange = async (checked: boolean) => {
		if (!isDesktopRuntime()) {
			return;
		}

		const previousPreferences = preferences;
		dispatch({ type: "setIsSavingLaunchAtLogin", value: true });
		dispatch({ type: "setLaunchAtLoginOptimistic", value: checked });

		try {
			const nextPreferences = await setDesktopLaunchAtLogin(checked);
			if (!nextPreferences) {
				throw new Error("Desktop preferences are unavailable.");
			}
			dispatch({ type: "setPreferences", value: nextPreferences });
		} catch (error) {
			console.error("Failed to update launch at login preference", error);
			dispatch({ type: "setPreferences", value: previousPreferences });
			toast.error("Failed to update launch at login preference");
		} finally {
			dispatch({ type: "setIsSavingLaunchAtLogin", value: false });
		}
	};

	if (!isDesktopRuntime()) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Preferences are available in the desktop app.
			</div>
		);
	}

	if (isLoadingPreferences && !preferences) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Loading desktop preferences…
			</div>
		);
	}

	return (
		<div className="py-4">
			<FieldGroup className="gap-4">
				<SettingsSwitchRow
					id="settings-launch-at-login"
					label="Launch at login"
					checked={preferences?.launchAtLogin ?? false}
					disabled={
						isLoadingPreferences ||
						isSavingLaunchAtLogin ||
						!(preferences?.canLaunchAtLogin ?? false)
					}
					onCheckedChange={(checked) => {
						void handleLaunchAtLoginChange(checked);
					}}
				/>
			</FieldGroup>
		</div>
	);
}

function CalendarSettings() {
	const { activeWorkspaceId, visibleCalendars } =
		useCalendarSettingsController();

	if (!activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific calendar settings.
			</div>
		);
	}

	return (
		<div className="py-4">
			<VisibleCalendarsSection calendars={visibleCalendars} />
		</div>
	);
}

function useCalendarSettingsController() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const { data: session } = authClient.useSession();
	const calendarPreferences = useQuery(
		api.calendarPreferences.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const updateCalendarPreferences = useMutation(
		api.calendarPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		localStore.setQuery(
			api.calendarPreferences.get,
			{ workspaceId: args.workspaceId },
			{
				showGoogleCalendar: args.showGoogleCalendar,
				showGoogleDrive: args.showGoogleDrive,
				showYandexCalendar: args.showYandexCalendar,
			},
		);
	});
	const yandexCalendarConnection = useQuery(
		api.appConnections.getYandexCalendar,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const [state, dispatch] = useReducer(
		calendarSettingsReducer,
		initialCalendarSettingsState,
	);
	const { accounts, isLoadingAccounts } = useLinkedAccounts(session?.user);
	const { isSavingCalendarPreferences } = state;

	const calendarVisibility: CalendarVisibilityPreferences = {
		showGoogleCalendar: calendarPreferences?.showGoogleCalendar ?? false,
		showGoogleDrive: calendarPreferences?.showGoogleDrive ?? false,
		showYandexCalendar: calendarPreferences?.showYandexCalendar ?? false,
	};
	const googleAccount = getGoogleLinkedAccount(accounts);
	const hasCalendarScope = hasGoogleScope(googleAccount, GOOGLE_CALENDAR_SCOPE);
	const isGoogleCalendarConnected = Boolean(googleAccount && hasCalendarScope);
	const isYandexCalendarConnected = Boolean(yandexCalendarConnection);

	const handleCalendarVisibilityChange = async (
		nextPreferences: CalendarVisibilityPreferences,
	) => {
		if (!activeWorkspaceId) {
			return;
		}

		dispatch({ type: "setIsSavingCalendarPreferences", value: true });

		try {
			await updateCalendarPreferences({
				workspaceId: activeWorkspaceId,
				...nextPreferences,
			});
		} catch (error) {
			console.error("Failed to update calendar preferences", error);
			toast.error("Failed to update calendar visibility");
		} finally {
			dispatch({ type: "setIsSavingCalendarPreferences", value: false });
		}
	};

	const visibleCalendars: VisibleCalendarRowProps[] = [
		{
			id: "visible-google-calendar",
			icon: (
				<AppSourceIcon provider="google-calendar" className="size-5 shrink-0" />
			),
			name: "Google Calendar",
			checked:
				isGoogleCalendarConnected && calendarVisibility.showGoogleCalendar,
			disabled:
				isSavingCalendarPreferences ||
				isLoadingAccounts ||
				!isGoogleCalendarConnected,
			onCheckedChange: (checked) => {
				void handleCalendarVisibilityChange({
					showGoogleCalendar: checked,
					showGoogleDrive: calendarVisibility.showGoogleDrive,
					showYandexCalendar: calendarVisibility.showYandexCalendar,
				});
			},
		},
		{
			id: "visible-yandex-calendar",
			icon: (
				<AppSourceIcon provider="yandex-calendar" className="size-5 shrink-0" />
			),
			name: "Yandex Calendar",
			checked:
				isYandexCalendarConnected && calendarVisibility.showYandexCalendar,
			disabled: isSavingCalendarPreferences || !isYandexCalendarConnected,
			onCheckedChange: (checked) => {
				void handleCalendarVisibilityChange({
					showGoogleCalendar: calendarVisibility.showGoogleCalendar,
					showGoogleDrive: calendarVisibility.showGoogleDrive,
					showYandexCalendar: checked,
				});
			},
		},
	];

	return {
		activeWorkspaceId,
		visibleCalendars,
	};
}

const getGoogleToolAction = ({ hasScope }: { hasScope: boolean }) => ({
	buttonLabel: hasScope ? "Manage" : "Connect",
	buttonVariant: "outline" as const,
});

function VisibleCalendarsSection({
	calendars,
}: {
	calendars: VisibleCalendarRowProps[];
}) {
	return (
		<FieldGroup className="gap-6">
			<Field>
				<Label className={SETTINGS_LABEL_CLASSNAME}>Display</Label>
				<div className="space-y-4">
					{calendars.map((calendar) => (
						<CalendarVisibilityRow key={calendar.id} {...calendar} />
					))}
				</div>
			</Field>
		</FieldGroup>
	);
}

function CalendarVisibilityRow({
	id,
	icon,
	name,
	checked,
	disabled,
	onCheckedChange,
}: VisibleCalendarRowProps) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-center gap-3">
				{icon}
				<Label
					htmlFor={id}
					className="min-w-0 text-sm font-medium text-foreground"
				>
					{name}
				</Label>
			</div>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}

function YandexCalendarDialog({
	open,
	onOpenChange,
	formState,
	onEmailChange,
	onPasswordChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: YandexCalendarConnectionFormState;
	onEmailChange: (email: string) => void;
	onPasswordChange: (password: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Yandex Calendar</DialogTitle>
					<DialogDescription>
						Enter the Yandex account OpenGran should use to load your upcoming
						meetings.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label
							htmlFor="yandex-calendar-email"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Email
						</Label>
						<Input
							id="yandex-calendar-email"
							type="email"
							value={formState.email}
							onChange={(event) => onEmailChange(event.target.value)}
							placeholder="name@yandex.ru"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="yandex-calendar-password"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							App password
						</Label>
						<Input
							id="yandex-calendar-password"
							type="password"
							value={formState.password}
							onChange={(event) => onPasswordChange(event.target.value)}
							placeholder="Paste your Yandex app password"
						/>
					</Field>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

function useYandexCalendarConnectionDialog({
	activeWorkspaceId,
	defaultEmail,
	onConnected,
	yandexCalendarConnection,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	defaultEmail?: string | null;
	onConnected?: () => void | Promise<void>;
	yandexCalendarConnection?: { email?: string | null } | null;
}) {
	const connectYandexCalendar = useAction(
		api.appConnectionActions.connectYandexCalendar,
	);
	const [isYandexCalendarDialogOpen, setIsYandexCalendarDialogOpen] =
		useState(false);
	const [
		isSavingYandexCalendarConnection,
		setIsSavingYandexCalendarConnection,
	] = useState(false);
	const [yandexCalendarFormState, setYandexCalendarFormState] = useState(
		initialYandexCalendarConnectionFormState,
	);

	const handleYandexCalendarDialogOpenChange = (open: boolean) => {
		setIsYandexCalendarDialogOpen(open);

		if (open) {
			setYandexCalendarFormState({
				email: yandexCalendarConnection?.email ?? defaultEmail ?? "",
				password: "",
			});
			return;
		}

		setYandexCalendarFormState(initialYandexCalendarConnectionFormState);
	};

	const handleConnectYandexCalendar = async () => {
		if (
			!activeWorkspaceId ||
			!yandexCalendarFormState.email.trim() ||
			!yandexCalendarFormState.password.trim()
		) {
			return;
		}

		setIsSavingYandexCalendarConnection(true);

		try {
			await connectYandexCalendar({
				workspaceId: activeWorkspaceId,
				email: yandexCalendarFormState.email.trim(),
				password: yandexCalendarFormState.password.trim(),
			});
			await onConnected?.();
			toast.success("Yandex Calendar connected");
			handleYandexCalendarDialogOpenChange(false);
		} catch (error) {
			console.error("Failed to connect Yandex Calendar", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to connect Yandex Calendar",
			);
		} finally {
			setIsSavingYandexCalendarConnection(false);
		}
	};

	const isYandexCalendarFormValid =
		yandexCalendarFormState.email.trim().length > 0 &&
		yandexCalendarFormState.password.trim().length > 0;

	return {
		handleConnectYandexCalendar,
		handleYandexCalendarDialogOpenChange,
		isSavingYandexCalendarConnection,
		isYandexCalendarDialogOpen,
		isYandexCalendarFormValid,
		setYandexCalendarEmail: (email: string) =>
			setYandexCalendarFormState((currentState) => ({
				...currentState,
				email,
			})),
		setYandexCalendarPassword: (password: string) =>
			setYandexCalendarFormState((currentState) => ({
				...currentState,
				password,
			})),
		yandexCalendarFormState,
	};
}

function ConnectionsSettings() {
	const {
		activeWorkspaceId,
		handleConnectYandexCalendar,
		handleConnectJira,
		handleConnectJiraMcp,
		handleConnectNotion,
		handleConnectPostHog,
		handleCopyJiraWebhookUrl,
		handleConnectZoom,
		handleConnectYandexTracker,
		handleJiraDialogOpenChange,
		handleJiraMcpDialogOpenChange,
		handleDisableJiraMcp,
		handleDisableJiraSync,
		handleDisableNotion,
		handleDisablePostHog,
		handleDisableYandexCalendar,
		handleDisableYandexTracker,
		handleDisableZoom,
		handleNotionDialogOpenChange,
		handlePostHogDialogOpenChange,
		handleYandexCalendarDialogOpenChange,
		handleYandexTrackerDialogOpenChange,
		handleZoomDialogOpenChange,
		isJiraDialogOpen,
		isJiraFormValid,
		isJiraMcpDialogOpen,
		isJiraMcpFormValid,
		isDisablingConnection,
		isNotionDialogOpen,
		isNotionFormValid,
		isPostHogDialogOpen,
		isPostHogFormValid,
		isZoomDialogOpen,
		isZoomFormValid,
		isSavingYandexCalendarConnection,
		isYandexCalendarDialogOpen,
		isYandexCalendarFormValid,
		isSavingJiraConnection,
		isSavingJiraMcpConnection,
		isSavingNotionConnection,
		isSavingPostHogConnection,
		isSavingYandexTrackerConnection,
		isSavingZoomConnection,
		isYandexTrackerDialogOpen,
		isYandexTrackerFormValid,
		jiraConnection,
		jiraFormState,
		jiraMcpConnection,
		jiraMcpFormState,
		jiraWebhookUrl,
		notionConnection,
		notionFormState,
		posthogConnection,
		posthogFormState,
		yandexCalendarConnection,
		yandexTrackerConnection,
		zoomConnection,
		setJiraBaseUrl,
		setJiraEmail,
		setJiraMcpBaseUrl,
		setJiraMcpName,
		setJiraMcpOAuthClientId,
		setJiraMcpOAuthClientSecret,
		setJiraToken,
		setNotionBaseUrl,
		setNotionName,
		setNotionOAuthClientId,
		setNotionOAuthClientSecret,
		setPostHogName,
		setPostHogBaseUrl,
		setPostHogOAuthClientId,
		setPostHogOAuthClientSecret,
		setZoomBaseUrl,
		setZoomName,
		setZoomOAuthClientId,
		setZoomOAuthClientSecret,
		addNotionEnvVar,
		addPostHogEnvVar,
		addJiraMcpEnvVar,
		addZoomEnvVar,
		removeNotionEnvVar,
		removePostHogEnvVar,
		removeJiraMcpEnvVar,
		removeZoomEnvVar,
		updateNotionEnvVar,
		updatePostHogEnvVar,
		updateJiraMcpEnvVar,
		updateZoomEnvVar,
		setYandexCalendarEmail,
		setYandexCalendarPassword,
		setYandexTrackerOrgId,
		setYandexTrackerOrgType,
		setYandexTrackerToken,
		toolConnections,
		yandexCalendarFormState,
		yandexTrackerFormState,
		zoomFormState,
	} = useConnectionsSettingsController();

	if (!activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific tool connections.
			</div>
		);
	}

	return (
		<div className="py-4">
			<ToolConnectionsSection connections={toolConnections} />
			<YandexCalendarDialog
				open={isYandexCalendarDialogOpen}
				onOpenChange={handleYandexCalendarDialogOpenChange}
				formState={yandexCalendarFormState}
				onEmailChange={setYandexCalendarEmail}
				onPasswordChange={setYandexCalendarPassword}
				onConnect={() => {
					void handleConnectYandexCalendar();
				}}
				onDisable={
					yandexCalendarConnection ? handleDisableYandexCalendar : undefined
				}
				isFormValid={isYandexCalendarFormValid}
				isSaving={isSavingYandexCalendarConnection}
				isDisabling={isDisablingConnection}
			/>
			<YandexTrackerDialog
				open={isYandexTrackerDialogOpen}
				onOpenChange={handleYandexTrackerDialogOpenChange}
				formState={yandexTrackerFormState}
				onOrgTypeChange={setYandexTrackerOrgType}
				onOrgIdChange={setYandexTrackerOrgId}
				onTokenChange={setYandexTrackerToken}
				onConnect={() => {
					void handleConnectYandexTracker();
				}}
				onDisable={
					yandexTrackerConnection ? handleDisableYandexTracker : undefined
				}
				isFormValid={isYandexTrackerFormValid}
				isSaving={isSavingYandexTrackerConnection}
				isDisabling={isDisablingConnection}
			/>
			<JiraDialog
				open={isJiraDialogOpen}
				onOpenChange={handleJiraDialogOpenChange}
				formState={jiraFormState}
				onBaseUrlChange={setJiraBaseUrl}
				onEmailChange={setJiraEmail}
				onTokenChange={setJiraToken}
				onConnect={() => {
					void handleConnectJira();
				}}
				isFormValid={isJiraFormValid}
				isSaving={isSavingJiraConnection}
				isDisabling={isDisablingConnection}
				onDisable={jiraConnection ? handleDisableJiraSync : undefined}
				onCopyWebhookUrl={() => {
					void handleCopyJiraWebhookUrl();
				}}
				showSyncSettings={Boolean(jiraConnection)}
				webhookUrl={jiraWebhookUrl}
			/>
			<JiraMcpDialog
				open={isJiraMcpDialogOpen}
				onOpenChange={handleJiraMcpDialogOpenChange}
				formState={jiraMcpFormState}
				onNameChange={setJiraMcpName}
				onBaseUrlChange={setJiraMcpBaseUrl}
				onAddEnvVar={addJiraMcpEnvVar}
				onRemoveEnvVar={removeJiraMcpEnvVar}
				onUpdateEnvVar={updateJiraMcpEnvVar}
				onOAuthClientIdChange={setJiraMcpOAuthClientId}
				onOAuthClientSecretChange={setJiraMcpOAuthClientSecret}
				onConnect={() => {
					void handleConnectJiraMcp();
				}}
				isFormValid={isJiraMcpFormValid}
				isSaving={isSavingJiraMcpConnection}
				isDisabling={isDisablingConnection}
				onDisable={jiraMcpConnection ? handleDisableJiraMcp : undefined}
			/>
			<PostHogDialog
				open={isPostHogDialogOpen}
				onOpenChange={handlePostHogDialogOpenChange}
				formState={posthogFormState}
				onNameChange={setPostHogName}
				onBaseUrlChange={setPostHogBaseUrl}
				onAddEnvVar={addPostHogEnvVar}
				onRemoveEnvVar={removePostHogEnvVar}
				onUpdateEnvVar={updatePostHogEnvVar}
				onOAuthClientIdChange={setPostHogOAuthClientId}
				onOAuthClientSecretChange={setPostHogOAuthClientSecret}
				onConnect={() => {
					void handleConnectPostHog();
				}}
				onDisable={posthogConnection ? handleDisablePostHog : undefined}
				isFormValid={isPostHogFormValid}
				isSaving={isSavingPostHogConnection}
				isDisabling={isDisablingConnection}
			/>
			<NotionDialog
				open={isNotionDialogOpen}
				onOpenChange={handleNotionDialogOpenChange}
				formState={notionFormState}
				onNameChange={setNotionName}
				onBaseUrlChange={setNotionBaseUrl}
				onAddEnvVar={addNotionEnvVar}
				onRemoveEnvVar={removeNotionEnvVar}
				onUpdateEnvVar={updateNotionEnvVar}
				onOAuthClientIdChange={setNotionOAuthClientId}
				onOAuthClientSecretChange={setNotionOAuthClientSecret}
				onConnect={() => {
					void handleConnectNotion();
				}}
				onDisable={notionConnection ? handleDisableNotion : undefined}
				isFormValid={isNotionFormValid}
				isSaving={isSavingNotionConnection}
				isDisabling={isDisablingConnection}
			/>
			<ZoomDialog
				open={isZoomDialogOpen}
				onOpenChange={handleZoomDialogOpenChange}
				formState={zoomFormState}
				onNameChange={setZoomName}
				onBaseUrlChange={setZoomBaseUrl}
				onAddEnvVar={addZoomEnvVar}
				onRemoveEnvVar={removeZoomEnvVar}
				onUpdateEnvVar={updateZoomEnvVar}
				onOAuthClientIdChange={setZoomOAuthClientId}
				onOAuthClientSecretChange={setZoomOAuthClientSecret}
				onConnect={() => {
					void handleConnectZoom();
				}}
				onDisable={zoomConnection ? handleDisableZoom : undefined}
				isFormValid={isZoomFormValid}
				isSaving={isSavingZoomConnection}
				isDisabling={isDisablingConnection}
			/>
		</div>
	);
}

function useConnectionsSettingsController() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const { data: session } = authClient.useSession();
	const { accounts, loadAccounts } = useLinkedAccounts(session?.user);
	const stableConnectionSettingsKey =
		activeWorkspaceId && session?.user?.email
			? `${session.user.email}:${activeWorkspaceId}`
			: null;
	const yandexTrackerConnectionResult = useQuery(
		api.appConnections.getYandexTracker,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const yandexCalendarConnectionResult = useQuery(
		api.appConnections.getYandexCalendar,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const calendarPreferences = useQuery(
		api.calendarPreferences.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const updateCalendarPreferences = useMutation(api.calendarPreferences.update);
	const jiraConnectionResult = useQuery(
		api.appConnections.getJira,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const jiraMcpConnectionResult = useQuery(
		api.appConnections.getJiraMcp,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const posthogConnectionResult = useQuery(
		api.appConnections.getPostHog,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const notionConnectionResult = useQuery(
		api.appConnections.getNotion,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const zoomConnectionResult = useQuery(
		api.appConnections.getZoom,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const stableConnectionSettings = stableConnectionSettingsKey
		? stableConnectionSettingsByWorkspace.get(stableConnectionSettingsKey)
		: undefined;
	const yandexTrackerConnection =
		yandexTrackerConnectionResult === undefined
			? (stableConnectionSettings?.yandexTracker ?? null)
			: yandexTrackerConnectionResult;
	const yandexCalendarConnection =
		yandexCalendarConnectionResult === undefined
			? (stableConnectionSettings?.yandexCalendar ?? null)
			: yandexCalendarConnectionResult;
	const jiraConnection =
		jiraConnectionResult === undefined
			? (stableConnectionSettings?.jira ?? null)
			: jiraConnectionResult;
	const jiraMcpConnection =
		jiraMcpConnectionResult === undefined
			? (stableConnectionSettings?.jiraMcp ?? null)
			: jiraMcpConnectionResult;
	const posthogConnection =
		posthogConnectionResult === undefined
			? (stableConnectionSettings?.posthog ?? null)
			: posthogConnectionResult;
	const notionConnection =
		notionConnectionResult === undefined
			? (stableConnectionSettings?.notion ?? null)
			: notionConnectionResult;
	const zoomConnection =
		zoomConnectionResult === undefined
			? (stableConnectionSettings?.zoom ?? null)
			: zoomConnectionResult;
	const connectYandexTracker = useAction(
		api.appConnectionActions.connectYandexTracker,
	);
	const connectJira = useAction(api.appConnectionActions.connectJira);
	const connectJiraMcp = useAction(api.appConnectionActions.connectJiraMcp);
	const connectPostHog = useAction(api.appConnectionActions.connectPostHog);
	const connectNotion = useAction(api.appConnectionActions.connectNotion);
	const connectZoom = useAction(api.appConnectionActions.connectZoom);
	const disableConnection = useMutation(api.appConnections.disableConnection);
	const prepareJiraMentionSync = useAction(
		api.appConnectionActions.prepareJiraMentionSync,
	);
	const [state, dispatch] = useReducer(
		connectionsSettingsReducer,
		initialConnectionsSettingsState,
	);
	const [convexSiteUrl, setConvexSiteUrl] = useState<string | null>(null);
	const [isConnectingGoogleCalendarTool, setIsConnectingGoogleCalendarTool] =
		useState(false);
	const [isConnectingGoogleDriveTool, setIsConnectingGoogleDriveTool] =
		useState(false);
	const [isPreparingJiraMentionSync, setIsPreparingJiraMentionSync] =
		useState(false);
	const lastPreparedJiraSyncKeyRef = useRef<string | null>(null);
	const {
		isYandexTrackerDialogOpen,
		isJiraDialogOpen,
		isJiraMcpDialogOpen,
		isPostHogDialogOpen,
		isNotionDialogOpen,
		isZoomDialogOpen,
		isSavingYandexTrackerConnection,
		isSavingJiraConnection,
		isSavingJiraMcpConnection,
		isDisablingConnection,
		isSavingPostHogConnection,
		isSavingNotionConnection,
		isSavingZoomConnection,
		yandexTrackerFormState,
		jiraFormState,
		jiraMcpFormState,
		posthogFormState,
		notionFormState,
		zoomFormState,
	} = state;
	const googleAccount = getGoogleLinkedAccount(accounts);
	const hasGoogleCalendarToolScope = hasGoogleScope(
		googleAccount,
		GOOGLE_CALENDAR_SCOPE,
	);
	const hasGoogleDriveToolScope = hasGoogleScope(
		googleAccount,
		GOOGLE_DRIVE_SCOPE,
	);
	const googleCalendarEnabledForWorkspace =
		calendarPreferences?.showGoogleCalendar ?? false;
	const googleDriveEnabledForWorkspace =
		calendarPreferences?.showGoogleDrive ?? false;
	const yandexCalendarDialog = useYandexCalendarConnectionDialog({
		activeWorkspaceId,
		defaultEmail: session?.user?.email,
		yandexCalendarConnection,
	});

	useEffect(() => {
		if (!stableConnectionSettingsKey) {
			return;
		}

		const previous = stableConnectionSettingsByWorkspace.get(
			stableConnectionSettingsKey,
		) ?? {
			yandexTracker: null,
			yandexCalendar: null,
			jira: null,
			jiraMcp: null,
			posthog: null,
			notion: null,
			zoom: null,
		};

		stableConnectionSettingsByWorkspace.set(stableConnectionSettingsKey, {
			yandexTracker:
				yandexTrackerConnectionResult === undefined
					? previous.yandexTracker
					: yandexTrackerConnectionResult,
			yandexCalendar:
				yandexCalendarConnectionResult === undefined
					? previous.yandexCalendar
					: yandexCalendarConnectionResult,
			jira:
				jiraConnectionResult === undefined
					? previous.jira
					: jiraConnectionResult,
			jiraMcp:
				jiraMcpConnectionResult === undefined
					? previous.jiraMcp
					: jiraMcpConnectionResult,
			posthog:
				posthogConnectionResult === undefined
					? previous.posthog
					: posthogConnectionResult,
			notion:
				notionConnectionResult === undefined
					? previous.notion
					: notionConnectionResult,
			zoom:
				zoomConnectionResult === undefined
					? previous.zoom
					: zoomConnectionResult,
		});
	}, [
		jiraConnectionResult,
		jiraMcpConnectionResult,
		notionConnectionResult,
		posthogConnectionResult,
		stableConnectionSettingsKey,
		yandexCalendarConnectionResult,
		yandexTrackerConnectionResult,
		zoomConnectionResult,
	]);

	useEffect(() => {
		let isMounted = true;

		void loadRuntimeConfig()
			.then((config) => {
				if (isMounted) {
					setConvexSiteUrl(config.convexSiteUrl);
				}
			})
			.catch(() => {});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		if (!activeWorkspaceId || !jiraConnection) {
			lastPreparedJiraSyncKeyRef.current = null;
			return;
		}

		if (jiraConnection.webhookSecret && jiraConnection.accountId) {
			return;
		}

		const syncKey = `${activeWorkspaceId}:${jiraConnection.sourceId}`;

		if (lastPreparedJiraSyncKeyRef.current === syncKey) {
			return;
		}

		lastPreparedJiraSyncKeyRef.current = syncKey;
		setIsPreparingJiraMentionSync(true);

		void prepareJiraMentionSync({ workspaceId: activeWorkspaceId })
			.catch((error) => {
				lastPreparedJiraSyncKeyRef.current = null;
				toast.error(
					error instanceof Error
						? withoutTrailingPeriod(error.message)
						: "Failed to prepare Jira mention sync",
				);
			})
			.finally(() => {
				setIsPreparingJiraMentionSync(false);
			});
	}, [activeWorkspaceId, prepareJiraMentionSync, jiraConnection]);

	const handleYandexTrackerDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsYandexTrackerDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setYandexTrackerFormState",
				value: {
					orgType: yandexTrackerConnection?.orgType ?? "x-org-id",
					orgId: yandexTrackerConnection?.orgId ?? "",
					token: "",
				},
			});
		} else {
			dispatch({
				type: "setYandexTrackerFormState",
				value: initialYandexTrackerConnectionFormState,
			});
		}
	};

	const handleConnectYandexTracker = async () => {
		if (
			!activeWorkspaceId ||
			!yandexTrackerFormState.orgId.trim() ||
			!yandexTrackerFormState.token.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingYandexTrackerConnection", value: true });

		try {
			await connectYandexTracker({
				workspaceId: activeWorkspaceId,
				orgType: yandexTrackerFormState.orgType,
				orgId: yandexTrackerFormState.orgId.trim(),
				token: yandexTrackerFormState.token.trim(),
			});
			toast.success("Yandex Tracker connected");
			handleYandexTrackerDialogOpenChange(false);
		} catch (error) {
			console.error("Failed to connect Yandex Tracker", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to connect Yandex Tracker",
			);
		} finally {
			dispatch({ type: "setIsSavingYandexTrackerConnection", value: false });
		}
	};

	const isYandexTrackerFormValid =
		yandexTrackerFormState.orgId.trim().length > 0 &&
		yandexTrackerFormState.token.trim().length > 0;

	const handleJiraDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsJiraDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setJiraFormState",
				value: {
					baseUrl: jiraConnection?.baseUrl ?? "",
					email: jiraConnection?.email ?? session?.user?.email ?? "",
					token: "",
				},
			});
		} else {
			dispatch({
				type: "setJiraFormState",
				value: initialJiraConnectionFormState,
			});
		}
	};

	const handleConnectJira = async () => {
		if (
			!activeWorkspaceId ||
			!jiraFormState.baseUrl.trim() ||
			!jiraFormState.email.trim() ||
			!jiraFormState.token.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingJiraConnection", value: true });

		try {
			await connectJira({
				workspaceId: activeWorkspaceId,
				baseUrl: jiraFormState.baseUrl.trim(),
				email: jiraFormState.email.trim(),
				token: jiraFormState.token.trim(),
			});
			toast.success("Jira sync connected");
			handleJiraDialogOpenChange(false);
		} catch (error) {
			console.error("Failed to connect Jira", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to connect Jira",
			);
		} finally {
			dispatch({ type: "setIsSavingJiraConnection", value: false });
		}
	};

	const isJiraFormValid =
		jiraFormState.baseUrl.trim().length > 0 &&
		jiraFormState.email.trim().length > 0 &&
		jiraFormState.token.trim().length > 0;

	const handleJiraMcpDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsJiraMcpDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setJiraMcpFormState",
				value: {
					name: jiraMcpConnection?.displayName ?? "Jira",
					baseUrl:
						jiraMcpConnection?.endpoint ??
						initialJiraMcpConnectionFormState.baseUrl,
					envVars: [],
					oauthClientId: jiraMcpConnection?.oauthClientId ?? "",
					oauthClientSecret: "",
				},
			});
		} else {
			dispatch({
				type: "setJiraMcpFormState",
				value: initialJiraMcpConnectionFormState,
			});
		}
	};

	const handleConnectJiraMcp = async () => {
		if (
			!activeWorkspaceId ||
			!jiraMcpFormState.name.trim() ||
			!jiraMcpFormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingJiraMcpConnection", value: true });
		const oauthWindow = createOAuthNavigationTarget();

		try {
			const result = await connectJiraMcp({
				workspaceId: activeWorkspaceId,
				displayName: jiraMcpFormState.name.trim(),
				baseUrl: jiraMcpFormState.baseUrl.trim(),
				env: getNonEmptyEnvRecord(jiraMcpFormState.envVars, {
					requireValue: true,
				}),
				...(jiraMcpFormState.oauthClientId.trim()
					? { oauthClientId: jiraMcpFormState.oauthClientId.trim() }
					: {}),
				...(jiraMcpFormState.oauthClientSecret.trim()
					? { oauthClientSecret: jiraMcpFormState.oauthClientSecret.trim() }
					: {}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Jira to finish connecting");
			handleJiraMcpDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			console.error("Failed to connect Jira", error);
			toast.error(getConnectionErrorMessage(error, "Failed to connect Jira"));
		} finally {
			dispatch({ type: "setIsSavingJiraMcpConnection", value: false });
		}
	};

	const isJiraMcpFormValid =
		jiraMcpFormState.name.trim().length > 0 &&
		jiraMcpFormState.baseUrl.trim().length > 0;

	const disableAppConnection = async ({
		sourceId,
		successMessage,
		onDisabled,
	}: {
		sourceId: string;
		successMessage: string;
		onDisabled: () => void;
	}) => {
		if (!activeWorkspaceId || isDisablingConnection) {
			return;
		}

		dispatch({ type: "setIsDisablingConnection", value: true });

		try {
			await disableConnection({
				workspaceId: activeWorkspaceId,
				sourceId,
			});
			toast.success(successMessage);
			onDisabled();
		} catch (error) {
			console.error("Failed to disable connection", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to disable connection",
			);
		} finally {
			dispatch({ type: "setIsDisablingConnection", value: false });
		}
	};

	const handleDisableJiraSync = async () => {
		if (!jiraConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: jiraConnection.sourceId,
			successMessage: "Jira sync disabled",
			onDisabled: () => handleJiraDialogOpenChange(false),
		});
	};

	const handleDisableJiraMcp = async () => {
		if (!jiraMcpConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: jiraMcpConnection.sourceId,
			successMessage: "Jira disabled",
			onDisabled: () => handleJiraMcpDialogOpenChange(false),
		});
	};

	const handleDisableYandexCalendar = async () => {
		if (!yandexCalendarConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: yandexCalendarConnection.sourceId,
			successMessage: "Yandex Calendar disabled",
			onDisabled: () =>
				yandexCalendarDialog.handleYandexCalendarDialogOpenChange(false),
		});
	};

	const handleDisableYandexTracker = async () => {
		if (!yandexTrackerConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: yandexTrackerConnection.sourceId,
			successMessage: "Yandex Tracker disabled",
			onDisabled: () => handleYandexTrackerDialogOpenChange(false),
		});
	};

	const handleDisablePostHog = async () => {
		if (!posthogConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: posthogConnection.sourceId,
			successMessage: "PostHog disabled",
			onDisabled: () => handlePostHogDialogOpenChange(false),
		});
	};

	const handleDisableNotion = async () => {
		if (!notionConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: notionConnection.sourceId,
			successMessage: "Notion disabled",
			onDisabled: () => handleNotionDialogOpenChange(false),
		});
	};

	const handleDisableZoom = async () => {
		if (!zoomConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: zoomConnection.sourceId,
			successMessage: "Zoom disabled",
			onDisabled: () => handleZoomDialogOpenChange(false),
		});
	};

	const addJiraMcpEnvVar = () =>
		dispatch({
			type: "patchJiraMcpFormState",
			value: {
				envVars: [
					...jiraMcpFormState.envVars,
					{ id: crypto.randomUUID(), key: "", value: "" },
				],
			},
		});

	const removeJiraMcpEnvVar = (id: string) =>
		dispatch({
			type: "patchJiraMcpFormState",
			value: {
				envVars: jiraMcpFormState.envVars.filter((envVar) => envVar.id !== id),
			},
		});

	const updateJiraMcpEnvVar = (
		id: string,
		key: "key" | "value",
		value: string,
	) =>
		dispatch({
			type: "patchJiraMcpFormState",
			value: {
				envVars: jiraMcpFormState.envVars.map((envVar) =>
					envVar.id === id ? { ...envVar, [key]: value } : envVar,
				),
			},
		});

	const setJiraMcpOAuthClientId = (oauthClientId: string) =>
		dispatch({
			type: "patchJiraMcpFormState",
			value: { oauthClientId },
		});

	const setJiraMcpOAuthClientSecret = (oauthClientSecret: string) =>
		dispatch({
			type: "patchJiraMcpFormState",
			value: { oauthClientSecret },
		});

	const handlePostHogDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsPostHogDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setPostHogFormState",
				value: {
					name: posthogConnection?.displayName ?? "PostHog",
					baseUrl:
						posthogConnection?.endpoint ??
						initialPostHogConnectionFormState.baseUrl,
					envVars: [],
					oauthClientId: posthogConnection?.oauthClientId ?? "",
					oauthClientSecret: "",
				},
			});
		} else {
			dispatch({
				type: "setPostHogFormState",
				value: initialPostHogConnectionFormState,
			});
		}
	};

	const handleConnectPostHog = async () => {
		if (
			!activeWorkspaceId ||
			!posthogFormState.name.trim() ||
			!posthogFormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingPostHogConnection", value: true });
		const oauthWindow = createOAuthNavigationTarget();

		try {
			const result = await connectPostHog({
				workspaceId: activeWorkspaceId,
				displayName: posthogFormState.name.trim(),
				baseUrl: posthogFormState.baseUrl.trim(),
				env: getNonEmptyEnvRecord(posthogFormState.envVars, {
					requireValue: true,
				}),
				...(posthogFormState.oauthClientId.trim()
					? { oauthClientId: posthogFormState.oauthClientId.trim() }
					: {}),
				...(posthogFormState.oauthClientSecret.trim()
					? { oauthClientSecret: posthogFormState.oauthClientSecret.trim() }
					: {}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in PostHog to finish connecting");
			handlePostHogDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			console.error("Failed to connect PostHog", error);
			toast.error(
				getConnectionErrorMessage(error, "Failed to connect PostHog"),
			);
		} finally {
			dispatch({ type: "setIsSavingPostHogConnection", value: false });
		}
	};

	const isPostHogFormValid =
		posthogFormState.name.trim().length > 0 &&
		posthogFormState.baseUrl.trim().length > 0;

	const addPostHogEnvVar = () =>
		dispatch({
			type: "patchPostHogFormState",
			value: {
				envVars: [
					...posthogFormState.envVars,
					{ id: crypto.randomUUID(), key: "", value: "" },
				],
			},
		});

	const removePostHogEnvVar = (id: string) =>
		dispatch({
			type: "patchPostHogFormState",
			value: {
				envVars: posthogFormState.envVars.filter((envVar) => envVar.id !== id),
			},
		});

	const updatePostHogEnvVar = (
		id: string,
		key: "key" | "value",
		value: string,
	) =>
		dispatch({
			type: "patchPostHogFormState",
			value: {
				envVars: posthogFormState.envVars.map((envVar) =>
					envVar.id === id ? { ...envVar, [key]: value } : envVar,
				),
			},
		});

	const setPostHogOAuthClientId = (oauthClientId: string) =>
		dispatch({
			type: "patchPostHogFormState",
			value: { oauthClientId },
		});

	const setPostHogOAuthClientSecret = (oauthClientSecret: string) =>
		dispatch({
			type: "patchPostHogFormState",
			value: { oauthClientSecret },
		});

	const handleNotionDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsNotionDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setNotionFormState",
				value: {
					name: notionConnection?.displayName ?? "Notion",
					baseUrl:
						notionConnection?.endpoint ??
						initialNotionConnectionFormState.baseUrl,
					envVars: [],
					oauthClientId: notionConnection?.oauthClientId ?? "",
					oauthClientSecret: "",
				},
			});
		} else {
			dispatch({
				type: "setNotionFormState",
				value: initialNotionConnectionFormState,
			});
		}
	};

	const handleConnectNotion = async () => {
		if (
			!activeWorkspaceId ||
			!notionFormState.name.trim() ||
			!notionFormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingNotionConnection", value: true });
		const oauthWindow = createOAuthNavigationTarget();

		try {
			const result = await connectNotion({
				workspaceId: activeWorkspaceId,
				displayName: notionFormState.name.trim(),
				baseUrl: notionFormState.baseUrl.trim(),
				env: getNonEmptyEnvRecord(notionFormState.envVars, {
					requireValue: false,
				}),
				...(notionFormState.oauthClientId.trim()
					? { oauthClientId: notionFormState.oauthClientId.trim() }
					: {}),
				...(notionFormState.oauthClientSecret.trim()
					? { oauthClientSecret: notionFormState.oauthClientSecret.trim() }
					: {}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Notion to finish connecting");
			handleNotionDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			console.error("Failed to connect Notion", error);
			toast.error(getConnectionErrorMessage(error, "Failed to connect Notion"));
		} finally {
			dispatch({ type: "setIsSavingNotionConnection", value: false });
		}
	};

	const isNotionFormValid =
		notionFormState.name.trim().length > 0 &&
		notionFormState.baseUrl.trim().length > 0;

	const addNotionEnvVar = () =>
		dispatch({
			type: "patchNotionFormState",
			value: {
				envVars: [
					...notionFormState.envVars,
					{ id: crypto.randomUUID(), key: "", value: "" },
				],
			},
		});

	const removeNotionEnvVar = (id: string) =>
		dispatch({
			type: "patchNotionFormState",
			value: {
				envVars: notionFormState.envVars.filter((envVar) => envVar.id !== id),
			},
		});

	const updateNotionEnvVar = (
		id: string,
		key: "key" | "value",
		value: string,
	) =>
		dispatch({
			type: "patchNotionFormState",
			value: {
				envVars: notionFormState.envVars.map((envVar) =>
					envVar.id === id ? { ...envVar, [key]: value } : envVar,
				),
			},
		});

	const setNotionOAuthClientId = (oauthClientId: string) =>
		dispatch({
			type: "patchNotionFormState",
			value: { oauthClientId },
		});

	const setNotionOAuthClientSecret = (oauthClientSecret: string) =>
		dispatch({
			type: "patchNotionFormState",
			value: { oauthClientSecret },
		});

	const handleZoomDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsZoomDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setZoomFormState",
				value: {
					name: zoomConnection?.displayName ?? "Zoom",
					baseUrl:
						zoomConnection?.endpoint ?? initialZoomConnectionFormState.baseUrl,
					envVars: [],
					oauthClientId: zoomConnection?.oauthClientId ?? "",
					oauthClientSecret: "",
				},
			});
		} else {
			dispatch({
				type: "setZoomFormState",
				value: initialZoomConnectionFormState,
			});
		}
	};

	const handleConnectZoom = async () => {
		if (
			!activeWorkspaceId ||
			!zoomFormState.name.trim() ||
			!zoomFormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingZoomConnection", value: true });
		const oauthWindow = createOAuthNavigationTarget();

		try {
			const result = await connectZoom({
				workspaceId: activeWorkspaceId,
				displayName: zoomFormState.name.trim(),
				baseUrl: zoomFormState.baseUrl.trim(),
				env: getNonEmptyEnvRecord(zoomFormState.envVars, {
					requireValue: false,
				}),
				...(zoomFormState.oauthClientId.trim()
					? { oauthClientId: zoomFormState.oauthClientId.trim() }
					: {}),
				...(zoomFormState.oauthClientSecret.trim()
					? { oauthClientSecret: zoomFormState.oauthClientSecret.trim() }
					: {}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Zoom to finish connecting");
			handleZoomDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			console.error("Failed to connect Zoom", error);
			toast.error(getConnectionErrorMessage(error, "Failed to connect Zoom"));
		} finally {
			dispatch({ type: "setIsSavingZoomConnection", value: false });
		}
	};

	const isZoomFormValid =
		zoomFormState.name.trim().length > 0 &&
		zoomFormState.baseUrl.trim().length > 0;

	const addZoomEnvVar = () =>
		dispatch({
			type: "patchZoomFormState",
			value: {
				envVars: [
					...zoomFormState.envVars,
					{ id: crypto.randomUUID(), key: "", value: "" },
				],
			},
		});

	const removeZoomEnvVar = (id: string) =>
		dispatch({
			type: "patchZoomFormState",
			value: {
				envVars: zoomFormState.envVars.filter((envVar) => envVar.id !== id),
			},
		});

	const updateZoomEnvVar = (id: string, key: "key" | "value", value: string) =>
		dispatch({
			type: "patchZoomFormState",
			value: {
				envVars: zoomFormState.envVars.map((envVar) =>
					envVar.id === id ? { ...envVar, [key]: value } : envVar,
				),
			},
		});

	const connectGoogleTool = async ({
		enableForWorkspace,
		scopes,
		onStateChange,
		successMessage,
	}: {
		enableForWorkspace: "calendar" | "drive";
		scopes: readonly string[];
		onStateChange: (value: boolean) => void;
		successMessage: string;
	}) => {
		onStateChange(true);

		try {
			const enableGoogleToolForWorkspace = async () => {
				if (!activeWorkspaceId) {
					return;
				}

				await updateCalendarPreferences({
					workspaceId: activeWorkspaceId,
					showGoogleCalendar:
						enableForWorkspace === "calendar"
							? true
							: googleCalendarEnabledForWorkspace,
					showGoogleDrive:
						enableForWorkspace === "drive"
							? true
							: googleDriveEnabledForWorkspace,
					showYandexCalendar: calendarPreferences?.showYandexCalendar ?? false,
				});
			};
			const callbackURL = await getDesktopAuthCallbackUrl(window.location.href);
			const result = await authClient.$fetch("/link-social", {
				method: "POST",
				throw: true,
				body: {
					provider: "google",
					callbackURL,
					errorCallbackURL: callbackURL,
					disableRedirect: true,
					scopes: [...scopes],
				},
			});
			const resultObject = result && typeof result === "object" ? result : null;
			const url =
				resultObject && "url" in resultObject
					? String(resultObject.url ?? "")
					: "";
			const linkedWithoutRedirect =
				resultObject !== null &&
				"status" in resultObject &&
				Boolean(resultObject.status) &&
				"redirect" in resultObject &&
				resultObject.redirect === false;

			if (!url) {
				if (linkedWithoutRedirect) {
					await enableGoogleToolForWorkspace();
					await loadAccounts();
					toast.success(successMessage);
					return;
				}

				throw new Error("Google auth URL was not returned.");
			}

			// react-doctor-disable-next-line react-doctor/async-defer-await
			await enableGoogleToolForWorkspace();

			if (await openDesktopExternalUrl(url)) {
				return;
			}

			window.location.assign(url);
		} catch (error) {
			console.error("Failed to connect Google tool", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to connect Google account",
			);
		} finally {
			onStateChange(false);
		}
	};

	const googleCalendarToolAction = getGoogleToolAction({
		hasScope: hasGoogleCalendarToolScope && googleCalendarEnabledForWorkspace,
	});
	const googleDriveToolAction = getGoogleToolAction({
		hasScope: hasGoogleDriveToolScope && googleDriveEnabledForWorkspace,
	});

	const jiraWebhookUrl =
		convexSiteUrl && jiraConnection?.webhookSecret
			? (() => {
					const url = new URL("/api/webhooks/jira", convexSiteUrl);
					url.searchParams.set("sourceId", jiraConnection.sourceId);
					url.searchParams.set("secret", jiraConnection.webhookSecret);
					return url.toString();
				})()
			: null;

	const toolConnections: ToolConnectionRowProps[] = [
		{
			icon: (
				<AppSourceIcon provider="google-calendar" className="size-5 shrink-0" />
			),
			name: "Google Calendar",
			buttonLabel: googleCalendarToolAction.buttonLabel,
			buttonVariant: googleCalendarToolAction.buttonVariant,
			buttonDisabled: isConnectingGoogleCalendarTool || !session?.user,
			buttonIcon: isConnectingGoogleCalendarTool ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => {
				void connectGoogleTool({
					enableForWorkspace: "calendar",
					scopes: GOOGLE_CALENDAR_SCOPES,
					onStateChange: setIsConnectingGoogleCalendarTool,
					successMessage: "Google Calendar connected",
				});
			},
		},
		{
			icon: (
				<AppSourceIcon provider="google-drive" className="size-5 shrink-0" />
			),
			name: "Google Drive",
			buttonLabel: googleDriveToolAction.buttonLabel,
			buttonVariant: googleDriveToolAction.buttonVariant,
			buttonDisabled: isConnectingGoogleDriveTool || !session?.user,
			buttonIcon: isConnectingGoogleDriveTool ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => {
				void connectGoogleTool({
					enableForWorkspace: "drive",
					scopes: GOOGLE_DRIVE_SCOPES,
					onStateChange: setIsConnectingGoogleDriveTool,
					successMessage: "Google Drive connected",
				});
			},
		},
		{
			icon: (
				<AppSourceIcon provider="yandex-calendar" className="size-5 shrink-0" />
			),
			name: "Yandex Calendar",
			buttonLabel: yandexCalendarConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			buttonDisabled:
				!session?.user || yandexCalendarDialog.isSavingYandexCalendarConnection,
			onButtonClick: () =>
				yandexCalendarDialog.handleYandexCalendarDialogOpenChange(true),
		},
		{
			icon: (
				<AppSourceIcon provider="yandex-tracker" className="size-5 shrink-0" />
			),
			name: "Yandex Tracker",
			buttonLabel: yandexTrackerConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			onButtonClick: () => handleYandexTrackerDialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="jira" className="size-5 shrink-0" />,
			name: "Jira",
			buttonLabel: jiraMcpConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			buttonDisabled: isSavingJiraMcpConnection || !session?.user,
			buttonIcon: isSavingJiraMcpConnection ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => handleJiraMcpDialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="jira" className="size-5 shrink-0" />,
			name: "Jira sync",
			buttonLabel: jiraConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			onButtonClick: () => handleJiraDialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="posthog" className="size-5 shrink-0" />,
			name: "PostHog",
			buttonLabel: posthogConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			onButtonClick: () => handlePostHogDialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="notion" className="size-5 shrink-0" />,
			name: "Notion",
			buttonLabel: notionConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			onButtonClick: () => handleNotionDialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="zoom" className="size-5 shrink-0" />,
			name: "Zoom",
			buttonLabel:
				zoomConnection?.status === "connected" ? "Manage" : "Connect",
			buttonVariant: "outline",
			buttonDisabled: isSavingZoomConnection || !session?.user,
			buttonIcon: isSavingZoomConnection ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => handleZoomDialogOpenChange(true),
		},
	];

	const handleCopyJiraWebhookUrl = async () => {
		if (!jiraWebhookUrl) {
			toast.error("Jira webhook URL is not ready yet");
			return;
		}

		try {
			await writeTextToClipboard(jiraWebhookUrl);
			toast.success("Jira webhook URL copied");
		} catch (error) {
			console.error("Failed to copy Jira webhook URL", error);
			toast.error("Failed to copy Jira webhook URL");
		}
	};

	const handleOpenJiraWebhookSettings = async () => {
		if (!jiraConnection?.baseUrl) {
			return;
		}

		const url = new URL(
			"/plugins/servlet/webhooks",
			jiraConnection.baseUrl,
		).toString();

		if (await openDesktopExternalUrl(url)) {
			return;
		}

		window.open(url, "_blank", "noopener,noreferrer");
	};

	return {
		activeWorkspaceId,
		...yandexCalendarDialog,
		handleConnectJira,
		handleConnectJiraMcp,
		handleConnectNotion,
		handleConnectPostHog,
		handleConnectZoom,
		handleCopyJiraWebhookUrl,
		handleConnectYandexTracker,
		handleDisableJiraMcp,
		handleDisableJiraSync,
		handleDisableNotion,
		handleDisablePostHog,
		handleDisableYandexCalendar,
		handleDisableYandexTracker,
		handleDisableZoom,
		handleJiraDialogOpenChange,
		handleJiraMcpDialogOpenChange,
		handleNotionDialogOpenChange,
		handleOpenJiraWebhookSettings,
		handlePostHogDialogOpenChange,
		handleYandexTrackerDialogOpenChange,
		handleZoomDialogOpenChange,
		addPostHogEnvVar,
		addJiraMcpEnvVar,
		addNotionEnvVar,
		addZoomEnvVar,
		removePostHogEnvVar,
		removeJiraMcpEnvVar,
		removeNotionEnvVar,
		removeZoomEnvVar,
		updatePostHogEnvVar,
		updateJiraMcpEnvVar,
		updateNotionEnvVar,
		updateZoomEnvVar,
		isJiraDialogOpen,
		isJiraFormValid,
		isJiraMcpDialogOpen,
		isJiraMcpFormValid,
		isDisablingConnection,
		isNotionDialogOpen,
		isNotionFormValid,
		isPostHogDialogOpen,
		isPostHogFormValid,
		isPreparingJiraMentionSync,
		isSavingJiraConnection,
		isSavingJiraMcpConnection,
		isSavingNotionConnection,
		isSavingPostHogConnection,
		isSavingYandexTrackerConnection,
		isSavingZoomConnection,
		isYandexTrackerDialogOpen,
		isYandexTrackerFormValid,
		isZoomDialogOpen,
		isZoomFormValid,
		jiraConnection,
		jiraFormState,
		jiraMcpConnection,
		jiraMcpFormState,
		jiraWebhookUrl,
		notionConnection,
		notionFormState,
		posthogConnection,
		posthogFormState,
		yandexCalendarConnection,
		yandexTrackerConnection,
		zoomConnection,
		zoomFormState,
		setJiraBaseUrl: (baseUrl: string) =>
			dispatch({
				type: "patchJiraFormState",
				value: { baseUrl },
			}),
		setJiraEmail: (email: string) =>
			dispatch({
				type: "patchJiraFormState",
				value: { email },
			}),
		setJiraToken: (token: string) =>
			dispatch({
				type: "patchJiraFormState",
				value: { token },
			}),
		setJiraMcpBaseUrl: (baseUrl: string) =>
			dispatch({
				type: "patchJiraMcpFormState",
				value: { baseUrl },
			}),
		setJiraMcpName: (name: string) =>
			dispatch({
				type: "patchJiraMcpFormState",
				value: { name },
			}),
		setJiraMcpOAuthClientId,
		setJiraMcpOAuthClientSecret,
		setPostHogBaseUrl: (baseUrl: string) =>
			dispatch({
				type: "patchPostHogFormState",
				value: { baseUrl },
			}),
		setPostHogName: (name: string) =>
			dispatch({
				type: "patchPostHogFormState",
				value: { name },
			}),
		setPostHogOAuthClientId,
		setPostHogOAuthClientSecret,
		setNotionBaseUrl: (baseUrl: string) =>
			dispatch({
				type: "patchNotionFormState",
				value: { baseUrl },
			}),
		setNotionName: (name: string) =>
			dispatch({
				type: "patchNotionFormState",
				value: { name },
			}),
		setNotionOAuthClientId,
		setNotionOAuthClientSecret,
		setZoomBaseUrl: (baseUrl: string) =>
			dispatch({
				type: "patchZoomFormState",
				value: { baseUrl },
			}),
		setZoomName: (name: string) =>
			dispatch({
				type: "patchZoomFormState",
				value: { name },
			}),
		setZoomOAuthClientId: (oauthClientId: string) =>
			dispatch({
				type: "patchZoomFormState",
				value: { oauthClientId },
			}),
		setZoomOAuthClientSecret: (oauthClientSecret: string) =>
			dispatch({
				type: "patchZoomFormState",
				value: { oauthClientSecret },
			}),
		setYandexTrackerOrgId: (orgId: string) =>
			dispatch({
				type: "patchYandexTrackerFormState",
				value: { orgId },
			}),
		setYandexTrackerOrgType: (orgType: YandexTrackerOrgType) =>
			dispatch({
				type: "patchYandexTrackerFormState",
				value: { orgType },
			}),
		setYandexTrackerToken: (token: string) =>
			dispatch({
				type: "patchYandexTrackerFormState",
				value: { token },
			}),
		toolConnections,
		yandexTrackerFormState,
	};
}

function ToolConnectionsSection({
	connections,
}: {
	connections: ToolConnectionRowProps[];
}) {
	return (
		<Field>
			<Label className={SETTINGS_LABEL_CLASSNAME}>Tools</Label>
			<div className="space-y-3">
				{connections.map((connection) => (
					<ToolConnectionRow key={connection.name} {...connection} />
				))}
			</div>
		</Field>
	);
}

function JiraSyncSection({
	onCopyWebhookUrl,
	webhookUrl,
}: {
	onCopyWebhookUrl: () => void;
	webhookUrl: string | null;
}) {
	const [isCopied, setIsCopied] = useState(false);

	return (
		<FieldGroup className="gap-4">
			<Field>
				<Label className={SETTINGS_LABEL_CLASSNAME}>Webhook URL</Label>
				<InputGroup>
					<InputGroupInput
						value={webhookUrl ?? "Preparing Jira mention sync..."}
						readOnly
						disabled={!webhookUrl}
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							aria-label="Copy webhook URL"
							title="Copy webhook URL"
							size="icon-xs"
							onClick={() => {
								if (!webhookUrl) {
									return;
								}

								onCopyWebhookUrl();
								setIsCopied(true);
								window.setTimeout(() => {
									setIsCopied(false);
								}, 1200);
							}}
							disabled={!webhookUrl}
						>
							{isCopied ? <Check /> : <Copy />}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</Field>
		</FieldGroup>
	);
}

function ToolConnectionRow({
	icon,
	name,
	buttonLabel,
	buttonVariant = "outline",
	buttonDisabled = false,
	buttonIcon,
	onButtonClick,
}: ToolConnectionRowProps) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-center gap-3">
				{icon}
				<div className="min-w-0">
					<Label className="text-sm font-medium text-foreground">{name}</Label>
				</div>
			</div>
			<Button
				type="button"
				variant={buttonVariant}
				size="default"
				onClick={onButtonClick}
				disabled={buttonDisabled}
			>
				{buttonIcon}
				{buttonLabel}
			</Button>
		</div>
	);
}

function ConnectionDialogFooter({
	onCancel,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	onCancel: () => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-2 pt-2">
			{onDisable ? (
				<Button
					type="button"
					variant="destructive"
					onClick={onDisable}
					disabled={isSaving || isDisabling}
				>
					{isDisabling ? (
						<>
							<LoaderCircle className="animate-spin" />
							Disabling
						</>
					) : (
						"Disable"
					)}
				</Button>
			) : (
				<span />
			)}
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={onCancel}
					disabled={isSaving || isDisabling}
				>
					Cancel
				</Button>
				<Button
					type="button"
					onClick={onConnect}
					disabled={!isFormValid || isSaving || isDisabling}
				>
					{isSaving ? (
						<>
							<LoaderCircle className="animate-spin" />
							Connecting
						</>
					) : (
						"Connect"
					)}
				</Button>
			</div>
		</div>
	);
}

function YandexTrackerDialog({
	open,
	onOpenChange,
	formState,
	onOrgTypeChange,
	onOrgIdChange,
	onTokenChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: YandexTrackerConnectionFormState;
	onOrgTypeChange: (orgType: YandexTrackerOrgType) => void;
	onOrgIdChange: (orgId: string) => void;
	onTokenChange: (token: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Yandex Tracker</DialogTitle>
					<DialogDescription>
						Enter the credentials OpenGran should use for your Tracker
						connection.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<FieldContent>
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Organization type
							</Label>
						</FieldContent>
						<Select
							value={formState.orgType}
							onValueChange={(value) =>
								onOrgTypeChange(value as YandexTrackerOrgType)
							}
						>
							<SelectTrigger
								size="sm"
								className="w-full cursor-pointer justify-between"
								aria-label="Select Yandex Tracker organization type"
							>
								<span>
									{formState.orgType === "x-org-id"
										? "Yandex 360"
										: "Yandex Cloud"}
								</span>
							</SelectTrigger>
							<SelectContent align="end">
								<SelectItem value="x-org-id">Yandex 360</SelectItem>
								<SelectItem value="x-cloud-org-id">Yandex Cloud</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<Label
							htmlFor="yandex-tracker-org-id"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Organization ID
						</Label>
						<Input
							id="yandex-tracker-org-id"
							value={formState.orgId}
							onChange={(event) => onOrgIdChange(event.target.value)}
							placeholder="1234567"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="yandex-tracker-token"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							OAuth token
						</Label>
						<Input
							id="yandex-tracker-token"
							type="password"
							value={formState.token}
							onChange={(event) => onTokenChange(event.target.value)}
							placeholder="y0_AgAAAA..."
						/>
					</Field>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

// react-doctor-disable-next-line react-doctor/no-many-boolean-props
function JiraDialog({
	open,
	onOpenChange,
	formState,
	onCopyWebhookUrl,
	onBaseUrlChange,
	onEmailChange,
	onTokenChange,
	onConnect,
	onDisable,
	showSyncSettings,
	isFormValid,
	isSaving,
	isDisabling,
	webhookUrl,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: JiraConnectionFormState;
	onCopyWebhookUrl: () => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onEmailChange: (email: string) => void;
	onTokenChange: (token: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	showSyncSettings: boolean;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
	webhookUrl: string | null;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Jira sync</DialogTitle>
					<DialogDescription>
						Enter the Jira API credentials OpenGran should use for mention sync.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label htmlFor="jira-base-url" className={SETTINGS_LABEL_CLASSNAME}>
							Jira URL
						</Label>
						<Input
							id="jira-base-url"
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder="https://your-team.atlassian.net"
						/>
					</Field>
					<Field>
						<Label htmlFor="jira-email" className={SETTINGS_LABEL_CLASSNAME}>
							Email
						</Label>
						<Input
							id="jira-email"
							type="email"
							value={formState.email}
							onChange={(event) => onEmailChange(event.target.value)}
							placeholder="name@company.com"
						/>
					</Field>
					<Field>
						<Label htmlFor="jira-token" className={SETTINGS_LABEL_CLASSNAME}>
							API token
						</Label>
						<Input
							id="jira-token"
							type="password"
							value={formState.token}
							onChange={(event) => onTokenChange(event.target.value)}
							placeholder="ATATT..."
						/>
					</Field>
				</FieldGroup>
				{showSyncSettings ? (
					<Collapsible className="mt-4">
						<CollapsibleTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
							>
								Sync settings
								<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="pt-4">
							<JiraSyncSection
								onCopyWebhookUrl={onCopyWebhookUrl}
								webhookUrl={webhookUrl}
							/>
						</CollapsibleContent>
					</Collapsible>
				) : null}
				<div className="flex items-center justify-between gap-2 pt-2">
					{onDisable ? (
						<Button
							type="button"
							variant="destructive"
							onClick={onDisable}
							disabled={isSaving || isDisabling}
						>
							{isDisabling ? (
								<>
									<LoaderCircle className="animate-spin" />
									Disabling
								</>
							) : (
								"Disable"
							)}
						</Button>
					) : (
						<span />
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isSaving || isDisabling}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={onConnect}
							disabled={!isFormValid || isSaving || isDisabling}
						>
							{isSaving ? (
								<>
									<LoaderCircle className="animate-spin" />
									Connecting
								</>
							) : (
								"Connect"
							)}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function JiraMcpDialog({
	open,
	onOpenChange,
	formState,
	onNameChange,
	onBaseUrlChange,
	onAddEnvVar,
	onRemoveEnvVar,
	onUpdateEnvVar,
	onOAuthClientIdChange,
	onOAuthClientSecretChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: JiraMcpConnectionFormState;
	onNameChange: (name: string) => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onAddEnvVar: () => void;
	onRemoveEnvVar: (id: string) => void;
	onUpdateEnvVar: (id: string, key: "key" | "value", value: string) => void;
	onOAuthClientIdChange: (oauthClientId: string) => void;
	onOAuthClientSecretChange: (oauthClientSecret: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Jira</DialogTitle>
					<DialogDescription>
						Enter the Jira MCP connection details OpenGran should use for AI
						tools.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label htmlFor="jira-mcp-name" className={SETTINGS_LABEL_CLASSNAME}>
							Name
						</Label>
						<Input
							id="jira-mcp-name"
							value={formState.name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="Jira"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="jira-mcp-base-url"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Base URL
						</Label>
						<Input
							id="jira-mcp-base-url"
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder="https://mcp.atlassian.com/v1/mcp"
						/>
					</Field>
					<Field>
						<div className="flex items-center justify-between gap-3">
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Environment variables (optional)
							</Label>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onAddEnvVar}
							>
								<Plus />
								Add variable
							</Button>
						</div>
						{formState.envVars.length > 0 ? (
							<div className="space-y-2">
								{formState.envVars.map((envVar) => (
									<div key={envVar.id} className="flex gap-2">
										<Input
											value={envVar.key}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "key", event.target.value)
											}
											placeholder="key"
										/>
										<Input
											type="password"
											value={envVar.value}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "value", event.target.value)
											}
											placeholder="value"
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => onRemoveEnvVar(envVar.id)}
											aria-label="Remove variable"
										>
											<X />
										</Button>
									</div>
								))}
							</div>
						) : null}
					</Field>
					<Collapsible>
						<CollapsibleTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
							>
								Advanced settings
								<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-4 pt-4">
							<Field>
								<Label
									htmlFor="jira-mcp-oauth-client-id"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client ID
								</Label>
								<Input
									id="jira-mcp-oauth-client-id"
									value={formState.oauthClientId}
									onChange={(event) =>
										onOAuthClientIdChange(event.target.value)
									}
									placeholder="OAuth Client ID"
								/>
							</Field>
							<Field>
								<Label
									htmlFor="jira-mcp-oauth-client-secret"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client Secret
								</Label>
								<Input
									id="jira-mcp-oauth-client-secret"
									type="password"
									value={formState.oauthClientSecret}
									onChange={(event) =>
										onOAuthClientSecretChange(event.target.value)
									}
									placeholder="OAuth Client Secret"
								/>
							</Field>
						</CollapsibleContent>
					</Collapsible>
				</FieldGroup>
				<div className="flex items-center justify-between gap-2 pt-2">
					{onDisable ? (
						<Button
							type="button"
							variant="destructive"
							onClick={onDisable}
							disabled={isSaving || isDisabling}
						>
							{isDisabling ? (
								<>
									<LoaderCircle className="animate-spin" />
									Disabling
								</>
							) : (
								"Disable"
							)}
						</Button>
					) : (
						<span />
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isSaving || isDisabling}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={onConnect}
							disabled={!isFormValid || isSaving || isDisabling}
						>
							{isSaving ? (
								<>
									<LoaderCircle className="animate-spin" />
									Connecting
								</>
							) : (
								"Connect"
							)}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function PostHogDialog({
	open,
	onOpenChange,
	formState,
	onNameChange,
	onBaseUrlChange,
	onAddEnvVar,
	onRemoveEnvVar,
	onUpdateEnvVar,
	onOAuthClientIdChange,
	onOAuthClientSecretChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: PostHogConnectionFormState;
	onNameChange: (name: string) => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onAddEnvVar: () => void;
	onRemoveEnvVar: (id: string) => void;
	onUpdateEnvVar: (id: string, key: "key" | "value", value: string) => void;
	onOAuthClientIdChange: (oauthClientId: string) => void;
	onOAuthClientSecretChange: (oauthClientSecret: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect PostHog</DialogTitle>
					<DialogDescription>
						Enter the PostHog MCP connection details OpenGran should use for
						product analytics context.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label
							htmlFor="posthog-mcp-name"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Name
						</Label>
						<Input
							id="posthog-mcp-name"
							value={formState.name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="PostHog"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="posthog-mcp-base-url"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Base URL
						</Label>
						<Input
							id="posthog-mcp-base-url"
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder="https://mcp.posthog.com/mcp"
						/>
					</Field>
					<Field>
						<div className="flex items-center justify-between gap-3">
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Environment variables (optional)
							</Label>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onAddEnvVar}
							>
								<Plus />
								Add variable
							</Button>
						</div>
						{formState.envVars.length > 0 ? (
							<div className="space-y-2">
								{formState.envVars.map((envVar) => (
									<div key={envVar.id} className="flex gap-2">
										<Input
											value={envVar.key}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "key", event.target.value)
											}
											placeholder="key"
										/>
										<Input
											type="password"
											value={envVar.value}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "value", event.target.value)
											}
											placeholder="value"
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => onRemoveEnvVar(envVar.id)}
											aria-label="Remove variable"
										>
											<X />
										</Button>
									</div>
								))}
							</div>
						) : null}
					</Field>
					<Collapsible>
						<CollapsibleTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
							>
								Advanced settings
								<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-4 pt-4">
							<Field>
								<Label
									htmlFor="posthog-oauth-client-id"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client ID
								</Label>
								<Input
									id="posthog-oauth-client-id"
									value={formState.oauthClientId}
									onChange={(event) =>
										onOAuthClientIdChange(event.target.value)
									}
									placeholder="OAuth Client ID"
								/>
							</Field>
							<Field>
								<Label
									htmlFor="posthog-oauth-client-secret"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client Secret
								</Label>
								<Input
									id="posthog-oauth-client-secret"
									type="password"
									value={formState.oauthClientSecret}
									onChange={(event) =>
										onOAuthClientSecretChange(event.target.value)
									}
									placeholder="OAuth Client Secret"
								/>
							</Field>
						</CollapsibleContent>
					</Collapsible>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

function NotionDialog({
	open,
	onOpenChange,
	formState,
	onNameChange,
	onBaseUrlChange,
	onAddEnvVar,
	onRemoveEnvVar,
	onUpdateEnvVar,
	onOAuthClientIdChange,
	onOAuthClientSecretChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: NotionConnectionFormState;
	onNameChange: (name: string) => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onAddEnvVar: () => void;
	onRemoveEnvVar: (id: string) => void;
	onUpdateEnvVar: (id: string, key: "key" | "value", value: string) => void;
	onOAuthClientIdChange: (oauthClientId: string) => void;
	onOAuthClientSecretChange: (oauthClientSecret: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Notion</DialogTitle>
					<DialogDescription>
						Enter the Notion MCP connection details OpenGran should use for
						workspace context.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label
							htmlFor="notion-mcp-name"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Name
						</Label>
						<Input
							id="notion-mcp-name"
							value={formState.name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="Notion"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="notion-mcp-base-url"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Base URL
						</Label>
						<Input
							id="notion-mcp-base-url"
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder="https://mcp.notion.com/mcp"
						/>
					</Field>
					<Field>
						<div className="flex items-center justify-between gap-3">
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Environment variables (optional)
							</Label>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onAddEnvVar}
							>
								<Plus />
								Add variable
							</Button>
						</div>
						{formState.envVars.length > 0 ? (
							<div className="space-y-2">
								{formState.envVars.map((envVar) => (
									<div key={envVar.id} className="flex gap-2">
										<Input
											value={envVar.key}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "key", event.target.value)
											}
											placeholder="key"
										/>
										<Input
											type="password"
											value={envVar.value}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "value", event.target.value)
											}
											placeholder="value"
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => onRemoveEnvVar(envVar.id)}
											aria-label="Remove variable"
										>
											<X />
										</Button>
									</div>
								))}
							</div>
						) : null}
					</Field>
					<Collapsible>
						<CollapsibleTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
							>
								Advanced settings
								<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-4 pt-4">
							<Field>
								<Label
									htmlFor="notion-oauth-client-id"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client ID
								</Label>
								<Input
									id="notion-oauth-client-id"
									value={formState.oauthClientId}
									onChange={(event) =>
										onOAuthClientIdChange(event.target.value)
									}
									placeholder="OAuth Client ID"
								/>
							</Field>
							<Field>
								<Label
									htmlFor="notion-oauth-client-secret"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client Secret
								</Label>
								<Input
									id="notion-oauth-client-secret"
									type="password"
									value={formState.oauthClientSecret}
									onChange={(event) =>
										onOAuthClientSecretChange(event.target.value)
									}
									placeholder="OAuth Client Secret"
								/>
							</Field>
						</CollapsibleContent>
					</Collapsible>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

function ZoomDialog({
	open,
	onOpenChange,
	formState,
	onNameChange,
	onBaseUrlChange,
	onAddEnvVar,
	onRemoveEnvVar,
	onUpdateEnvVar,
	onOAuthClientIdChange,
	onOAuthClientSecretChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: ZoomConnectionFormState;
	onNameChange: (name: string) => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onAddEnvVar: () => void;
	onRemoveEnvVar: (id: string) => void;
	onUpdateEnvVar: (id: string, key: "key" | "value", value: string) => void;
	onOAuthClientIdChange: (oauthClientId: string) => void;
	onOAuthClientSecretChange: (oauthClientSecret: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Zoom</DialogTitle>
					<DialogDescription>
						Enter the Zoom MCP connection details OpenGran should use for
						meeting context.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label htmlFor="zoom-mcp-name" className={SETTINGS_LABEL_CLASSNAME}>
							Name
						</Label>
						<Input
							id="zoom-mcp-name"
							value={formState.name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="Zoom"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="zoom-mcp-base-url"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Base URL
						</Label>
						<Input
							id="zoom-mcp-base-url"
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder="https://mcp.zoom.us/mcp/zoom/streamable"
						/>
					</Field>
					<Field>
						<div className="flex items-center justify-between gap-3">
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Environment variables (optional)
							</Label>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onAddEnvVar}
							>
								<Plus />
								Add variable
							</Button>
						</div>
						{formState.envVars.length > 0 ? (
							<div className="space-y-2">
								{formState.envVars.map((envVar) => (
									<div key={envVar.id} className="flex gap-2">
										<Input
											value={envVar.key}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "key", event.target.value)
											}
											placeholder="key"
										/>
										<Input
											type="password"
											value={envVar.value}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "value", event.target.value)
											}
											placeholder="value"
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => onRemoveEnvVar(envVar.id)}
											aria-label="Remove variable"
										>
											<X />
										</Button>
									</div>
								))}
							</div>
						) : null}
					</Field>
					<Collapsible>
						<CollapsibleTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
							>
								Advanced settings
								<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-4 pt-4">
							<Field>
								<Label
									htmlFor="zoom-oauth-client-id"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client ID
								</Label>
								<Input
									id="zoom-oauth-client-id"
									value={formState.oauthClientId}
									onChange={(event) =>
										onOAuthClientIdChange(event.target.value)
									}
									placeholder="OAuth Client ID"
								/>
							</Field>
							<Field>
								<Label
									htmlFor="zoom-oauth-client-secret"
									className={SETTINGS_LABEL_CLASSNAME}
								>
									OAuth Client Secret
								</Label>
								<Input
									id="zoom-oauth-client-secret"
									type="password"
									value={formState.oauthClientSecret}
									onChange={(event) =>
										onOAuthClientSecretChange(event.target.value)
									}
									placeholder="OAuth Client Secret"
								/>
							</Field>
						</CollapsibleContent>
					</Collapsible>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

function WorkspaceSettings({
	workspace,
	onCancel,
	onSave,
}: {
	workspace: WorkspaceRecord | null;
	onCancel: () => void;
	onSave: () => void;
}) {
	const generateIconUploadUrl = useMutation(
		api.workspaces.generateIconUploadUrl,
	);
	const updateWorkspace = useMutation(api.workspaces.update);
	const [formState, setFormState] = useReducer(
		(
			current: WorkspaceFormState,
			next:
				| WorkspaceFormState
				| ((current: WorkspaceFormState) => WorkspaceFormState),
		) => (typeof next === "function" ? next(current) : next),
		workspace,
		getWorkspaceFormState,
	);
	const [isSaving, setIsSaving] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const [isUploadingIcon, setIsUploadingIcon] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { name, iconStorageId, iconPreviewUrl } = formState;
	const resetWorkspaceFormState = useCallback(
		(nextWorkspace: typeof workspace) => {
			setFormState(getWorkspaceFormState(nextWorkspace));
		},
		[],
	);

	useResetStateWhenValueChanges(workspace, resetWorkspaceFormState);

	useEffect(() => {
		if (!iconPreviewUrl?.startsWith("blob:")) {
			return;
		}

		return () => {
			URL.revokeObjectURL(iconPreviewUrl);
		};
	}, [iconPreviewUrl]);

	if (!workspace) {
		return (
			<div className="py-4">
				<FieldGroup>
					<Field>
						<Label className={SETTINGS_LABEL_CLASSNAME}>
							No workspace selected
						</Label>
						<FieldDescription>
							Select a workspace from the sidebar, then reopen settings to edit
							it here.
						</FieldDescription>
					</Field>
				</FieldGroup>
			</div>
		);
	}

	const trimmedName = name.trim();
	const hasChanges =
		trimmedName !== workspace.name ||
		iconStorageId !== (workspace.iconStorageId ?? null);
	const workspaceAvatarSrc = getAvatarSrc({
		avatar: iconPreviewUrl ?? workspace.iconUrl,
		name: trimmedName || workspace.name,
	});
	const handleCancel = () => {
		if (isSaving || isUploadingIcon) {
			return;
		}

		if (hasChanges) {
			setFormState(getWorkspaceFormState(workspace));
		}

		onCancel();
	};

	const handleUpload = async (file: File) => {
		setIsUploadingIcon(true);

		try {
			const uploadUrl = await generateIconUploadUrl();
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: {
					"Content-Type": file.type || "application/octet-stream",
				},
				body: file,
			});

			if (!response.ok) {
				throw new Error("Failed to upload workspace icon.");
			}

			const result = (await response.json()) as { storageId?: Id<"_storage"> };

			if (!result.storageId) {
				throw new Error("Workspace icon upload did not return a storage id.");
			}

			setFormState((currentState) => ({
				...currentState,
				iconStorageId: result.storageId ?? null,
				iconPreviewUrl: URL.createObjectURL(file),
			}));
		} catch (error) {
			console.error("Failed to upload workspace icon", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to upload workspace icon",
			);
		} finally {
			setIsUploadingIcon(false);
		}
	};

	const handleSubmit = async () => {
		if (!trimmedName || isSaving || isUploadingIcon || !hasChanges) {
			return;
		}

		setIsSaving(true);

		try {
			await updateWorkspace({
				workspaceId: workspace._id,
				name: trimmedName,
				iconStorageId:
					iconStorageId !== (workspace.iconStorageId ?? null)
						? (iconStorageId ?? undefined)
						: undefined,
			});
			toast.success("Workspace settings updated");
			onSave();
		} catch (error) {
			console.error("Failed to update workspace", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to update workspace",
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Icon</Label>
					<div className="flex items-center gap-4">
						<Avatar className="size-20 rounded-lg border">
							<AvatarImage
								src={workspaceAvatarSrc}
								alt="Workspace icon preview"
								className="object-cover"
							/>
							<AvatarFallback className="rounded-lg bg-muted/40">
								<ImageUp className="size-8 text-muted-foreground" />
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col gap-2">
							<Button
								variant="outline"
								size="sm"
								className="w-min"
								aria-label="Upload workspace icon"
								onClick={() => fileInputRef.current?.click()}
								disabled={isSaving || isUploadingIcon}
							>
								{isUploadingIcon ? "Uploading..." : "Upload"}
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								aria-label="Upload workspace icon file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								className="hidden"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (!file) {
										return;
									}

									void handleUpload(file);
									event.target.value = "";
								}}
							/>
							<FieldDescription>
								Recommend size 1:1, up to 5MB.
							</FieldDescription>
						</div>
					</div>
				</Field>
				<Field>
					<Label
						htmlFor="settings-workspace-name"
						className={SETTINGS_LABEL_CLASSNAME}
					>
						Name
					</Label>
					<Input
						id="settings-workspace-name"
						value={name}
						onChange={(event) =>
							setFormState((currentState) => ({
								...currentState,
								name: event.target.value,
							}))
						}
						placeholder="My workspace"
						disabled={isSaving}
					/>
				</Field>
			</FieldGroup>
			<div className="flex justify-end gap-2 pt-6">
				<Button
					variant="ghost"
					onClick={handleCancel}
					disabled={isSaving || isUploadingIcon}
				>
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					disabled={!trimmedName || !hasChanges || isSaving || isUploadingIcon}
				>
					{isSaving ? (
						<>
							<LoaderCircle className="animate-spin" />
							Saving
						</>
					) : (
						"Save"
					)}
				</Button>
			</div>
		</div>
	);
}

function DataControlsSettings({
	canDeleteData,
	onClose,
}: {
	canDeleteData: boolean;
	onClose: () => void;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [state, setState] = useReducer(
		(
			current: DataControlsState,
			next:
				| DataControlsState
				| ((current: DataControlsState) => DataControlsState),
		) => (typeof next === "function" ? next(current) : next),
		initialDataControlsState,
	);
	const removeAllNotes = useMutation(api.notes.removeAll);
	const removeAllChats = useMutation(api.chats.removeAll);
	const removeWorkspace = useMutation(api.workspaces.remove);
	const [showDeleteWorkspaceDialog, setShowDeleteWorkspaceDialog] =
		useState(false);
	const [isDeletingWorkspace, setIsDeletingWorkspace] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const {
		showDeleteAccountDialog,
		isDeletingAccount,
		showDeleteAllNotesDialog,
		isDeletingAllNotes,
		showDeleteAllChatsDialog,
		isDeletingAllChats,
	} = state;

	const navigateTo = (pathname: string) => {
		window.history.pushState(null, "", pathname);
		window.dispatchEvent(new PopStateEvent("popstate"));
	};

	const handleDeleteAccount = async () => {
		setState((currentState) => ({
			...currentState,
			isDeletingAccount: true,
		}));

		try {
			await authClient.$fetch("/delete-user", {
				method: "POST",
				throw: true,
				body: { callbackURL: "/" },
			});
			setState((currentState) => ({
				...currentState,
				showDeleteAccountDialog: false,
			}));
			onClose();
			window.location.assign("/");
		} catch (error) {
			console.error("Failed to delete account", error);
			setState((currentState) => ({
				...currentState,
				showDeleteAccountDialog: false,
			}));
			toast.error("Failed to delete account");
		} finally {
			setState((currentState) => ({
				...currentState,
				isDeletingAccount: false,
			}));
		}
	};

	const handleDeleteWorkspace = async () => {
		if (!activeWorkspaceId || isDeletingWorkspace) {
			return;
		}

		setIsDeletingWorkspace(true);

		try {
			await removeWorkspace({ workspaceId: activeWorkspaceId });
			setShowDeleteWorkspaceDialog(false);
			onClose();
			navigateTo("/home");
			toast.success("Workspace deleted");
		} catch (error) {
			console.error("Failed to delete workspace", error);
			setShowDeleteWorkspaceDialog(false);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to delete workspace",
			);
		} finally {
			setIsDeletingWorkspace(false);
		}
	};

	const handleDeleteAllNotes = async () => {
		setState((currentState) => ({
			...currentState,
			isDeletingAllNotes: true,
		}));

		try {
			if (!activeWorkspaceId) {
				return;
			}

			const result = await removeAllNotes({ workspaceId: activeWorkspaceId });
			setState((currentState) => ({
				...currentState,
				showDeleteAllNotesDialog: false,
			}));
			onClose();
			navigateTo("/home");
			toast.success(
				result.hasMore ? "Note deletion started" : "All notes deleted",
			);
		} catch (error) {
			console.error("Failed to delete all notes", error);
			setState((currentState) => ({
				...currentState,
				showDeleteAllNotesDialog: false,
			}));
			toast.error("Failed to delete all notes");
		} finally {
			setState((currentState) => ({
				...currentState,
				isDeletingAllNotes: false,
			}));
		}
	};

	const handleDeleteAllChats = async () => {
		setState((currentState) => ({
			...currentState,
			isDeletingAllChats: true,
		}));

		try {
			if (!activeWorkspaceId) {
				return;
			}

			const result = await removeAllChats({ workspaceId: activeWorkspaceId });
			setState((currentState) => ({
				...currentState,
				showDeleteAllChatsDialog: false,
			}));
			onClose();
			navigateTo("/home");
			toast.success(
				result.hasMore ? "Chat deletion started" : "All chats deleted",
			);
		} catch (error) {
			console.error("Failed to delete all chats", error);
			setState((currentState) => ({
				...currentState,
				showDeleteAllChatsDialog: false,
			}));
			toast.error("Failed to delete all chats");
		} finally {
			setState((currentState) => ({
				...currentState,
				isDeletingAllChats: false,
			}));
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Workspace</Label>
					<DataControlAction
						title="Delete all notes"
						buttonLabel={isDeletingAllNotes ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteAllNotesDialog}
						onDialogOpenChange={(open) => {
							setState((currentState) => ({
								...currentState,
								showDeleteAllNotesDialog: open,
							}));
						}}
						onConfirm={handleDeleteAllNotes}
						confirmDisabled={isDeletingAllNotes}
						buttonDisabled={isDeletingAllNotes || !canDeleteData}
						dialogDescription="This action cannot be undone. All notes you own will be permanently deleted."
					/>
					<DataControlAction
						title="Delete all chats"
						buttonLabel={isDeletingAllChats ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteAllChatsDialog}
						onDialogOpenChange={(open) => {
							setState((currentState) => ({
								...currentState,
								showDeleteAllChatsDialog: open,
							}));
						}}
						onConfirm={handleDeleteAllChats}
						confirmDisabled={isDeletingAllChats}
						buttonDisabled={isDeletingAllChats || !canDeleteData}
						dialogDescription="This action cannot be undone. All chats you own will be permanently deleted."
					/>
					<DataControlAction
						title="Delete workspace"
						buttonLabel={isDeletingWorkspace ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteWorkspaceDialog}
						onDialogOpenChange={setShowDeleteWorkspaceDialog}
						onConfirm={handleDeleteWorkspace}
						confirmDisabled={isDeletingWorkspace}
						buttonDisabled={isDeletingWorkspace || !canDeleteData}
						dialogDescription="This action cannot be undone. The current workspace and its notes and chats will be permanently deleted."
					/>
				</Field>
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Account</Label>
					<DataControlAction
						title="Delete account"
						buttonLabel={isDeletingAccount ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteAccountDialog}
						onDialogOpenChange={(open) => {
							setState((currentState) => ({
								...currentState,
								showDeleteAccountDialog: open,
							}));
						}}
						onConfirm={handleDeleteAccount}
						confirmDisabled={isDeletingAccount}
						buttonDisabled={isDeletingAccount || !canDeleteData}
						dialogDescription="This action cannot be undone. This will permanently delete your account."
					/>
				</Field>
			</FieldGroup>
		</div>
	);
}

function DataControlAction({
	title,
	buttonLabel,
	dialogOpen,
	onDialogOpenChange,
	onConfirm,
	confirmDisabled,
	buttonDisabled,
	dialogDescription,
}: {
	title: string;
	buttonLabel: string;
	dialogOpen: boolean;
	onDialogOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	confirmDisabled: boolean;
	buttonDisabled: boolean;
	dialogDescription: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="text-sm font-medium">{title}</div>
			<AlertDialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
				<AlertDialogTrigger asChild>
					<Button
						variant="ghost"
						className="shrink-0 bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
						disabled={buttonDisabled}
					>
						{buttonLabel}
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={confirmDisabled}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
							onClick={onConfirm}
							disabled={confirmDisabled}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function useManageAccountFormElement({
	user,
	onCancel,
	onSave,
}: {
	user: SettingsUser;
	onCancel: () => void;
	onSave: () => void;
}) {
	const userPreferences = useQuery(api.userPreferences.get, {});
	const generateAvatarUploadUrl = useMutation(
		api.userPreferences.generateAvatarUploadUrl,
	);
	const updateUserPreferences = useMutation(
		api.userPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		const currentPreferences = localStore.getQuery(api.userPreferences.get, {});
		localStore.setQuery(
			api.userPreferences.get,
			{},
			mergeUserPreferencesForOptimisticUpdate(currentPreferences, args),
		);
	});
	const [formState, setFormState] = useState<ProfileFormState>(() =>
		getProfileFormState({
			user,
			userPreferences: null,
		}),
	);
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
	const [isSavingPreferences, setIsSavingPreferences] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const profileFormSource = useMemo(
		() => [user, userPreferences] as const,
		[user, userPreferences],
	);
	const resetProfileFormState = useCallback(
		([nextUser, nextUserPreferences]: typeof profileFormSource) => {
			setFormState(
				getProfileFormState({
					user: nextUser,
					userPreferences: nextUserPreferences,
				}),
			);
		},
		[],
	);

	useResetStateWhenValueChanges(profileFormSource, resetProfileFormState);

	useEffect(() => {
		const avatarPreviewUrl = formState.avatarPreviewUrl;

		if (!avatarPreviewUrl?.startsWith("blob:")) {
			return;
		}

		return () => {
			URL.revokeObjectURL(avatarPreviewUrl);
		};
	}, [formState.avatarPreviewUrl]);

	const trimmedName = formState.name.trim();
	const trimmedJobTitle = formState.jobTitle.trim();
	const trimmedCompanyName = formState.companyName.trim();
	const currentJobTitle = userPreferences?.jobTitle ?? "";
	const currentCompanyName = userPreferences?.companyName ?? "";
	const currentAvatarStorageId = userPreferences?.avatarStorageId ?? null;
	const hasAuthChanges = trimmedName !== user.name.trim();
	const hasPreferenceChanges =
		trimmedJobTitle !== currentJobTitle.trim() ||
		trimmedCompanyName !== currentCompanyName.trim() ||
		formState.avatarStorageId !== currentAvatarStorageId;
	const hasChanges = hasAuthChanges || hasPreferenceChanges;

	const initials = getInitials(formState.name, user.email);
	const avatarSrc = getAvatarSrc({
		avatar: formState.avatarPreviewUrl ?? user.avatar,
		name: formState.name,
		email: user.email,
	});
	const handleCancel = () => {
		if (isSavingPreferences || isUploadingAvatar) {
			return;
		}

		if (hasChanges) {
			setFormState(
				getProfileFormState({
					user,
					userPreferences,
				}),
			);
		}

		onCancel();
	};

	const handleAvatarUpload = async (file: File) => {
		if (!file.type.startsWith("image/")) {
			toast.error("Please choose an image file");
			return;
		}

		if (file.size > MAX_PROFILE_AVATAR_FILE_SIZE_BYTES) {
			toast.error("Profile avatar must be 5MB or smaller");
			return;
		}

		setIsUploadingAvatar(true);

		try {
			const uploadUrl = await generateAvatarUploadUrl();
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: {
					"Content-Type": file.type || "application/octet-stream",
				},
				body: file,
			});

			if (!response.ok) {
				throw new Error("Failed to upload profile avatar.");
			}

			const result = (await response.json()) as { storageId?: Id<"_storage"> };
			if (!result.storageId) {
				throw new Error("Profile avatar upload did not return a storage id.");
			}
			const avatarStorageId = result.storageId;

			setFormState((current) => ({
				...current,
				avatarStorageId,
				avatarPreviewUrl: URL.createObjectURL(file),
			}));
		} catch (error) {
			console.error("Failed to upload profile avatar", error);
			toast.error(
				error instanceof Error
					? withoutTrailingPeriod(error.message)
					: "Failed to upload profile avatar",
			);
		} finally {
			setIsUploadingAvatar(false);
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Avatar</Label>
					<div className="flex items-center gap-4">
						<Avatar className="size-20 rounded-lg">
							<AvatarImage
								src={avatarSrc}
								alt="Profile avatar preview"
								className="object-cover"
							/>
							<AvatarFallback className="rounded-lg bg-muted/40">
								{avatarSrc ? initials : <ImageUp className="size-8" />}
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col gap-2">
							<Button
								variant="outline"
								size="sm"
								className="w-min"
								aria-label="Upload avatar"
								onClick={() => fileInputRef.current?.click()}
								disabled={isSavingPreferences || isUploadingAvatar}
							>
								{isUploadingAvatar ? "Processing..." : "Upload"}
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								aria-label="Upload avatar file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								className="hidden"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (!file) {
										return;
									}

									void handleAvatarUpload(file);
									event.target.value = "";
								}}
							/>
							<FieldDescription>
								Recommend size 1:1, up to 5MB.
							</FieldDescription>
						</div>
					</div>
				</Field>
				<Field>
					<Label htmlFor="settings-name" className={SETTINGS_LABEL_CLASSNAME}>
						Full name
					</Label>
					<Input
						id="settings-name"
						value={formState.name}
						onChange={(event) => {
							const nextName = event.target.value;
							setFormState((current) => ({
								...current,
								name: nextName,
							}));
						}}
						placeholder="Enter your name"
						disabled={isSavingPreferences || isUploadingAvatar}
					/>
				</Field>
				<Field>
					<Label htmlFor="settings-email" className={SETTINGS_LABEL_CLASSNAME}>
						Email
					</Label>
					<Input id="settings-email" value={user.email} disabled />
				</Field>
				<Field>
					<Label
						htmlFor="settings-job-title"
						className={SETTINGS_LABEL_CLASSNAME}
					>
						Job title
					</Label>
					<Input
						id="settings-job-title"
						value={formState.jobTitle}
						onChange={(event) => {
							const nextJobTitle = event.target.value;
							setFormState((current) => ({
								...current,
								jobTitle: nextJobTitle,
							}));
						}}
						placeholder="Enter your job title"
						disabled={isSavingPreferences || isUploadingAvatar}
					/>
				</Field>
				<Field>
					<Label
						htmlFor="settings-company-name"
						className={SETTINGS_LABEL_CLASSNAME}
					>
						Company
					</Label>
					<Input
						id="settings-company-name"
						value={formState.companyName}
						onChange={(event) => {
							const nextCompanyName = event.target.value;
							setFormState((current) => ({
								...current,
								companyName: nextCompanyName,
							}));
						}}
						placeholder="Enter your company name"
						disabled={isSavingPreferences || isUploadingAvatar}
					/>
				</Field>
			</FieldGroup>
			<div className="flex justify-end gap-2 pt-6">
				<Button
					variant="ghost"
					onClick={handleCancel}
					disabled={isSavingPreferences || isUploadingAvatar}
				>
					Cancel
				</Button>
				<Button
					onClick={async () => {
						if (
							!trimmedName ||
							isSavingPreferences ||
							isUploadingAvatar ||
							!hasChanges
						) {
							return;
						}

						setIsSavingPreferences(true);

						try {
							if (hasAuthChanges) {
								const { error } = await authClient.updateUser({
									name: trimmedName,
								});

								if (error) {
									throw new Error(error.message);
								}
							}

							if (hasPreferenceChanges) {
								await updateUserPreferences({
									jobTitle: trimmedJobTitle || null,
									companyName: trimmedCompanyName || null,
									avatarStorageId: formState.avatarStorageId,
								});
							}

							toast.success("Profile updated");
							onSave();
						} catch (error) {
							console.error("Failed to update profile", error);
							toast.error(
								error instanceof Error
									? withoutTrailingPeriod(error.message)
									: "Failed to update profile",
							);
						} finally {
							setIsSavingPreferences(false);
						}
					}}
					disabled={
						!trimmedName ||
						!hasChanges ||
						isSavingPreferences ||
						isUploadingAvatar
					}
				>
					{isSavingPreferences ? (
						<>
							<LoaderCircle className="animate-spin" />
							Saving
						</>
					) : (
						"Save"
					)}
				</Button>
			</div>
		</div>
	);
}

function ManageAccountForm(props: {
	user: SettingsUser;
	onCancel: () => void;
	onSave: () => void;
}) {
	return useManageAccountFormElement(props);
}

function getInitials(name: string, email: string) {
	const source = name.trim() || email;

	return source
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}
