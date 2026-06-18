import {
	getDesktopAuthCallbackUrl,
	getDesktopPreferences,
	isDesktopRuntime,
	openDesktopExternalUrl,
	setDesktopKeepDictationBarVisible,
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
	LayoutGrid,
	LoaderCircle,
	Paintbrush,
	SlidersHorizontal,
	UserRound,
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
import { ConnectionDialogFooter } from "@/components/settings/connection-dialog-footer";
import {
	getConnectionErrorMessage,
	withoutTrailingPeriod,
} from "@/components/settings/connection-error-message";
import {
	calendarSettingsReducer,
	connectionsSettingsReducer,
	getStableConnectionSettingsKey,
	initialCalendarSettingsState,
	initialConnectionsSettingsState,
	initialContext7ConnectionFormState,
	initialFigmaConnectionFormState,
	initialJiraConnectionFormState,
	initialJiraMcpConnectionFormState,
	initialLinearConnectionFormState,
	initialNotionConnectionFormState,
	initialPostHogConnectionFormState,
	initialYandexCalendarConnectionFormState,
	initialYandexTrackerConnectionFormState,
	initialZoomConnectionFormState,
	type JiraConnectionFormState,
	type PreferencesSettingsState,
	preferencesSettingsReducer,
	type RemoteMcpFormPatch,
	type RemoteMcpFormStateKey,
	resolveConnectionSettings,
	stableConnectionSettingsStore,
	type YandexCalendarConnectionFormState,
	type YandexTrackerConnectionFormState,
	type YandexTrackerOrgType,
} from "@/components/settings/connection-settings-state";
import { RemoteMcpDialog } from "@/components/settings/remote-mcp-dialog";
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
import { logError } from "@/lib/logger";
import {
	buildRemoteMcpConnectArgs,
	isRemoteMcpConnectionFormValid,
	type RemoteMcpConnectionFormState,
} from "@/lib/remote-mcp-connection-form";
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
	{ name: "Connections", icon: LayoutGrid },
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

const navigateTo = (pathname: string) => {
	window.history.pushState(null, "", pathname);
	window.dispatchEvent(new PopStateEvent("popstate"));
};

const getInitialPreferencesSettingsState = (): PreferencesSettingsState => ({
	preferences: null,
	isLoadingPreferences: isDesktopRuntime(),
	savingPreference: null,
});

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
					<DialogDescription>Manage your Graneri settings.</DialogDescription>
				</DialogHeader>
				<DialogDescription className="sr-only">
					Manage your Graneri settings.
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update notification preferences",
			});
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
	const { preferences, isLoadingPreferences, savingPreference } = state;

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
				logError({
					event: "client.error",
					error: error,
					message: "Failed to load desktop preferences",
				});
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

	const savePreference = async ({
		errorMessage,
		key,
		save,
		value,
	}: {
		errorMessage: string;
		key: "keepDictationBarVisible" | "launchAtLogin";
		save: (value: boolean) => Promise<DesktopPreferences | null>;
		value: boolean;
	}) => {
		if (!isDesktopRuntime()) {
			return;
		}

		const previousPreferences = preferences;
		dispatch({ type: "setSavingPreference", value: key });
		dispatch({ key, type: "setPreferenceOptimistic", value });

		try {
			const nextPreferences = await save(value);
			if (!nextPreferences) {
				throw new Error("Desktop preferences are unavailable.");
			}
			dispatch({ type: "setPreferences", value: nextPreferences });
		} catch (error) {
			logError({ event: "client.error", error: error, message: errorMessage });
			dispatch({ type: "setPreferences", value: previousPreferences });
			toast.error(errorMessage);
		} finally {
			dispatch({ type: "setSavingPreference", value: null });
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
		return <div className="py-4" aria-hidden="true" />;
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
						savingPreference === "launchAtLogin" ||
						!(preferences?.canLaunchAtLogin ?? false)
					}
					onCheckedChange={(checked) => {
						void savePreference({
							errorMessage: "Failed to update launch at login preference",
							key: "launchAtLogin",
							save: setDesktopLaunchAtLogin,
							value: checked,
						});
					}}
				/>
				<SettingsSwitchRow
					id="settings-keep-dictation-bar-visible"
					label="Keep dictation bar visible"
					checked={preferences?.keepDictationBarVisible ?? true}
					disabled={
						isLoadingPreferences ||
						savingPreference === "keepDictationBarVisible"
					}
					onCheckedChange={(checked) => {
						void savePreference({
							errorMessage: "Failed to update dictation bar preference",
							key: "keepDictationBarVisible",
							save: setDesktopKeepDictationBarVisible,
							value: checked,
						});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update calendar preferences",
			});
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
						Enter the Yandex account Graneri should use to load your upcoming
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Yandex Calendar",
			});
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
	const controller = useConnectionsSettingsController();

	if (!controller.activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific tool connections.
			</div>
		);
	}

	return (
		<div className="py-4">
			<ToolConnectionsSection connections={controller.toolConnections} />
			<ConnectionSettingsDialogs controller={controller} />
		</div>
	);
}

type ConnectionsSettingsController = ReturnType<
	typeof useConnectionsSettingsController
>;

function ConnectionSettingsDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<CalendarTrackerDialogs controller={controller} />
			<JiraConnectionDialogs controller={controller} />
			<RemoteHeaderMcpConnectionDialogs controller={controller} />
			<OAuthMcpConnectionDialogs controller={controller} />
		</>
	);
}

function CalendarTrackerDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<YandexCalendarDialog
				open={controller.isYandexCalendarDialogOpen}
				onOpenChange={controller.handleYandexCalendarDialogOpenChange}
				formState={controller.yandexCalendarFormState}
				onEmailChange={controller.setYandexCalendarEmail}
				onPasswordChange={controller.setYandexCalendarPassword}
				onConnect={() => void controller.handleConnectYandexCalendar()}
				onDisable={
					controller.yandexCalendarConnection
						? controller.handleDisableYandexCalendar
						: undefined
				}
				isFormValid={controller.isYandexCalendarFormValid}
				isSaving={controller.isSavingYandexCalendarConnection}
				isDisabling={controller.isDisablingConnection}
			/>
			<YandexTrackerDialog
				open={controller.isYandexTrackerDialogOpen}
				onOpenChange={controller.handleYandexTrackerDialogOpenChange}
				formState={controller.yandexTrackerFormState}
				onOrgTypeChange={controller.setYandexTrackerOrgType}
				onOrgIdChange={controller.setYandexTrackerOrgId}
				onTokenChange={controller.setYandexTrackerToken}
				onConnect={() => void controller.handleConnectYandexTracker()}
				onDisable={
					controller.yandexTrackerConnection
						? controller.handleDisableYandexTracker
						: undefined
				}
				isFormValid={controller.isYandexTrackerFormValid}
				isSaving={controller.isSavingYandexTrackerConnection}
				isDisabling={controller.isDisablingConnection}
			/>
		</>
	);
}

function JiraConnectionDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<JiraDialog
				open={controller.isJiraDialogOpen}
				onOpenChange={controller.handleJiraDialogOpenChange}
				formState={controller.jiraFormState}
				onBaseUrlChange={controller.setJiraBaseUrl}
				onEmailChange={controller.setJiraEmail}
				onTokenChange={controller.setJiraToken}
				onConnect={() => void controller.handleConnectJira()}
				isFormValid={controller.isJiraFormValid}
				isSaving={controller.isSavingJiraConnection}
				isDisabling={controller.isDisablingConnection}
				onDisable={
					controller.jiraConnection
						? controller.handleDisableJiraSync
						: undefined
				}
				onCopyWebhookUrl={() => void controller.handleCopyJiraWebhookUrl()}
				showSyncSettings={Boolean(controller.jiraConnection)}
				webhookUrl={controller.jiraWebhookUrl}
			/>
			<RemoteMcpDialog
				open={controller.isJiraMcpDialogOpen}
				onOpenChange={controller.handleJiraMcpDialogOpenChange}
				idPrefix="jira-mcp"
				title="Connect Jira"
				description="Enter the Jira MCP connection details Graneri should use for AI tools."
				keyPlaceholder="key"
				formState={controller.jiraMcpFormState}
				onNameChange={controller.setJiraMcpName}
				onBaseUrlChange={controller.setJiraMcpBaseUrl}
				onAddEnvVar={controller.addJiraMcpEnvVar}
				onRemoveEnvVar={controller.removeJiraMcpEnvVar}
				onUpdateEnvVar={controller.updateJiraMcpEnvVar}
				onOAuthClientIdChange={controller.setJiraMcpOAuthClientId}
				onOAuthClientSecretChange={controller.setJiraMcpOAuthClientSecret}
				onConnect={() => void controller.handleConnectJiraMcp()}
				isFormValid={controller.isJiraMcpFormValid}
				isSaving={controller.isSavingJiraMcpConnection}
				isDisabling={controller.isDisablingConnection}
				onDisable={
					controller.jiraMcpConnection
						? controller.handleDisableJiraMcp
						: undefined
				}
			/>
		</>
	);
}

function RemoteHeaderMcpConnectionDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<RemoteMcpDialog
				open={controller.isContext7DialogOpen}
				onOpenChange={controller.handleContext7DialogOpenChange}
				idPrefix="context7-mcp"
				title="Connect Context7"
				description="Enter the Context7 MCP connection details Graneri should use for library documentation."
				keyPlaceholder="CONTEXT7_API_KEY"
				formState={controller.context7FormState}
				onNameChange={controller.setContext7Name}
				onBaseUrlChange={controller.setContext7BaseUrl}
				onAddEnvVar={controller.addContext7EnvVar}
				onRemoveEnvVar={controller.removeContext7EnvVar}
				onUpdateEnvVar={controller.updateContext7EnvVar}
				onConnect={() => void controller.handleConnectContext7()}
				onDisable={
					controller.context7Connection
						? controller.handleDisableContext7
						: undefined
				}
				isFormValid={controller.isContext7FormValid}
				isSaving={controller.isSavingContext7Connection}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={controller.isFigmaDialogOpen}
				onOpenChange={controller.handleFigmaDialogOpenChange}
				idPrefix="figma-mcp"
				title="Connect Figma"
				description="Enter the Figma MCP connection details Graneri should use for design context."
				keyPlaceholder="Authorization"
				formState={controller.figmaFormState}
				onNameChange={controller.setFigmaName}
				onBaseUrlChange={controller.setFigmaBaseUrl}
				onAddEnvVar={controller.addFigmaEnvVar}
				onRemoveEnvVar={controller.removeFigmaEnvVar}
				onUpdateEnvVar={controller.updateFigmaEnvVar}
				oauthClientId={controller.figmaFormState.oauthClientId}
				oauthClientSecret={controller.figmaFormState.oauthClientSecret}
				onOAuthClientIdChange={controller.setFigmaOAuthClientId}
				onOAuthClientSecretChange={controller.setFigmaOAuthClientSecret}
				onConnect={() => void controller.handleConnectFigma()}
				onDisable={
					controller.figmaConnection ? controller.handleDisableFigma : undefined
				}
				isFormValid={controller.isFigmaFormValid}
				isSaving={controller.isSavingFigmaConnection}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={controller.isLinearDialogOpen}
				onOpenChange={controller.handleLinearDialogOpenChange}
				idPrefix="linear-mcp"
				title="Connect Linear"
				description="Enter the Linear MCP connection details Graneri should use for issue and project context."
				keyPlaceholder="Authorization"
				formState={controller.linearFormState}
				onNameChange={controller.setLinearName}
				onBaseUrlChange={controller.setLinearBaseUrl}
				onAddEnvVar={controller.addLinearEnvVar}
				onRemoveEnvVar={controller.removeLinearEnvVar}
				onUpdateEnvVar={controller.updateLinearEnvVar}
				oauthClientId={controller.linearFormState.oauthClientId}
				oauthClientSecret={controller.linearFormState.oauthClientSecret}
				onOAuthClientIdChange={controller.setLinearOAuthClientId}
				onOAuthClientSecretChange={controller.setLinearOAuthClientSecret}
				onConnect={() => void controller.handleConnectLinear()}
				onDisable={
					controller.linearConnection
						? controller.handleDisableLinear
						: undefined
				}
				isFormValid={controller.isLinearFormValid}
				isSaving={controller.isSavingLinearConnection}
				isDisabling={controller.isDisablingConnection}
			/>
		</>
	);
}

function OAuthMcpConnectionDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<RemoteMcpDialog
				open={controller.isPostHogDialogOpen}
				onOpenChange={controller.handlePostHogDialogOpenChange}
				idPrefix="posthog-mcp"
				title="Connect PostHog"
				description="Enter the PostHog MCP connection details Graneri should use for product analytics context."
				keyPlaceholder="key"
				formState={controller.posthogFormState}
				onNameChange={controller.setPostHogName}
				onBaseUrlChange={controller.setPostHogBaseUrl}
				onAddEnvVar={controller.addPostHogEnvVar}
				onRemoveEnvVar={controller.removePostHogEnvVar}
				onUpdateEnvVar={controller.updatePostHogEnvVar}
				onOAuthClientIdChange={controller.setPostHogOAuthClientId}
				onOAuthClientSecretChange={controller.setPostHogOAuthClientSecret}
				onConnect={() => void controller.handleConnectPostHog()}
				onDisable={
					controller.posthogConnection
						? controller.handleDisablePostHog
						: undefined
				}
				isFormValid={controller.isPostHogFormValid}
				isSaving={controller.isSavingPostHogConnection}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={controller.isNotionDialogOpen}
				onOpenChange={controller.handleNotionDialogOpenChange}
				idPrefix="notion-mcp"
				title="Connect Notion"
				description="Enter the Notion MCP connection details Graneri should use for workspace context."
				keyPlaceholder="key"
				formState={controller.notionFormState}
				onNameChange={controller.setNotionName}
				onBaseUrlChange={controller.setNotionBaseUrl}
				onAddEnvVar={controller.addNotionEnvVar}
				onRemoveEnvVar={controller.removeNotionEnvVar}
				onUpdateEnvVar={controller.updateNotionEnvVar}
				onOAuthClientIdChange={controller.setNotionOAuthClientId}
				onOAuthClientSecretChange={controller.setNotionOAuthClientSecret}
				onConnect={() => void controller.handleConnectNotion()}
				onDisable={
					controller.notionConnection
						? controller.handleDisableNotion
						: undefined
				}
				isFormValid={controller.isNotionFormValid}
				isSaving={controller.isSavingNotionConnection}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={controller.isZoomDialogOpen}
				onOpenChange={controller.handleZoomDialogOpenChange}
				idPrefix="zoom-mcp"
				title="Connect Zoom"
				description="Enter the Zoom MCP connection details Graneri should use for meeting context."
				keyPlaceholder="key"
				formState={controller.zoomFormState}
				onNameChange={controller.setZoomName}
				onBaseUrlChange={controller.setZoomBaseUrl}
				onAddEnvVar={controller.addZoomEnvVar}
				onRemoveEnvVar={controller.removeZoomEnvVar}
				onUpdateEnvVar={controller.updateZoomEnvVar}
				onOAuthClientIdChange={controller.setZoomOAuthClientId}
				onOAuthClientSecretChange={controller.setZoomOAuthClientSecret}
				onConnect={() => void controller.handleConnectZoom()}
				onDisable={
					controller.zoomConnection ? controller.handleDisableZoom : undefined
				}
				isFormValid={controller.isZoomFormValid}
				isSaving={controller.isSavingZoomConnection}
				isDisabling={controller.isDisablingConnection}
			/>
		</>
	);
}

function useConnectionsSettingsController() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const { data: session } = authClient.useSession();
	const { accounts, loadAccounts } = useLinkedAccounts(session?.user);
	const stableConnectionSettingsKey = getStableConnectionSettingsKey({
		workspaceId: activeWorkspaceId,
		email: session?.user?.email,
	});
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
	const context7ConnectionResult = useQuery(
		api.appConnections.getContext7,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const figmaConnectionResult = useQuery(
		api.appConnections.getFigma,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const linearConnectionResult = useQuery(
		api.appConnections.getLinear,
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
	const connectionQueryResults = useMemo(
		() => ({
			yandexTracker: yandexTrackerConnectionResult,
			yandexCalendar: yandexCalendarConnectionResult,
			jira: jiraConnectionResult,
			jiraMcp: jiraMcpConnectionResult,
			posthog: posthogConnectionResult,
			context7: context7ConnectionResult,
			figma: figmaConnectionResult,
			linear: linearConnectionResult,
			notion: notionConnectionResult,
			zoom: zoomConnectionResult,
		}),
		[
			context7ConnectionResult,
			figmaConnectionResult,
			jiraConnectionResult,
			jiraMcpConnectionResult,
			linearConnectionResult,
			notionConnectionResult,
			posthogConnectionResult,
			yandexCalendarConnectionResult,
			yandexTrackerConnectionResult,
			zoomConnectionResult,
		],
	);
	const stableConnectionSettings = resolveConnectionSettings({
		cachedSettings: stableConnectionSettingsKey
			? stableConnectionSettingsStore.get(stableConnectionSettingsKey)
			: undefined,
		results: connectionQueryResults,
	});
	const yandexTrackerConnection = stableConnectionSettings.yandexTracker;
	const yandexCalendarConnection = stableConnectionSettings.yandexCalendar;
	const jiraConnection = stableConnectionSettings.jira;
	const jiraMcpConnection = stableConnectionSettings.jiraMcp;
	const posthogConnection = stableConnectionSettings.posthog;
	const context7Connection = stableConnectionSettings.context7;
	const figmaConnection = stableConnectionSettings.figma;
	const linearConnection = stableConnectionSettings.linear;
	const notionConnection = stableConnectionSettings.notion;
	const zoomConnection = stableConnectionSettings.zoom;
	const connectYandexTracker = useAction(
		api.appConnectionActions.connectYandexTracker,
	);
	const connectJira = useAction(api.appConnectionActions.connectJira);
	const connectJiraMcp = useAction(api.appConnectionActions.connectJiraMcp);
	const connectContext7 = useAction(api.appConnectionActions.connectContext7);
	const connectFigma = useAction(api.appConnectionActions.connectFigma);
	const connectLinear = useAction(api.appConnectionActions.connectLinear);
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
		isContext7DialogOpen,
		isFigmaDialogOpen,
		isLinearDialogOpen,
		isPostHogDialogOpen,
		isNotionDialogOpen,
		isZoomDialogOpen,
		isSavingYandexTrackerConnection,
		isSavingJiraConnection,
		isSavingJiraMcpConnection,
		isSavingContext7Connection,
		isSavingFigmaConnection,
		isSavingLinearConnection,
		isDisablingConnection,
		isSavingPostHogConnection,
		isSavingNotionConnection,
		isSavingZoomConnection,
		yandexTrackerFormState,
		jiraFormState,
		jiraMcpFormState,
		context7FormState,
		figmaFormState,
		linearFormState,
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

		stableConnectionSettingsStore.update(
			stableConnectionSettingsKey,
			connectionQueryResults,
		);
	}, [connectionQueryResults, stableConnectionSettingsKey]);

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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Yandex Tracker",
			});
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
			toast.success("Jira Sync connected");
			handleJiraDialogOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Jira",
			});
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
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: jiraMcpFormState,
					requireEnvValue: true,
				}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Jira to finish connecting");
			handleJiraMcpDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Jira",
			});
			toast.error(getConnectionErrorMessage(error, "Failed to connect Jira"));
		} finally {
			dispatch({ type: "setIsSavingJiraMcpConnection", value: false });
		}
	};

	const isJiraMcpFormValid = isRemoteMcpConnectionFormValid(jiraMcpFormState);

	const handleContext7DialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsContext7DialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setContext7FormState",
				value: {
					name: context7Connection?.displayName ?? "Context7",
					baseUrl:
						context7Connection?.endpoint ??
						initialContext7ConnectionFormState.baseUrl,
					envVars: [],
				},
			});
		} else {
			dispatch({
				type: "setContext7FormState",
				value: initialContext7ConnectionFormState,
			});
		}
	};

	const handleConnectContext7 = async () => {
		if (
			!activeWorkspaceId ||
			!context7FormState.name.trim() ||
			!context7FormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingContext7Connection", value: true });

		try {
			await connectContext7({
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: context7FormState,
					requireEnvValue: true,
				}),
			});
			toast.success("Context7 connected");
			handleContext7DialogOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Context7",
			});
			toast.error(
				getConnectionErrorMessage(error, "Failed to connect Context7"),
			);
		} finally {
			dispatch({ type: "setIsSavingContext7Connection", value: false });
		}
	};

	const isContext7FormValid = isRemoteMcpConnectionFormValid(context7FormState);

	const handleFigmaDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsFigmaDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setFigmaFormState",
				value: {
					name: figmaConnection?.displayName ?? "Figma",
					baseUrl:
						figmaConnection?.endpoint ??
						initialFigmaConnectionFormState.baseUrl,
					envVars: [],
					oauthClientId: figmaConnection?.oauthClientId ?? "",
					oauthClientSecret: "",
				},
			});
		} else {
			dispatch({
				type: "setFigmaFormState",
				value: initialFigmaConnectionFormState,
			});
		}
	};

	const handleConnectFigma = async () => {
		if (
			!activeWorkspaceId ||
			!figmaFormState.name.trim() ||
			!figmaFormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingFigmaConnection", value: true });
		const oauthWindow = createOAuthNavigationTarget();

		try {
			const result = await connectFigma({
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: figmaFormState,
					requireEnvValue: false,
				}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Figma to finish connecting");
			handleFigmaDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Figma",
			});
			toast.error(getConnectionErrorMessage(error, "Failed to connect Figma"));
		} finally {
			dispatch({ type: "setIsSavingFigmaConnection", value: false });
		}
	};

	const isFigmaFormValid = isRemoteMcpConnectionFormValid(figmaFormState);

	const handleLinearDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsLinearDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setLinearFormState",
				value: {
					name: linearConnection?.displayName ?? "Linear",
					baseUrl:
						linearConnection?.endpoint ??
						initialLinearConnectionFormState.baseUrl,
					envVars: [],
					oauthClientId: linearConnection?.oauthClientId ?? "",
					oauthClientSecret: "",
				},
			});
		} else {
			dispatch({
				type: "setLinearFormState",
				value: initialLinearConnectionFormState,
			});
		}
	};

	const handleConnectLinear = async () => {
		if (
			!activeWorkspaceId ||
			!linearFormState.name.trim() ||
			!linearFormState.baseUrl.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingLinearConnection", value: true });
		const oauthWindow = createOAuthNavigationTarget();

		try {
			const result = await connectLinear({
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: linearFormState,
					requireEnvValue: false,
				}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Linear to finish connecting");
			handleLinearDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Linear",
			});
			toast.error(getConnectionErrorMessage(error, "Failed to connect Linear"));
		} finally {
			dispatch({ type: "setIsSavingLinearConnection", value: false });
		}
	};

	const isLinearFormValid = isRemoteMcpConnectionFormValid(linearFormState);

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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to disable connection",
			});
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
			successMessage: "Jira Sync disabled",
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

	const handleDisableContext7 = async () => {
		if (!context7Connection) {
			return;
		}

		await disableAppConnection({
			sourceId: context7Connection.sourceId,
			successMessage: "Context7 disabled",
			onDisabled: () => handleContext7DialogOpenChange(false),
		});
	};

	const handleDisableFigma = async () => {
		if (!figmaConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: figmaConnection.sourceId,
			successMessage: "Figma disabled",
			onDisabled: () => handleFigmaDialogOpenChange(false),
		});
	};

	const handleDisableLinear = async () => {
		if (!linearConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: linearConnection.sourceId,
			successMessage: "Linear disabled",
			onDisabled: () => handleLinearDialogOpenChange(false),
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
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: posthogFormState,
					requireEnvValue: true,
				}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in PostHog to finish connecting");
			handlePostHogDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect PostHog",
			});
			toast.error(
				getConnectionErrorMessage(error, "Failed to connect PostHog"),
			);
		} finally {
			dispatch({ type: "setIsSavingPostHogConnection", value: false });
		}
	};

	const isPostHogFormValid = isRemoteMcpConnectionFormValid(posthogFormState);

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
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: notionFormState,
					requireEnvValue: false,
				}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Notion to finish connecting");
			handleNotionDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Notion",
			});
			toast.error(getConnectionErrorMessage(error, "Failed to connect Notion"));
		} finally {
			dispatch({ type: "setIsSavingNotionConnection", value: false });
		}
	};

	const isNotionFormValid = isRemoteMcpConnectionFormValid(notionFormState);

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
				...buildRemoteMcpConnectArgs({
					workspaceId: activeWorkspaceId,
					formState: zoomFormState,
					requireEnvValue: false,
				}),
			});
			await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			toast.success("Continue in Zoom to finish connecting");
			handleZoomDialogOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Zoom",
			});
			toast.error(getConnectionErrorMessage(error, "Failed to connect Zoom"));
		} finally {
			dispatch({ type: "setIsSavingZoomConnection", value: false });
		}
	};

	const isZoomFormValid = isRemoteMcpConnectionFormValid(zoomFormState);

	const patchRemoteMcpForm = (
		key: RemoteMcpFormStateKey,
		value: RemoteMcpFormPatch,
	) =>
		dispatch({
			type: "patchRemoteMcpFormState",
			key,
			value,
		});

	const createRemoteMcpFormControls = (
		key: RemoteMcpFormStateKey,
		formState: RemoteMcpConnectionFormState,
	) => ({
		addEnvVar: () =>
			patchRemoteMcpForm(key, {
				envVars: [
					...formState.envVars,
					{ id: crypto.randomUUID(), key: "", value: "" },
				],
			}),
		removeEnvVar: (id: string) =>
			patchRemoteMcpForm(key, {
				envVars: formState.envVars.filter((envVar) => envVar.id !== id),
			}),
		updateEnvVar: (id: string, field: "key" | "value", value: string) =>
			patchRemoteMcpForm(key, {
				envVars: formState.envVars.map((envVar) =>
					envVar.id === id ? { ...envVar, [field]: value } : envVar,
				),
			}),
		setBaseUrl: (baseUrl: string) => patchRemoteMcpForm(key, { baseUrl }),
		setName: (name: string) => patchRemoteMcpForm(key, { name }),
		setOAuthClientId: (oauthClientId: string) =>
			patchRemoteMcpForm(key, { oauthClientId }),
		setOAuthClientSecret: (oauthClientSecret: string) =>
			patchRemoteMcpForm(key, { oauthClientSecret }),
	});

	const jiraMcpFormControls = createRemoteMcpFormControls(
		"jiraMcpFormState",
		jiraMcpFormState,
	);
	const context7FormControls = createRemoteMcpFormControls(
		"context7FormState",
		context7FormState,
	);
	const figmaFormControls = createRemoteMcpFormControls(
		"figmaFormState",
		figmaFormState,
	);
	const linearFormControls = createRemoteMcpFormControls(
		"linearFormState",
		linearFormState,
	);
	const posthogFormControls = createRemoteMcpFormControls(
		"posthogFormState",
		posthogFormState,
	);
	const notionFormControls = createRemoteMcpFormControls(
		"notionFormState",
		notionFormState,
	);
	const zoomFormControls = createRemoteMcpFormControls(
		"zoomFormState",
		zoomFormState,
	);

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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Google tool",
			});
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
			name: "Jira Sync",
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
			icon: <AppSourceIcon provider="context7" className="size-5 shrink-0" />,
			name: "Context7",
			buttonLabel: context7Connection ? "Manage" : "Connect",
			buttonVariant: "outline",
			buttonDisabled: isSavingContext7Connection || !session?.user,
			buttonIcon: isSavingContext7Connection ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => handleContext7DialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="figma" className="size-5 shrink-0" />,
			name: "Figma",
			buttonLabel: figmaConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			buttonDisabled: isSavingFigmaConnection || !session?.user,
			buttonIcon: isSavingFigmaConnection ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => handleFigmaDialogOpenChange(true),
		},
		{
			icon: <AppSourceIcon provider="linear" className="size-5 shrink-0" />,
			name: "Linear",
			buttonLabel: linearConnection ? "Manage" : "Connect",
			buttonVariant: "outline",
			buttonDisabled: isSavingLinearConnection || !session?.user,
			buttonIcon: isSavingLinearConnection ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onButtonClick: () => handleLinearDialogOpenChange(true),
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to copy Jira webhook URL",
			});
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
		handleConnectContext7,
		handleConnectFigma,
		handleConnectLinear,
		handleConnectNotion,
		handleConnectPostHog,
		handleConnectZoom,
		handleCopyJiraWebhookUrl,
		handleConnectYandexTracker,
		handleDisableJiraMcp,
		handleDisableContext7,
		handleDisableFigma,
		handleDisableLinear,
		handleDisableJiraSync,
		handleDisableNotion,
		handleDisablePostHog,
		handleDisableYandexCalendar,
		handleDisableYandexTracker,
		handleDisableZoom,
		handleJiraDialogOpenChange,
		handleJiraMcpDialogOpenChange,
		handleContext7DialogOpenChange,
		handleFigmaDialogOpenChange,
		handleLinearDialogOpenChange,
		handleNotionDialogOpenChange,
		handleOpenJiraWebhookSettings,
		handlePostHogDialogOpenChange,
		handleYandexTrackerDialogOpenChange,
		handleZoomDialogOpenChange,
		addPostHogEnvVar: posthogFormControls.addEnvVar,
		addContext7EnvVar: context7FormControls.addEnvVar,
		addFigmaEnvVar: figmaFormControls.addEnvVar,
		addLinearEnvVar: linearFormControls.addEnvVar,
		addJiraMcpEnvVar: jiraMcpFormControls.addEnvVar,
		addNotionEnvVar: notionFormControls.addEnvVar,
		addZoomEnvVar: zoomFormControls.addEnvVar,
		removePostHogEnvVar: posthogFormControls.removeEnvVar,
		removeContext7EnvVar: context7FormControls.removeEnvVar,
		removeFigmaEnvVar: figmaFormControls.removeEnvVar,
		removeLinearEnvVar: linearFormControls.removeEnvVar,
		removeJiraMcpEnvVar: jiraMcpFormControls.removeEnvVar,
		removeNotionEnvVar: notionFormControls.removeEnvVar,
		removeZoomEnvVar: zoomFormControls.removeEnvVar,
		updatePostHogEnvVar: posthogFormControls.updateEnvVar,
		updateContext7EnvVar: context7FormControls.updateEnvVar,
		updateFigmaEnvVar: figmaFormControls.updateEnvVar,
		updateLinearEnvVar: linearFormControls.updateEnvVar,
		updateJiraMcpEnvVar: jiraMcpFormControls.updateEnvVar,
		updateNotionEnvVar: notionFormControls.updateEnvVar,
		updateZoomEnvVar: zoomFormControls.updateEnvVar,
		isJiraDialogOpen,
		isJiraFormValid,
		isJiraMcpDialogOpen,
		isJiraMcpFormValid,
		isContext7DialogOpen,
		isContext7FormValid,
		isFigmaDialogOpen,
		isFigmaFormValid,
		isLinearDialogOpen,
		isLinearFormValid,
		isDisablingConnection,
		isNotionDialogOpen,
		isNotionFormValid,
		isPostHogDialogOpen,
		isPostHogFormValid,
		isPreparingJiraMentionSync,
		isSavingJiraConnection,
		isSavingJiraMcpConnection,
		isSavingContext7Connection,
		isSavingFigmaConnection,
		isSavingLinearConnection,
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
		context7Connection,
		context7FormState,
		figmaConnection,
		figmaFormState,
		linearConnection,
		linearFormState,
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
		setJiraMcpBaseUrl: jiraMcpFormControls.setBaseUrl,
		setJiraMcpName: jiraMcpFormControls.setName,
		setJiraMcpOAuthClientId: jiraMcpFormControls.setOAuthClientId,
		setJiraMcpOAuthClientSecret: jiraMcpFormControls.setOAuthClientSecret,
		setContext7BaseUrl: context7FormControls.setBaseUrl,
		setContext7Name: context7FormControls.setName,
		setFigmaBaseUrl: figmaFormControls.setBaseUrl,
		setFigmaName: figmaFormControls.setName,
		setFigmaOAuthClientId: figmaFormControls.setOAuthClientId,
		setFigmaOAuthClientSecret: figmaFormControls.setOAuthClientSecret,
		setLinearBaseUrl: linearFormControls.setBaseUrl,
		setLinearName: linearFormControls.setName,
		setLinearOAuthClientId: linearFormControls.setOAuthClientId,
		setLinearOAuthClientSecret: linearFormControls.setOAuthClientSecret,
		setPostHogBaseUrl: posthogFormControls.setBaseUrl,
		setPostHogName: posthogFormControls.setName,
		setPostHogOAuthClientId: posthogFormControls.setOAuthClientId,
		setPostHogOAuthClientSecret: posthogFormControls.setOAuthClientSecret,
		setNotionBaseUrl: notionFormControls.setBaseUrl,
		setNotionName: notionFormControls.setName,
		setNotionOAuthClientId: notionFormControls.setOAuthClientId,
		setNotionOAuthClientSecret: notionFormControls.setOAuthClientSecret,
		setZoomBaseUrl: zoomFormControls.setBaseUrl,
		setZoomName: zoomFormControls.setName,
		setZoomOAuthClientId: zoomFormControls.setOAuthClientId,
		setZoomOAuthClientSecret: zoomFormControls.setOAuthClientSecret,
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
						Enter the credentials Graneri should use for your Tracker
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
					<DialogTitle>Connect Jira Sync</DialogTitle>
					<DialogDescription>
						Enter the Jira API credentials Graneri should use for mention sync.
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to upload workspace icon",
			});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update workspace",
			});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete account",
			});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete workspace",
			});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete all notes",
			});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete all chats",
			});
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
			logError({
				event: "client.error",
				error: error,
				message: "Failed to upload profile avatar",
			});
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
							logError({
								event: "client.error",
								error: error,
								message: "Failed to update profile",
							});
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
