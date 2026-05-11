import {
	getDesktopMeta,
	isDesktopRuntime,
	onDesktopNavigate,
	setDesktopActiveWorkspaceId,
	setDesktopActiveWorkspaceNotificationPreferences,
} from "@workspace/platform/desktop";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@workspace/ui/components/popover";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Separator } from "@workspace/ui/components/separator";
import {
	SidebarProvider,
	SidebarTrigger,
	useDockedPanelWidths,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import {
	useAction,
	useConvex,
	useConvexAuth,
	useMutation,
	useQuery,
} from "convex/react";
import {
	ArrowDown,
	Clock,
	Copy,
	MessageSquareText,
	MoreHorizontal,
	Pencil,
	Plus,
	Redo2,
	Star,
	StarOff,
	TextSearch,
	Trash2,
	Undo2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { AppUser, AppView, UpcomingCalendarEvent } from "@/app/app-types";
import { HomeView, SharedView } from "@/app/home-shared-views";
import {
	buildCalendarEventNoteDocument,
	buildCalendarEventSearchableText,
	createCalendarEventKey,
	createNoteSearch,
	getAppLocationState,
	getDayWindowFromDayKey,
	getInitialNonSettingsLocation,
	getSettingsPageFromPath,
	getSettingsPath,
	shouldAutoStartNoteCaptureFromUrl,
	toStoredChatMessages,
} from "@/app/location";
import type {
	AutomationDraft,
	AutomationListItem,
} from "@/components/automations/automation-types";
import { AutomationsPage } from "@/components/automations/automations-page";
import { CreateAutomationDialog } from "@/components/automations/create-automation-dialog";
import { ChatPage } from "@/components/chat/chat-page";
import { OPEN_CHAT_SUMMARY_EVENT } from "@/components/chat/chat-summary-sheet";
import { optimisticPatchChat } from "@/components/chat/optimistic-patch-chat";
import { optimisticRenameChat } from "@/components/chat/optimistic-rename-chat";
import { readDesktopInboxPanelPinnedState } from "@/components/inbox/inbox-panel-state";
import { AppShellInset } from "@/components/layout/app-shell-inset";
import {
	NoteActionsMenu,
	NoteStarButton,
} from "@/components/note/note-actions-menu";
import { type NoteEditorActions, NotePage } from "@/components/note/note-page";
import { OPEN_NOTE_COMMENTS_EVENT } from "@/components/note/note-page-events";
import { NoteTitleEditInput } from "@/components/note/note-title-edit-input";
import { optimisticRenameNote } from "@/components/note/optimistic-rename-note";
import type { SettingsPage } from "@/components/settings/settings-dialog";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { NoteTemplateSelect } from "@/components/templates/note-template-select";
import {
	ActiveWorkspaceProvider,
	useActiveWorkspaceId,
} from "@/hooks/use-active-workspace";
import {
	prefetchChatMessagesSnapshot,
	useChatMessagesSnapshot,
} from "@/hooks/use-chat-messages-snapshot";
import { type AuthSession, authClient } from "@/lib/auth-client";
import { getChatId } from "@/lib/chat";
import { clearCachedConvexToken } from "@/lib/convex-token";
import {
	DESKTOP_INBOX_PANEL_WIDTH,
	DESKTOP_MAIN_HEADER_CLASS,
	DESKTOP_MAIN_HEADER_CONTENT_CLASS,
	DESKTOP_MAIN_HEADER_LEADING_CLASS,
} from "@/lib/desktop-chrome";
import { getSidebarViewTitle } from "@/lib/navigation";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const currentMonthFormatter = new Intl.DateTimeFormat(undefined, {
	month: "long",
});

const currentWeekdayFormatter = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
});

const getDelayUntilNextMinute = (now: Date) => {
	const nextMinute = new Date(now);
	nextMinute.setSeconds(60, 0);

	return nextMinute.getTime() - now.getTime();
};

const useCurrentDate = () => {
	const [currentDate, setCurrentDate] = React.useState(() => new Date());

	React.useEffect(() => {
		let timeoutId: number | undefined;
		let intervalId: number | undefined;

		const updateCurrentDate = () => {
			const now = new Date();
			setCurrentDate(now);
		};

		updateCurrentDate();
		timeoutId = window.setTimeout(() => {
			updateCurrentDate();
			intervalId = window.setInterval(updateCurrentDate, 60 * 1000);
		}, getDelayUntilNextMinute(new Date()));

		return () => {
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId);
			}

			if (intervalId !== undefined) {
				window.clearInterval(intervalId);
			}
		};
	}, []);

	return currentDate;
};

const toAppUser = (
	session: AuthSession,
	avatarOverride?: string | null,
): AppUser => ({
	name: session.user.name?.trim() || session.user.email,
	email: session.user.email,
	avatar: avatarOverride ?? session.user.image ?? "",
});

const useAppShellState = ({
	session,
	workspaces,
	initialDesktopMac,
}: {
	session: AuthSession;
	workspaces: Array<WorkspaceRecord>;
	initialDesktopMac: boolean;
}) => {
	const convex = useConvex();
	const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
	const [currentView, setCurrentView] = React.useState<AppView>(() => {
		if (typeof window === "undefined") {
			return "home";
		}

		const initialView = getAppLocationState(new URL(window.location.href)).view;
		return initialView === "inbox" ? "home" : initialView;
	});
	const [inboxOpen, setInboxOpen] = React.useState(() => {
		if (typeof window === "undefined") {
			return false;
		}

		return getAppLocationState(new URL(window.location.href)).view === "inbox";
	});
	const [isDesktopMac, setIsDesktopMac] = React.useState(initialDesktopMac);
	const [settingsOpen, setSettingsOpen] = React.useState(false);
	const [settingsPage, setSettingsPage] =
		React.useState<SettingsPage>("Profile");
	const [automationDialogOpen, setAutomationDialogOpen] = React.useState(false);
	const [editingAutomationId, setEditingAutomationId] =
		React.useState<Id<"automations"> | null>(null);
	const [automationChatId, setAutomationChatId] = React.useState<string | null>(
		null,
	);
	const [isSigningOut, startSignOut] = React.useTransition();
	const [activeWorkspaceId, setActiveWorkspaceId] =
		React.useState<Id<"workspaces"> | null>(() => workspaces[0]?._id ?? null);
	const resolvedActiveWorkspaceId = React.useMemo(() => {
		if (
			activeWorkspaceId &&
			workspaces.some((workspace) => workspace._id === activeWorkspaceId)
		) {
			return activeWorkspaceId;
		}

		return workspaces[0]?._id ?? null;
	}, [activeWorkspaceId, workspaces]);
	const [currentChatId, setCurrentChatId] = React.useState<string | null>(
		() => {
			if (typeof window === "undefined") {
				return null;
			}

			return getAppLocationState(new URL(window.location.href)).chatId;
		},
	);
	const [chatComposerId, setChatComposerId] = React.useState(() => {
		if (typeof window === "undefined") {
			return crypto.randomUUID();
		}

		return (
			getAppLocationState(new URL(window.location.href)).chatId ??
			crypto.randomUUID()
		);
	});
	const [currentNoteId, setCurrentNoteId] = React.useState<Id<"notes"> | null>(
		null,
	);
	const [currentRouteNoteId, setCurrentRouteNoteId] = React.useState<
		string | null
	>(() => {
		if (typeof window === "undefined") {
			return null;
		}

		return getAppLocationState(new URL(window.location.href)).noteIdString;
	});
	const [shouldAutoStartNoteCapture, setShouldAutoStartNoteCapture] =
		React.useState(() => {
			if (typeof window === "undefined") {
				return false;
			}

			return shouldAutoStartNoteCaptureFromUrl(new URL(window.location.href));
		});
	const [
		shouldStopNoteCaptureWhenMeetingEnds,
		setShouldStopNoteCaptureWhenMeetingEnds,
	] = React.useState(() => {
		if (typeof window === "undefined") {
			return false;
		}

		return getAppLocationState(new URL(window.location.href))
			.shouldStopNoteCaptureWhenMeetingEnds;
	});
	const [scheduledAutoStartNoteCaptureAt, setScheduledAutoStartNoteCaptureAt] =
		React.useState<string | null>(() => {
			if (typeof window === "undefined") {
				return null;
			}

			return getAppLocationState(new URL(window.location.href))
				.scheduledAutoStartNoteCaptureAt;
		});
	const [pendingCalendarEvent, setPendingCalendarEvent] =
		React.useState<UpcomingCalendarEvent | null>(() => {
			if (typeof window === "undefined") {
				return null;
			}

			return getAppLocationState(new URL(window.location.href))
				.pendingCalendarEvent;
		});
	const [currentNoteTitle, setCurrentNoteTitle] = React.useState("");
	const [currentNoteEditorActions, setCurrentNoteEditorActions] =
		React.useState<NoteEditorActions | null>(null);
	const [currentNoteCommentsOpener, setCurrentNoteCommentsOpener] =
		React.useState<(() => void) | null>(null);
	const userPreferences = useQuery(
		api.userPreferences.get,
		session?.user && isConvexAuthenticated ? {} : "skip",
	);
	const creatingNoteRef = React.useRef(false);
	const inboxOpenRef = React.useRef(inboxOpen);
	const lastNonSettingsLocationRef = React.useRef(
		getInitialNonSettingsLocation(),
	);
	const user = React.useMemo(
		() => toAppUser(session, userPreferences?.avatarUrl),
		[session, userPreferences?.avatarUrl],
	);
	const currentDate = useCurrentDate();
	const currentDayOfMonth = currentDate.getDate();
	const currentMonthLabel = currentMonthFormatter.format(currentDate);
	const currentWeekdayLabel = currentWeekdayFormatter.format(currentDate);
	const currentDayKey = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;
	const [upcomingCalendarEvents, setUpcomingCalendarEvents] = React.useState<
		UpcomingCalendarEvent[]
	>([]);
	const [upcomingCalendarStatus, setUpcomingCalendarStatus] = React.useState<
		"idle" | "ready" | "not_connected" | "error"
	>("idle");
	const [isLoadingUpcomingCalendarEvents, setIsLoadingUpcomingCalendarEvents] =
		React.useState(false);
	const upcomingCalendarRequestIdRef = React.useRef(0);
	const upcomingCalendarLoadKey = session?.user?.email
		? `${isConvexAuthenticated ? "authenticated" : "unauthenticated"}:${session.user.email}`
		: "anonymous";
	const applyLocationSyncState = React.useCallback(
		(input: {
			chatId: string | null;
			inboxOpen: boolean;
			noteIdString: string | null;
			pendingCalendarEvent: UpcomingCalendarEvent | null;
			scheduledAutoStartNoteCaptureAt: string | null;
			settingsOpen: boolean;
			settingsPage: SettingsPage;
			shouldAutoStartNoteCapture: boolean;
			shouldStopNoteCaptureWhenMeetingEnds: boolean;
			view: AppView;
		}) => {
			setInboxOpen(input.inboxOpen);
			setCurrentView(input.view);
			setCurrentChatId(input.chatId);
			setChatComposerId(
				input.view === "chat"
					? (input.chatId ?? crypto.randomUUID())
					: crypto.randomUUID(),
			);
			setCurrentNoteId(null);
			setCurrentRouteNoteId(input.view === "note" ? input.noteIdString : null);
			setShouldAutoStartNoteCapture(input.shouldAutoStartNoteCapture);
			setShouldStopNoteCaptureWhenMeetingEnds(
				input.shouldStopNoteCaptureWhenMeetingEnds,
			);
			setScheduledAutoStartNoteCaptureAt(input.scheduledAutoStartNoteCaptureAt);
			setPendingCalendarEvent(input.pendingCalendarEvent);
			setCurrentNoteEditorActions(null);
			setCurrentNoteCommentsOpener(null);
			setSettingsPage(input.settingsPage);
			setSettingsOpen(input.settingsOpen);
			setAutomationDialogOpen(false);
			setEditingAutomationId(null);
			setAutomationChatId(null);
		},
		[],
	);

	const clearScheduledAutoStart = React.useCallback(() => {
		setScheduledAutoStartNoteCaptureAt(null);
	}, []);

	const triggerScheduledAutoStart = React.useCallback(() => {
		setShouldAutoStartNoteCapture(true);
		setScheduledAutoStartNoteCaptureAt(null);
	}, []);
	const calendarPreferences = useQuery(
		api.calendarPreferences.get,
		isConvexAuthenticated && resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const notificationPreferences = useQuery(
		api.notificationPreferences.get,
		isConvexAuthenticated && resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const yandexCalendarConnection = useQuery(
		api.appConnections.getYandexCalendar,
		isConvexAuthenticated && resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const calendarVisibilityKey = !resolvedActiveWorkspaceId
		? "no-workspace"
		: calendarPreferences
			? `${calendarPreferences.showGoogleCalendar}:${calendarPreferences.showGoogleDrive}:${calendarPreferences.showYandexCalendar}`
			: "loading";
	const yandexCalendarConnectionKey = yandexCalendarConnection
		? [
				yandexCalendarConnection.sourceId,
				yandexCalendarConnection.status,
				yandexCalendarConnection.email,
				yandexCalendarConnection.serverAddress,
				yandexCalendarConnection.calendarHomePath,
			].join(":")
		: resolvedActiveWorkspaceId
			? "none"
			: "no-workspace";
	const createNote = useMutation(api.notes.create);
	const createNoteFromCalendarEvent = useMutation(
		api.notes.createFromCalendarEvent,
	);
	const saveNote = useMutation(api.notes.save);
	const createWorkspace = useMutation(api.workspaces.create);
	const createAutomation = useMutation(api.automations.create);
	const updateAutomation = useMutation(api.automations.update);
	const runAutomationNow = useMutation(api.automations.runNow);
	const toggleAutomationPaused = useMutation(api.automations.togglePaused);
	const deleteAutomation = useMutation(api.automations.remove);
	const listUpcomingGoogleEvents = useAction(
		api.calendar.listUpcomingGoogleEvents,
	);
	const chats = useQuery(
		api.chats.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const automations = useQuery(
		api.automations.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const notes = useQuery(
		api.notes.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const sharedNotes = useQuery(
		api.notes.listShared,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const {
		messages: selectedChatMessages,
		isLoading: isInitialChatMessagesLoading,
	} = useChatMessagesSnapshot({
		chatId: currentView === "chat" ? currentChatId : null,
		workspaceId: resolvedActiveWorkspaceId,
		enabled: currentView === "chat",
	});
	const normalizedRouteNoteId = useQuery(
		api.notes.normalizeId,
		currentView === "note" && currentRouteNoteId && currentNoteId === null
			? {
					id: currentRouteNoteId,
				}
			: "skip",
	);
	const resolvedCurrentNoteId = currentNoteId ?? normalizedRouteNoteId ?? null;
	const isResolvingCurrentNoteRouteId =
		currentView === "note" &&
		currentRouteNoteId !== null &&
		currentNoteId === null &&
		normalizedRouteNoteId === undefined;
	const hasInvalidCurrentNoteRoute =
		currentView === "note" &&
		currentRouteNoteId !== null &&
		currentNoteId === null &&
		normalizedRouteNoteId === null;
	const listedSelectedNote =
		currentView === "note" && resolvedCurrentNoteId
			? (notes?.find((note) => note._id === resolvedCurrentNoteId) ??
				(notes === undefined ? undefined : null))
			: undefined;
	const selectedNote = useQuery(
		api.notes.get,
		currentView === "note" &&
			!hasInvalidCurrentNoteRoute &&
			resolvedCurrentNoteId &&
			resolvedActiveWorkspaceId
			? {
					workspaceId: resolvedActiveWorkspaceId,
					id: resolvedCurrentNoteId,
				}
			: "skip",
	);
	const resolvedSelectedNote = selectedNote ?? listedSelectedNote;
	const isResolvingCurrentNote =
		isResolvingCurrentNoteRouteId ||
		(currentView === "note" &&
			resolvedCurrentNoteId !== null &&
			resolvedSelectedNote === undefined);
	const hasMissingCurrentNote =
		currentView === "note" &&
		resolvedCurrentNoteId !== null &&
		resolvedSelectedNote === null;
	const resolvedCurrentView =
		hasInvalidCurrentNoteRoute || hasMissingCurrentNote
			? "notFound"
			: currentView;

	const refreshUpcomingCalendarEvents = React.useEffectEvent(
		async (
			dayKey: string,
			options?: {
				resetState?: boolean;
			},
		) => {
			const shouldResetState = options?.resetState ?? true;
			const requestId = upcomingCalendarRequestIdRef.current + 1;
			upcomingCalendarRequestIdRef.current = requestId;

			if (
				!resolvedActiveWorkspaceId ||
				!session?.user?.email ||
				!isConvexAuthenticated
			) {
				if (upcomingCalendarRequestIdRef.current !== requestId) {
					return;
				}

				setUpcomingCalendarEvents([]);
				setUpcomingCalendarStatus("not_connected");
				setIsLoadingUpcomingCalendarEvents(false);
				return;
			}

			if (shouldResetState) {
				setUpcomingCalendarEvents([]);
				setUpcomingCalendarStatus("idle");
			}
			setIsLoadingUpcomingCalendarEvents(true);

			try {
				const result = await listUpcomingGoogleEvents({
					workspaceId: resolvedActiveWorkspaceId,
					...getDayWindowFromDayKey(dayKey),
				});

				if (upcomingCalendarRequestIdRef.current !== requestId) {
					return;
				}

				if (result.status === "not_connected") {
					setUpcomingCalendarEvents([]);
					setUpcomingCalendarStatus("not_connected");
					return;
				}

				setUpcomingCalendarEvents(result.events);
				setUpcomingCalendarStatus("ready");
			} catch (error) {
				if (upcomingCalendarRequestIdRef.current !== requestId) {
					return;
				}

				console.error("Failed to load upcoming calendar events", error);
				setUpcomingCalendarEvents([]);
				setUpcomingCalendarStatus("error");
			} finally {
				if (upcomingCalendarRequestIdRef.current === requestId) {
					setIsLoadingUpcomingCalendarEvents(false);
				}
			}
		},
	);

	React.useEffect(() => {
		void calendarVisibilityKey;
		void yandexCalendarConnectionKey;

		if (upcomingCalendarLoadKey === "anonymous") {
			void refreshUpcomingCalendarEvents(currentDayKey);
			return;
		}

		void refreshUpcomingCalendarEvents(currentDayKey);
	}, [
		calendarVisibilityKey,
		currentDayKey,
		upcomingCalendarLoadKey,
		yandexCalendarConnectionKey,
	]);

	React.useEffect(() => {
		void setDesktopActiveWorkspaceId(resolvedActiveWorkspaceId);
	}, [resolvedActiveWorkspaceId]);

	React.useEffect(() => {
		void setDesktopActiveWorkspaceNotificationPreferences({
			workspaceId: resolvedActiveWorkspaceId,
			notifyForScheduledMeetings:
				notificationPreferences?.notifyForScheduledMeetings ?? false,
			notifyForAutoDetectedMeetings:
				notificationPreferences?.notifyForAutoDetectedMeetings ?? true,
		});
	}, [
		notificationPreferences?.notifyForAutoDetectedMeetings,
		notificationPreferences?.notifyForScheduledMeetings,
		resolvedActiveWorkspaceId,
	]);

	React.useEffect(() => {
		void calendarVisibilityKey;
		void yandexCalendarConnectionKey;

		if (upcomingCalendarLoadKey === "anonymous") {
			return;
		}

		const handleFocus = () => {
			void refreshUpcomingCalendarEvents(currentDayKey, {
				resetState: false,
			});
		};

		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [
		calendarVisibilityKey,
		currentDayKey,
		upcomingCalendarLoadKey,
		yandexCalendarConnectionKey,
	]);

	React.useEffect(() => {
		if (workspaces.some((workspace) => workspace._id === activeWorkspaceId)) {
			return;
		}

		setActiveWorkspaceId(workspaces[0]?._id ?? null);
	}, [activeWorkspaceId, workspaces]);

	const handleWorkspaceCreate = React.useCallback(
		async (input: { name: string }) => {
			const workspace = await createWorkspace(input);
			setActiveWorkspaceId(workspace._id);
			return workspace;
		},
		[createWorkspace],
	);

	React.useEffect(() => {
		const syncViewFromLocation = () => {
			const url = new URL(window.location.href);
			const nextSettingsPage =
				getSettingsPageFromPath(url.pathname) ??
				(url.hash === "#settings" ? "Profile" : null);
			const nextSettingsOpen = nextSettingsPage !== null;

			if (!nextSettingsOpen) {
				lastNonSettingsLocationRef.current = `${url.pathname}${url.search}${url.hash}`;
			}

			const contentUrl = nextSettingsOpen
				? new URL(lastNonSettingsLocationRef.current, url.origin)
				: url;
			const nextLocationState = getAppLocationState(contentUrl);
			const nextChatId = nextLocationState.chatId;
			const nextInboxOpen =
				nextLocationState.view === "inbox" ||
				(inboxOpenRef.current && readDesktopInboxPanelPinnedState());
			const nextView = nextInboxOpen ? "home" : nextLocationState.view;
			const nextNoteIdString = nextLocationState.noteIdString;
			const nextShouldAutoStartNoteCapture =
				nextLocationState.shouldAutoStartNoteCapture;
			const nextShouldStopNoteCaptureWhenMeetingEnds =
				nextLocationState.shouldStopNoteCaptureWhenMeetingEnds;
			const nextScheduledAutoStartNoteCaptureAt =
				nextLocationState.scheduledAutoStartNoteCaptureAt;

			applyLocationSyncState({
				chatId: nextChatId,
				inboxOpen: nextInboxOpen,
				noteIdString: nextNoteIdString,
				pendingCalendarEvent: nextLocationState.pendingCalendarEvent,
				scheduledAutoStartNoteCaptureAt: nextScheduledAutoStartNoteCaptureAt,
				settingsOpen: nextSettingsOpen,
				settingsPage: nextSettingsPage ?? "Profile",
				shouldAutoStartNoteCapture: nextShouldAutoStartNoteCapture,
				shouldStopNoteCaptureWhenMeetingEnds:
					nextShouldStopNoteCaptureWhenMeetingEnds,
				view: nextView,
			});

			const nextPath = nextSettingsOpen
				? getSettingsPath(nextSettingsPage ?? "Profile")
				: nextInboxOpen
					? "/home"
					: nextLocationState.canonicalPath;
			const nextSearch = nextSettingsOpen
				? ""
				: nextInboxOpen
					? ""
					: nextLocationState.canonicalSearch;
			const nextHash = "";
			if (
				nextPath &&
				(window.location.pathname !== nextPath ||
					window.location.search !== nextSearch ||
					window.location.hash !== nextHash)
			) {
				window.history.replaceState(
					null,
					"",
					`${nextPath}${nextSearch}${nextHash}`,
				);
			}
		};

		syncViewFromLocation();
		window.addEventListener("popstate", syncViewFromLocation);

		return () => {
			window.removeEventListener("popstate", syncViewFromLocation);
		};
	}, [applyLocationSyncState]);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		return onDesktopNavigate((navigation) => {
			const nextLocation = `${navigation.pathname}${navigation.search}${navigation.hash}`;

			if (
				window.location.pathname === navigation.pathname &&
				window.location.search === navigation.search &&
				window.location.hash === navigation.hash
			) {
				return;
			}

			window.history.pushState(null, "", nextLocation);
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
	}, []);

	React.useEffect(() => {
		if (resolvedSelectedNote) {
			setCurrentNoteTitle(resolvedSelectedNote.title);
			return;
		}

		if (resolvedCurrentView === "note") {
			setCurrentNoteTitle("");
		}
	}, [resolvedCurrentView, resolvedSelectedNote]);

	React.useEffect(() => {
		void getDesktopMeta()
			.then((meta) => {
				if (meta) {
					setIsDesktopMac(meta.platform === "darwin");
				}
			})
			.catch(() => {
				setIsDesktopMac(false);
			});
	}, []);

	const shouldKeepPinnedInboxOpen = React.useCallback(
		() => inboxOpen && readDesktopInboxPanelPinnedState(),
		[inboxOpen],
	);

	React.useEffect(() => {
		inboxOpenRef.current = inboxOpen;
	}, [inboxOpen]);

	const openFreshChat = React.useCallback(() => {
		React.startTransition(() => {
			setInboxOpen(shouldKeepPinnedInboxOpen());
			setCurrentView("chat");
			setSettingsOpen(false);
			setCurrentChatId(null);
			setChatComposerId(crypto.randomUUID());
			window.history.pushState(null, "", "/chat");
		});
	}, [shouldKeepPinnedInboxOpen]);

	const openStoredChat = React.useCallback(
		(chatId: string) => {
			React.startTransition(() => {
				setInboxOpen(shouldKeepPinnedInboxOpen());
				setCurrentView("chat");
				setSettingsOpen(false);
				setCurrentChatId(chatId);
				setChatComposerId(chatId);
				window.history.pushState(
					null,
					"",
					`/chat?chatId=${encodeURIComponent(chatId)}`,
				);
			});
		},
		[shouldKeepPinnedInboxOpen],
	);

	const editingAutomation = React.useMemo(
		() =>
			editingAutomationId
				? ((automations ?? []).find(
						(automation) => automation.id === editingAutomationId,
					) ?? null)
				: null,
		[automations, editingAutomationId],
	);
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const currentChatHasAutomation = currentChatId
		? automationChatIds.has(currentChatId)
		: false;

	const handleAutomationDialogOpenChange = React.useCallback(
		(open: boolean) => {
			setAutomationDialogOpen(open);
			if (!open) {
				setEditingAutomationId(null);
				setAutomationChatId(null);
			}
		},
		[],
	);

	const handleCreateAutomationOpen = React.useCallback(() => {
		setEditingAutomationId(null);
		setAutomationChatId(null);
		setAutomationDialogOpen(true);
	}, []);

	const handleCreateChatAutomationOpen = React.useCallback(
		(chatId: string) => {
			const existingAutomation = (automations ?? []).find(
				(automation) => automation.chatId === chatId,
			);

			if (existingAutomation) {
				setAutomationChatId(null);
				setEditingAutomationId(existingAutomation.id);
			} else {
				setEditingAutomationId(null);
				setAutomationChatId(chatId);
			}

			setAutomationDialogOpen(true);
		},
		[automations],
	);

	const handleEditAutomationOpen = React.useCallback(
		(automationId: Id<"automations">) => {
			setAutomationChatId(null);
			setEditingAutomationId(automationId);
			setAutomationDialogOpen(true);
		},
		[],
	);

	const handleAutomationSave = React.useCallback(
		async (automation: AutomationDraft) => {
			if (!resolvedActiveWorkspaceId) {
				toast.error("Select a workspace before creating an automation");
				return;
			}

			const target =
				automation.target.kind === "notes"
					? {
							kind: "notes" as const,
							noteIds: automation.target.noteIds,
						}
					: {
							kind: "workspace" as const,
						};
			const input = {
				title: automation.title,
				prompt: automation.prompt,
				model: automation.model,
				reasoningEffort: automation.reasoningEffort,
				webSearchEnabled: automation.webSearchEnabled,
				appsEnabled: automation.appsEnabled,
				appSources: automation.appSources,
				schedulePeriod: automation.schedulePeriod,
				scheduledAt: automation.scheduledAt,
				timezone: automation.timezone,
				target,
			};

			try {
				if (editingAutomationId) {
					await updateAutomation({
						automationId: editingAutomationId,
						...input,
					});
					toast.success("Automation updated");
				} else {
					await createAutomation({
						workspaceId: resolvedActiveWorkspaceId,
						chatId: automationChatId ?? undefined,
						...input,
					});
					toast.success("Automation created");
				}

				setAutomationDialogOpen(false);
				setEditingAutomationId(null);
				setAutomationChatId(null);
			} catch (error) {
				console.error("Failed to save automation", error);
				toast.error("Failed to save automation");
			}
		},
		[
			createAutomation,
			automationChatId,
			editingAutomationId,
			resolvedActiveWorkspaceId,
			updateAutomation,
		],
	);

	const handleOpenAutomation = React.useCallback(
		(automation: AutomationListItem) => {
			openStoredChat(automation.chatId);
		},
		[openStoredChat],
	);

	const handleRunAutomationNow = React.useCallback(
		async (automationId: Id<"automations">) => {
			try {
				const result = await runAutomationNow({ automationId });
				openStoredChat(result.chatId);
			} catch (error) {
				console.error("Failed to run automation", error);
				toast.error("Failed to run automation");
			}
		},
		[openStoredChat, runAutomationNow],
	);

	const handleToggleAutomationPaused = React.useCallback(
		async (automationId: Id<"automations">) => {
			try {
				const automation = await toggleAutomationPaused({ automationId });
				toast.success(
					automation.isPaused ? "Automation paused" : "Automation resumed",
				);
			} catch (error) {
				console.error("Failed to update automation", error);
				toast.error("Failed to update automation");
			}
		},
		[toggleAutomationPaused],
	);

	const handleDeleteAutomation = React.useCallback(
		async (automationId: Id<"automations">) => {
			try {
				await deleteAutomation({ automationId });
				toast.success("Automation deleted");
			} catch (error) {
				console.error("Failed to delete automation", error);
				toast.error("Failed to delete automation");
			}
		},
		[deleteAutomation],
	);

	const handleViewChange = React.useCallback(
		(view: AppView) => {
			if (view === "inbox") {
				setInboxOpen(true);
				setSettingsOpen(false);
				setAutomationDialogOpen(false);
				setEditingAutomationId(null);
				return;
			}

			if (view === "chat") {
				openFreshChat();
				return;
			}

			setInboxOpen(shouldKeepPinnedInboxOpen());
			setCurrentView(view);
			setSettingsOpen(false);
			setAutomationDialogOpen(false);
			setEditingAutomationId(null);
			setCurrentNoteEditorActions(null);
			setCurrentNoteCommentsOpener(null);
			const search =
				view === "note" && resolvedCurrentNoteId
					? `?noteId=${resolvedCurrentNoteId}`
					: "";
			window.history.pushState(
				null,
				"",
				view === "note"
					? `/note${search}`
					: view === "automation"
						? "/automations"
						: view === "shared"
							? "/shared"
							: "/home",
			);
		},
		[openFreshChat, resolvedCurrentNoteId, shouldKeepPinnedInboxOpen],
	);

	const handleInboxOpenChange = React.useCallback((open: boolean) => {
		setInboxOpen(open);
		if (open) {
			setSettingsOpen(false);
		}
	}, []);

	const handlePrefetchNote = React.useCallback(
		(_noteId: Id<"notes">) => {},
		[],
	);

	const openNote = React.useCallback(
		(
			noteId: Id<"notes">,
			options?: {
				autoStartCapture?: boolean;
				scheduledAutoStartAt?: string | null;
				stopCaptureWhenMeetingEnds?: boolean;
			},
		) => {
			handlePrefetchNote(noteId);
			setInboxOpen(shouldKeepPinnedInboxOpen());
			setCurrentView("note");
			setSettingsOpen(false);
			setCurrentNoteId(noteId);
			setCurrentRouteNoteId(noteId);
			setShouldAutoStartNoteCapture(options?.autoStartCapture === true);
			setShouldStopNoteCaptureWhenMeetingEnds(
				options?.stopCaptureWhenMeetingEnds === true,
			);
			setScheduledAutoStartNoteCaptureAt(
				options?.scheduledAutoStartAt?.trim() || null,
			);
			setPendingCalendarEvent(null);
			setCurrentNoteEditorActions(null);
			setCurrentNoteCommentsOpener(null);
			window.history.pushState(
				null,
				"",
				`/note${createNoteSearch({
					autoStartCapture: options?.autoStartCapture === true,
					noteId,
					scheduledAutoStartAt: options?.scheduledAutoStartAt,
					stopCaptureWhenMeetingEnds:
						options?.stopCaptureWhenMeetingEnds === true,
				})}`,
			);
		},
		[handlePrefetchNote, shouldKeepPinnedInboxOpen],
	);

	const handleCreateNote = React.useCallback(
		(options?: {
			autoStartCapture?: boolean;
			calendarEvent?: UpcomingCalendarEvent | null;
			stopCaptureWhenMeetingEnds?: boolean;
		}) => {
			if (creatingNoteRef.current) {
				return;
			}

			creatingNoteRef.current = true;
			const shouldStartCapture = options?.autoStartCapture === true;
			const shouldStopCaptureWhenMeetingEnds =
				options?.stopCaptureWhenMeetingEnds === true;
			const calendarEvent = options?.calendarEvent ?? null;
			const scheduledAutoStartAt =
				!shouldStartCapture && calendarEvent ? calendarEvent.startAt : null;

			if (!resolvedActiveWorkspaceId) {
				creatingNoteRef.current = false;
				return;
			}

			const createNotePromise = calendarEvent
				? createNoteFromCalendarEvent({
						workspaceId: resolvedActiveWorkspaceId,
						calendarEventKey: createCalendarEventKey(calendarEvent),
						title: calendarEvent.title.trim(),
						content: buildCalendarEventNoteDocument({
							currentDate,
							event: calendarEvent,
						}),
						searchableText: buildCalendarEventSearchableText({
							currentDate,
							event: calendarEvent,
						}),
					})
				: createNote({ workspaceId: resolvedActiveWorkspaceId });

			void createNotePromise
				.then((noteId) => {
					setCurrentNoteTitle(calendarEvent?.title.trim() || "");
					openNote(noteId, {
						autoStartCapture: shouldStartCapture,
						scheduledAutoStartAt,
						stopCaptureWhenMeetingEnds: shouldStopCaptureWhenMeetingEnds,
					});
				})
				.catch((error) => {
					console.error("Failed to create note", error);
				})
				.finally(() => {
					creatingNoteRef.current = false;
				});
		},
		[
			createNote,
			createNoteFromCalendarEvent,
			currentDate,
			openNote,
			resolvedActiveWorkspaceId,
		],
	);

	const handleQuickNote = React.useCallback(() => {
		setCurrentView("note");
		setSettingsOpen(false);
		setCurrentNoteId(null);
		setCurrentRouteNoteId(null);
		setShouldAutoStartNoteCapture(true);
		setShouldStopNoteCaptureWhenMeetingEnds(false);
		setScheduledAutoStartNoteCaptureAt(null);
		setPendingCalendarEvent(null);
		setCurrentNoteEditorActions(null);
		setCurrentNoteCommentsOpener(null);
		window.history.pushState(null, "", "/note?capture=1");
	}, []);

	const handleCreateNoteFromChatResponse = React.useCallback(
		async (title: string, content: string) => {
			if (!resolvedActiveWorkspaceId || creatingNoteRef.current) {
				return undefined;
			}

			creatingNoteRef.current = true;
			const nextTitle = title.trim() || "New note";
			const nextContent = content.trim();

			try {
				const noteId = await saveNote({
					workspaceId: resolvedActiveWorkspaceId,
					title: nextTitle,
					content: nextContent,
					searchableText: nextContent,
				});
				setCurrentNoteTitle(nextTitle);
				openNote(noteId);
				return "created" as const;
			} catch (error) {
				console.error("Failed to create note from chat response", error);
				return undefined;
			} finally {
				creatingNoteRef.current = false;
			}
		},
		[openNote, resolvedActiveWorkspaceId, saveNote],
	);

	const handleAutoStartNoteCaptureHandled = React.useCallback(() => {
		setShouldAutoStartNoteCapture(false);
		setShouldStopNoteCaptureWhenMeetingEnds(false);
		setScheduledAutoStartNoteCaptureAt(null);

		if (resolvedCurrentView !== "note" || !resolvedCurrentNoteId) {
			return;
		}

		window.history.replaceState(
			null,
			"",
			`/note?noteId=${resolvedCurrentNoteId}`,
		);
	}, [resolvedCurrentNoteId, resolvedCurrentView]);

	React.useEffect(() => {
		if (
			resolvedCurrentView === "note" &&
			!resolvedCurrentNoteId &&
			currentRouteNoteId === null
		) {
			handleCreateNote({
				autoStartCapture: shouldAutoStartNoteCapture,
				calendarEvent: pendingCalendarEvent,
				stopCaptureWhenMeetingEnds: shouldStopNoteCaptureWhenMeetingEnds,
			});
		}
	}, [
		currentRouteNoteId,
		handleCreateNote,
		pendingCalendarEvent,
		resolvedCurrentNoteId,
		resolvedCurrentView,
		shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds,
	]);

	React.useEffect(() => {
		if (
			resolvedCurrentView !== "note" ||
			!resolvedCurrentNoteId ||
			shouldAutoStartNoteCapture ||
			!scheduledAutoStartNoteCaptureAt
		) {
			return;
		}

		const scheduledAt = new Date(scheduledAutoStartNoteCaptureAt).getTime();

		if (Number.isNaN(scheduledAt)) {
			clearScheduledAutoStart();
			return;
		}

		if (scheduledAt <= Date.now()) {
			triggerScheduledAutoStart();
			return;
		}

		const timeoutId = window.setTimeout(() => {
			triggerScheduledAutoStart();
		}, scheduledAt - Date.now());

		return () => window.clearTimeout(timeoutId);
	}, [
		clearScheduledAutoStart,
		resolvedCurrentNoteId,
		resolvedCurrentView,
		scheduledAutoStartNoteCaptureAt,
		shouldAutoStartNoteCapture,
		triggerScheduledAutoStart,
	]);

	const handleOpenCalendarEventNote = React.useCallback(
		(
			event: UpcomingCalendarEvent,
			options?: {
				autoStartCapture?: boolean;
				stopCaptureWhenMeetingEnds?: boolean;
			},
		) => {
			handleCreateNote({
				autoStartCapture: options?.autoStartCapture,
				calendarEvent: event,
				stopCaptureWhenMeetingEnds: options?.stopCaptureWhenMeetingEnds ?? true,
			});
		},
		[handleCreateNote],
	);

	const handleSettingsOpenChange = React.useCallback(
		(open: boolean, page: SettingsPage = "Profile") => {
			setSettingsOpen(open);
			if (!open) {
				setSettingsPage("Profile");
				const nextLocation = lastNonSettingsLocationRef.current || "/home";
				window.history.pushState(null, "", nextLocation);
				return;
			}

			setInboxOpen(false);
			const currentUrl = new URL(window.location.href);
			if (getSettingsPageFromPath(currentUrl.pathname) === null) {
				lastNonSettingsLocationRef.current = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
			}

			setSettingsPage(page);
			window.history.pushState(null, "", getSettingsPath(page));
		},
		[],
	);

	React.useEffect(() => {
		if (typeof window === "undefined" || !isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key !== "," && event.code !== "Comma")
			) {
				return;
			}

			event.preventDefault();
			handleSettingsOpenChange(true, "Profile");
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleSettingsOpenChange]);

	React.useEffect(() => {
		if (typeof window === "undefined" || !isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				!/^[1-9]$/.test(event.key)
			) {
				return;
			}

			const workspace = workspaces[Number(event.key) - 1];
			if (!workspace || workspace._id === resolvedActiveWorkspaceId) {
				return;
			}

			event.preventDefault();
			setActiveWorkspaceId(workspace._id);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [resolvedActiveWorkspaceId, workspaces]);

	const handleOpenCalendarSettings = React.useCallback(() => {
		handleSettingsOpenChange(true, "Calendar");
	}, [handleSettingsOpenChange]);

	const handleSignOut = React.useCallback(() => {
		startSignOut(async () => {
			try {
				clearCachedConvexToken();
				await authClient.signOut();
			} catch (error) {
				console.error("Failed to sign out", error);
			}
		});
	}, []);

	const handleNoteTrashed = React.useCallback(
		(noteId: Id<"notes">) => {
			if (noteId !== resolvedCurrentNoteId) {
				return;
			}

			setCurrentNoteId(null);
			setCurrentRouteNoteId(null);
			setCurrentNoteTitle("");
			setCurrentNoteEditorActions(null);
			setCurrentNoteCommentsOpener(null);
			handleViewChange("home");
		},
		[handleViewChange, resolvedCurrentNoteId],
	);
	const handlePrefetchChat = React.useCallback(
		(chatId: string) => {
			if (!resolvedActiveWorkspaceId) {
				return;
			}

			void prefetchChatMessagesSnapshot({
				chatId,
				convex,
				workspaceId: resolvedActiveWorkspaceId,
			}).catch((error) => {
				console.error("Failed to prefetch chat messages snapshot", error);
			});
		},
		[convex, resolvedActiveWorkspaceId],
	);
	const handleOpenChat = React.useCallback(
		(chatId: string) => {
			handlePrefetchChat(chatId);
			openStoredChat(chatId);
		},
		[handlePrefetchChat, openStoredChat],
	);

	const handleNewChat = React.useCallback(() => {
		openFreshChat();
	}, [openFreshChat]);

	const handleChatPersisted = React.useCallback(
		(chatId: string) => {
			if (currentChatId === chatId) {
				return;
			}

			setCurrentChatId(chatId);
			window.history.replaceState(
				null,
				"",
				`/chat?chatId=${encodeURIComponent(chatId)}`,
			);
		},
		[currentChatId],
	);
	const handleChatRemoved = React.useCallback(
		(chatId: string) => {
			if (currentChatId !== chatId) {
				return;
			}

			const nextChatId = crypto.randomUUID();
			setCurrentChatId(null);
			setChatComposerId(nextChatId);
			window.history.replaceState(null, "", "/chat");
		},
		[currentChatId],
	);
	const currentChat =
		chats?.find((chat) => getChatId(chat) === currentChatId) ?? null;
	const currentChatTitle = currentChat?.title || "Chat";
	const automationChatTitle = automationChatId
		? (chats?.find((chat) => getChatId(chat) === automationChatId)?.title ?? "")
		: "";
	const currentChatNoteId = currentChat?.noteId ?? null;
	const isSharedNote =
		resolvedCurrentView === "note" &&
		(resolvedSelectedNote?.visibility === "public" ||
			sharedNotes?.some((note) => note._id === resolvedCurrentNoteId) === true);
	const initialChatMessages = React.useMemo(
		() => toStoredChatMessages(selectedChatMessages ?? []),
		[selectedChatMessages],
	);

	return {
		activeWorkspaceId: resolvedActiveWorkspaceId,
		breadcrumbDetailLabel:
			resolvedCurrentView === "notFound"
				? null
				: resolvedCurrentView === "note" && !isResolvingCurrentNote
					? getNoteDisplayTitle(currentNoteTitle)
					: resolvedCurrentView === "chat" && currentChatId
						? currentChatTitle
						: null,
		breadcrumbSectionLabel:
			resolvedCurrentView === "notFound"
				? "Page Not Found"
				: resolvedCurrentView === "chat"
					? getSidebarViewTitle("chat")
					: resolvedCurrentView === "automation"
						? getSidebarViewTitle("automation")
						: resolvedCurrentView === "shared" || isSharedNote
							? getSidebarViewTitle("shared")
							: getSidebarViewTitle("home"),
		chats,
		chatComposerId,
		currentChat,
		currentChatId,
		currentChatNoteId,
		currentChatTitle,
		currentDate,
		currentDayOfMonth,
		currentMonthLabel,
		currentNoteCommentsOpener,
		currentNoteEditorActions,
		currentNoteId: resolvedCurrentNoteId,
		currentNoteTemplateSlug: resolvedSelectedNote?.templateSlug ?? null,
		currentNoteTitle,
		currentView: resolvedCurrentView,
		currentWeekdayLabel,
		handleAutoStartNoteCaptureHandled,
		handleBreadcrumbSectionClick: () => {
			if (resolvedCurrentView === "notFound") {
				handleViewChange("home");
				return;
			}

			if (resolvedCurrentView === "chat") {
				openFreshChat();
				return;
			}

			if (resolvedCurrentView === "automation") {
				handleViewChange("automation");
				return;
			}

			handleViewChange(
				resolvedCurrentView === "shared" || isSharedNote ? "shared" : "home",
			);
		},
		handleChatPersisted,
		handleChatRemoved,
		handleCreateNote,
		handleCreateNoteFromChatResponse,
		handleCreateAutomationOpen,
		handleCreateChatAutomationOpen,
		handleEditAutomationOpen,
		handleOpenAutomation,
		handleInboxOpenChange,
		handleNewChat,
		handleNoteTrashed,
		handleDeleteAutomation,
		handleOpenCalendarEventNote,
		handleOpenCalendarSettings,
		handleOpenChat,
		handlePrefetchChat,
		handlePrefetchNote,
		handleQuickNote,
		handleRunAutomationNow,
		handleSettingsOpenChange,
		handleSignOut,
		handleToggleAutomationPaused,
		handleViewChange,
		handleWorkspaceCreate,
		inboxOpen,
		initialChatMessages,
		isInitialChatMessagesLoading,
		automationDialogOpen,
		automations,
		automationChatTitle,
		currentChatHasAutomation,
		editingAutomation,
		isDesktopMac,
		isLoadingUpcomingCalendarEvents,
		isResolvingCurrentNoteRoute: isResolvingCurrentNote,
		isSharedNote,
		isSigningOut,
		notes,
		openNote,
		selectedNote: resolvedSelectedNote,
		settingsOpen,
		settingsPage,
		setActiveWorkspaceId,
		handleAutomationDialogOpenChange,
		setCurrentNoteCommentsOpener,
		setCurrentNoteEditorActions,
		setCurrentNoteTitle,
		sharedNotes,
		shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds,
		handleAutomationSave,
		upcomingCalendarEvents,
		upcomingCalendarStatus,
		user,
		workspaces,
	};
};

type AppShellHeaderProps = {
	isDesktopMac: boolean;
	inboxOpen: boolean;
	breadcrumbSectionLabel: string;
	breadcrumbDetailLabel: string | null;
	onBreadcrumbSectionClick: () => void;
	currentView: AppView;
	currentChatId: string | null;
	currentChat: Doc<"chats"> | null;
	currentChatTitle: string;
	currentChatNoteId: Id<"notes"> | null;
	currentChatHasAutomation: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentNoteTemplateSlug: string | null;
	currentNoteEditorActions: NoteEditorActions | null;
	currentNoteCommentsOpener: (() => void) | null;
	onCreateNote: () => void;
	onNoteTitleChange: (title: string) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	onChatTrashed: (chatId: string) => void;
	onNewChat: () => void;
	onNewAutomation: () => void;
	onNewChatAutomation: (chatId: string) => void;
};

function AppShellHeader({
	isDesktopMac,
	inboxOpen,
	breadcrumbSectionLabel,
	breadcrumbDetailLabel,
	onBreadcrumbSectionClick,
	currentView,
	currentChatId,
	currentChat,
	currentChatTitle,
	currentChatNoteId,
	currentChatHasAutomation,
	currentNoteId,
	currentNoteTitle,
	currentNoteTemplateSlug,
	currentNoteEditorActions,
	currentNoteCommentsOpener,
	onCreateNote,
	onNoteTitleChange,
	onNoteTrashed,
	onChatTrashed,
	onNewChat,
	onNewAutomation,
	onNewChatAutomation,
}: AppShellHeaderProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const { isMobile, state: sidebarState } = useSidebarShell();
	const { leftInsetPanelWidth, leftOverlayPanelWidth } = useDockedPanelWidths();
	const currentEditableTitle =
		currentView === "note"
			? currentNoteTitle
			: currentView === "chat"
				? currentChatTitle
				: "";
	const breadcrumbRenameInitialTitleRef = React.useRef(currentEditableTitle);
	const breadcrumbRenameSavedTitleRef = React.useRef(currentEditableTitle);
	const [titleEditOpen, setTitleEditOpen] = React.useState(false);
	const [titleValue, setTitleValue] = React.useState("");
	const [isRenamingTitle, setIsRenamingTitle] = React.useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const renameNote = useMutation(api.notes.rename).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameNote(localStore, args.workspaceId, args.id, args.title);
		},
	);
	const renameChat = useMutation(api.chats.updateTitle).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameChat(
				localStore,
				args.workspaceId,
				args.chatId,
				args.title,
				currentChatNoteId ?? undefined,
			);
		},
	);
	const canRenameCurrentItem =
		(currentView === "note" && currentNoteId !== null) ||
		(currentView === "chat" && currentChatId !== null);
	const renameItemLabel = currentView === "chat" ? "chat" : "note";
	const titleEditPlaceholder = currentView === "chat" ? "New chat" : "New note";

	React.useEffect(() => {
		if (titleEditOpen) {
			return;
		}

		breadcrumbRenameSavedTitleRef.current = currentEditableTitle;
		setTitleValue(currentEditableTitle);
	}, [currentEditableTitle, titleEditOpen]);

	const commitBreadcrumbRename = React.useCallback(async () => {
		if (!activeWorkspaceId || !canRenameCurrentItem || isRenamingTitle) {
			return;
		}

		const nextTitle = titleValue.trim();
		const currentTitle = breadcrumbRenameSavedTitleRef.current.trim();

		if (nextTitle === currentTitle) {
			setTitleEditOpen(false);
			setTitleValue(nextTitle);
			return;
		}

		setIsRenamingTitle(true);

		try {
			if (currentView === "note" && currentNoteId) {
				await renameNote({
					workspaceId: activeWorkspaceId,
					id: currentNoteId,
					title: nextTitle,
				});
			} else if (currentView === "chat" && currentChatId) {
				await renameChat({
					workspaceId: activeWorkspaceId,
					chatId: currentChatId,
					title: nextTitle,
				});
			} else {
				return;
			}

			breadcrumbRenameInitialTitleRef.current = nextTitle;
			breadcrumbRenameSavedTitleRef.current = nextTitle;
			setTitleEditOpen(false);
			setTitleValue(nextTitle);
			toast.success(currentView === "chat" ? "Chat renamed" : "Note renamed");
		} catch (error) {
			console.error(`Failed to rename ${renameItemLabel}`, error);
			toast.error(
				currentView === "chat"
					? "Failed to rename chat"
					: "Failed to rename note",
			);
		} finally {
			setIsRenamingTitle(false);
		}
	}, [
		activeWorkspaceId,
		canRenameCurrentItem,
		currentChatId,
		currentNoteId,
		currentView,
		isRenamingTitle,
		renameChat,
		renameNote,
		renameItemLabel,
		titleValue,
	]);

	const handleBreadcrumbTitleEditOpenChange = React.useCallback(
		(open: boolean) => {
			if (open) {
				breadcrumbRenameInitialTitleRef.current = currentEditableTitle;
				breadcrumbRenameSavedTitleRef.current = currentEditableTitle;
				setTitleEditOpen(true);
				return;
			}

			void commitBreadcrumbRename();
		},
		[commitBreadcrumbRename, currentEditableTitle],
	);

	const openBreadcrumbTitleEditor = React.useCallback(() => {
		breadcrumbRenameInitialTitleRef.current = currentEditableTitle;
		breadcrumbRenameSavedTitleRef.current = currentEditableTitle;
		setTitleEditOpen(true);
	}, [currentEditableTitle]);

	return (
		<header
			className={cn(
				"sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between bg-background/95 px-4 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 md:px-6 relative",
				isDesktopMac && DESKTOP_MAIN_HEADER_CLASS,
			)}
		>
			{isDesktopMac ? (
				<div
					aria-hidden="true"
					data-app-region="drag"
					className="absolute inset-y-0 right-0"
					style={{
						left:
							!inboxOpen || leftInsetPanelWidth
								? 0
								: (leftOverlayPanelWidth ?? DESKTOP_INBOX_PANEL_WIDTH),
					}}
				/>
			) : null}
			<div
				className={cn(
					"relative z-10 flex min-w-0 flex-1 items-center gap-2 pr-4",
					isDesktopMac && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
					isDesktopMac && isMobile && DESKTOP_MAIN_HEADER_LEADING_CLASS,
					isDesktopMac && isMobile && "mt-1",
					isDesktopMac &&
						sidebarState === "collapsed" &&
						DESKTOP_MAIN_HEADER_LEADING_CLASS,
				)}
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<SidebarTrigger
							data-app-region={isDesktopMac ? "no-drag" : undefined}
						/>
					</TooltipTrigger>
					<TooltipContent side="bottom" align="start" sideOffset={8}>
						<div className="flex items-center gap-2">
							<span>Toggle sidebar</span>
							<kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
								<span className="text-xs">⌘</span>B
							</kbd>
						</div>
					</TooltipContent>
				</Tooltip>
				<Separator
					orientation="vertical"
					className="mr-2 data-[orientation=vertical]:h-4"
				/>
				<AppShellBreadcrumbs
					breadcrumbSectionLabel={breadcrumbSectionLabel}
					breadcrumbDetailLabel={breadcrumbDetailLabel}
					isDesktopMac={isDesktopMac}
					onBreadcrumbSectionClick={onBreadcrumbSectionClick}
					canRenameCurrentItem={canRenameCurrentItem}
					renameItemLabel={renameItemLabel}
					titleEditOpen={titleEditOpen}
					onTitleEditOpenChange={handleBreadcrumbTitleEditOpenChange}
					onOpenTitleEditor={openBreadcrumbTitleEditor}
					titleEditPlaceholder={titleEditPlaceholder}
					titleValue={titleValue}
					onTitleValueChange={(value) => {
						setTitleValue(value);
						if (currentView === "note") {
							onNoteTitleChange(value);
						}
					}}
					onCommitTitleRename={() => {
						void commitBreadcrumbRename();
					}}
					onCancelTitleRename={() => {
						setTitleEditOpen(false);
						if (currentView === "note") {
							onNoteTitleChange(breadcrumbRenameInitialTitleRef.current);
						}
						setTitleValue(breadcrumbRenameInitialTitleRef.current);
					}}
					showAutomationIcon={
						currentView === "chat" && currentChatHasAutomation
					}
					onAutomationIconClick={
						currentView === "chat" && currentChatId
							? () => onNewChatAutomation(currentChatId)
							: undefined
					}
				/>
			</div>
			<div
				className={cn(
					"relative z-10 ml-auto shrink-0",
					isDesktopMac && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
					isDesktopMac && isMobile && "mt-1",
				)}
			>
				<AppShellHeaderActions
					currentView={currentView}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					currentNoteTemplateSlug={currentNoteTemplateSlug}
					currentNoteEditorActions={currentNoteEditorActions}
					currentNoteCommentsOpener={currentNoteCommentsOpener}
					isDesktopMac={isDesktopMac}
					currentChatId={currentChatId}
					currentChat={currentChat}
					currentChatHasAutomation={currentChatHasAutomation}
					onOpenChatTitleEditor={openBreadcrumbTitleEditor}
					onCreateNote={onCreateNote}
					onNoteTrashed={onNoteTrashed}
					onChatTrashed={onChatTrashed}
					onNewChat={onNewChat}
					onNewAutomation={onNewAutomation}
					onNewChatAutomation={onNewChatAutomation}
				/>
			</div>
		</header>
	);
}

function AppShellBreadcrumbs({
	breadcrumbSectionLabel,
	breadcrumbDetailLabel,
	isDesktopMac,
	onBreadcrumbSectionClick,
	canRenameCurrentItem,
	renameItemLabel,
	titleEditOpen,
	onTitleEditOpenChange,
	onOpenTitleEditor,
	titleEditPlaceholder,
	titleValue,
	onTitleValueChange,
	onCommitTitleRename,
	onCancelTitleRename,
	showAutomationIcon,
	onAutomationIconClick,
}: {
	breadcrumbSectionLabel: string;
	breadcrumbDetailLabel: string | null;
	isDesktopMac: boolean;
	onBreadcrumbSectionClick: () => void;
	canRenameCurrentItem: boolean;
	renameItemLabel: "chat" | "note";
	titleEditOpen: boolean;
	onTitleEditOpenChange: (open: boolean) => void;
	onOpenTitleEditor: () => void;
	titleEditPlaceholder: string;
	titleValue: string;
	onTitleValueChange: (value: string) => void;
	onCommitTitleRename: () => void;
	onCancelTitleRename: () => void;
	showAutomationIcon?: boolean;
	onAutomationIconClick?: () => void;
}) {
	const automationIconButton = showAutomationIcon ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					data-app-region={isDesktopMac ? "no-drag" : undefined}
					className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Edit automation"
					onClick={onAutomationIconClick}
				>
					<Clock className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent>Edit automation</TooltipContent>
		</Tooltip>
	) : null;

	return (
		<Breadcrumb className="min-w-0 flex-1">
			<BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
				{breadcrumbDetailLabel ? (
					<>
						<BreadcrumbItem className="hidden shrink-0 md:inline-flex">
							<BreadcrumbLink asChild>
								<button
									type="button"
									data-app-region={isDesktopMac ? "no-drag" : undefined}
									className="cursor-pointer truncate"
									onClick={onBreadcrumbSectionClick}
								>
									{breadcrumbSectionLabel}
								</button>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator className="hidden shrink-0 md:block" />
						<BreadcrumbItem className="min-w-0 flex-1 overflow-hidden">
							{canRenameCurrentItem ? (
								<div className="flex min-w-0 items-center gap-2">
									<Popover
										open={titleEditOpen}
										onOpenChange={onTitleEditOpenChange}
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<PopoverAnchor asChild>
													<button
														type="button"
														aria-current="page"
														data-app-region={
															isDesktopMac ? "no-drag" : undefined
														}
														className="line-clamp-1 -mx-1 -my-0.5 min-w-0 cursor-pointer rounded px-1 py-0.5 text-left"
														onClick={onOpenTitleEditor}
													>
														<BreadcrumbPage className="block truncate">
															{breadcrumbDetailLabel}
														</BreadcrumbPage>
													</button>
												</PopoverAnchor>
											</TooltipTrigger>
											<TooltipContent>
												{`Rename ${renameItemLabel}`}
											</TooltipContent>
										</Tooltip>
										<PopoverContent
											align="start"
											side="bottom"
											sideOffset={6}
											className="w-[340px] rounded-lg border-sidebar-border/70 bg-sidebar p-1.5 shadow-2xl ring-1 ring-border/60"
										>
											<div className="flex items-center gap-2">
												<NoteTitleEditInput
													focusOnMount
													commitOnBlur={false}
													placeholder={titleEditPlaceholder}
													value={titleValue}
													onValueChange={onTitleValueChange}
													onCommit={onCommitTitleRename}
													onCancel={onCancelTitleRename}
												/>
											</div>
										</PopoverContent>
									</Popover>
									{automationIconButton}
								</div>
							) : (
								<BreadcrumbPage className="flex min-w-0 items-center gap-2">
									<span className="truncate">{breadcrumbDetailLabel}</span>
									{automationIconButton}
								</BreadcrumbPage>
							)}
						</BreadcrumbItem>
					</>
				) : (
					<BreadcrumbItem className="min-w-0 flex-1 overflow-hidden">
						<BreadcrumbPage className="block truncate">
							{breadcrumbSectionLabel}
						</BreadcrumbPage>
					</BreadcrumbItem>
				)}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

function AppShellHeaderActions({
	currentView,
	currentNoteId,
	currentNoteTitle,
	currentNoteTemplateSlug,
	currentNoteEditorActions,
	currentNoteCommentsOpener,
	isDesktopMac,
	currentChatId,
	currentChat,
	currentChatHasAutomation,
	onOpenChatTitleEditor,
	onCreateNote,
	onNoteTrashed,
	onChatTrashed,
	onNewChat,
	onNewAutomation,
	onNewChatAutomation,
}: Pick<
	AppShellHeaderProps,
	| "currentView"
	| "currentNoteId"
	| "currentNoteTitle"
	| "currentNoteTemplateSlug"
	| "currentNoteEditorActions"
	| "currentNoteCommentsOpener"
	| "isDesktopMac"
	| "currentChatId"
	| "currentChat"
	| "currentChatHasAutomation"
	| "onCreateNote"
	| "onNoteTrashed"
	| "onChatTrashed"
	| "onNewChat"
	| "onNewAutomation"
	| "onNewChatAutomation"
> & {
	onOpenChatTitleEditor: () => void;
}) {
	if (currentView === "home") {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={onCreateNote}
			>
				<Plus />
				Quick note
			</Button>
		);
	}

	if (currentView === "chat") {
		return (
			<ChatHeaderActions
				chatId={currentChatId}
				chat={currentChat}
				hasAutomation={currentChatHasAutomation}
				isDesktopMac={isDesktopMac}
				onNewChat={onNewChat}
				onRenameChat={onOpenChatTitleEditor}
				onChatTrashed={onChatTrashed}
				onAddAutomation={onNewChatAutomation}
			/>
		);
	}

	if (currentView === "automation") {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={onNewAutomation}
			>
				<Plus />
				New automation
			</Button>
		);
	}

	if (currentView === "inbox") {
		return null;
	}

	if (currentView !== "note" || !currentNoteId) {
		return null;
	}

	return (
		<div
			className="flex items-center gap-2"
			data-app-region={isDesktopMac ? "no-drag" : undefined}
		>
			{currentNoteEditorActions?.canShowTemplateSelect ? (
				<NoteTemplateSelect
					disabled={!currentNoteEditorActions}
					selectedSlug={currentNoteTemplateSlug}
					onTemplateSelect={async (template) =>
						(await currentNoteEditorActions?.applyTemplate(template)) ?? false
					}
				/>
			) : null}
			<NoteStarButton noteId={currentNoteId} className="size-7" />
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						data-app-region={isDesktopMac ? "no-drag" : undefined}
						aria-label="Open comments"
						onClick={() => {
							if (currentNoteCommentsOpener) {
								currentNoteCommentsOpener();
								return;
							}

							window.dispatchEvent(new Event(OPEN_NOTE_COMMENTS_EVENT));
						}}
					>
						<MessageSquareText className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Open comments</TooltipContent>
			</Tooltip>
			<NoteHeaderActionsMenu
				noteId={currentNoteId}
				noteTitle={currentNoteTitle}
				noteEditorActions={currentNoteEditorActions}
				onNoteTrashed={onNoteTrashed}
			/>
		</div>
	);
}

function NoteHeaderActionsMenu({
	noteId,
	noteTitle,
	noteEditorActions,
	onNoteTrashed,
}: {
	noteId: Id<"notes">;
	noteTitle: string;
	noteEditorActions: NoteEditorActions | null;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	return (
		<NoteActionsMenu
			noteId={noteId}
			onMoveToTrash={onNoteTrashed}
			align="end"
			triggerTooltip="More actions"
			showRename={false}
			itemsBeforeDefaults={
				noteEditorActions ? (
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!noteEditorActions.canCopyMarkdown}
						onSelect={(event) => {
							event.preventDefault();
							noteEditorActions.copyMarkdown();
						}}
					>
						<Copy />
						Copy note content
					</DropdownMenuItem>
				) : null
			}
			itemsAfterDefaults={
				noteEditorActions ? (
					<>
						<DropdownMenuItem
							className="cursor-pointer"
							disabled={!noteEditorActions.canUndo}
							onSelect={(event) => {
								event.preventDefault();
								noteEditorActions.undo();
							}}
						>
							<Undo2 />
							Undo
						</DropdownMenuItem>
						<DropdownMenuItem
							className="cursor-pointer"
							disabled={!noteEditorActions.canRedo}
							onSelect={(event) => {
								event.preventDefault();
								noteEditorActions.redo();
							}}
						>
							<Redo2 />
							Redo
						</DropdownMenuItem>
						<DropdownMenuItem
							className="cursor-pointer"
							disabled={!noteEditorActions.canCopyMarkdown}
							onSelect={(event) => {
								event.preventDefault();
								noteEditorActions.exportMarkdown();
							}}
						>
							<ArrowDown />
							Export
						</DropdownMenuItem>
					</>
				) : null
			}
		>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="text-muted-foreground hover:text-foreground"
				aria-label={`Open actions for ${noteTitle || "note"}`}
			>
				<MoreHorizontal className="size-4" />
			</Button>
		</NoteActionsMenu>
	);
}

function ChatHeaderActions({
	chatId,
	chat,
	isDesktopMac,
	onNewChat,
	onRenameChat,
	onChatTrashed,
	onAddAutomation,
	hasAutomation,
}: {
	chatId: string | null;
	chat: Doc<"chats"> | null;
	isDesktopMac: boolean;
	onNewChat: () => void;
	onRenameChat: () => void;
	onChatTrashed: (chatId: string) => void;
	onAddAutomation: (chatId: string) => void;
	hasAutomation: boolean;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [confirmTrashOpen, setConfirmTrashOpen] = React.useState(false);
	const [isUpdatingStar, setIsUpdatingStar] = React.useState(false);
	const [isMovingToTrash, setIsMovingToTrash] = React.useState(false);
	const isStarred = chat?.isStarred ?? false;
	const toggleStar = useMutation(api.chats.toggleStar).withOptimisticUpdate(
		(localStore, args) => {
			optimisticPatchChat(
				localStore,
				args.workspaceId,
				args.chatId,
				(currentChat) => ({
					...currentChat,
					isStarred: !(currentChat.isStarred ?? false),
				}),
				chat?.noteId,
			);
		},
	);
	const moveChatToTrash = useMutation(api.chats.moveToTrash);

	const handleToggleStar = React.useCallback(() => {
		if (!activeWorkspaceId || !chatId || isUpdatingStar) {
			return;
		}

		setIsUpdatingStar(true);

		void toggleStar({ workspaceId: activeWorkspaceId, chatId })
			.then((result) => {
				toast.success(result.isStarred ? "Chat starred" : "Chat unstarred");
			})
			.catch((error) => {
				console.error("Failed to update chat star", error);
				toast.error("Failed to update chat star");
			})
			.finally(() => {
				setIsUpdatingStar(false);
			});
	}, [activeWorkspaceId, chatId, isUpdatingStar, toggleStar]);

	const handleConfirmTrash = React.useCallback(() => {
		if (!activeWorkspaceId || !chatId || isMovingToTrash) {
			return;
		}

		setIsMovingToTrash(true);

		void moveChatToTrash({ workspaceId: activeWorkspaceId, chatId })
			.then(() => {
				onChatTrashed(chatId);
				setConfirmTrashOpen(false);
				toast.success("Chat moved to trash");
			})
			.catch((error) => {
				console.error("Failed to move chat to trash", error);
				toast.error("Failed to move chat to trash");
			})
			.finally(() => {
				setIsMovingToTrash(false);
			});
	}, [
		activeWorkspaceId,
		chatId,
		isMovingToTrash,
		moveChatToTrash,
		onChatTrashed,
	]);

	if (!chatId) {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={onNewChat}
			>
				<Plus />
				New chat
			</Button>
		);
	}

	return (
		<div
			className="flex items-center gap-1"
			data-app-region={isDesktopMac ? "no-drag" : undefined}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="New chat"
						onClick={onNewChat}
					>
						<Plus className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>New chat</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Open summary"
						onClick={() => {
							window.dispatchEvent(new Event(OPEN_CHAT_SUMMARY_EVENT));
						}}
					>
						<TextSearch className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Open summary</TooltipContent>
			</Tooltip>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="More actions"
								className="text-muted-foreground hover:text-foreground"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>More actions</TooltipContent>
				</Tooltip>
				<DropdownMenuContent
					align="end"
					className="w-44 overflow-hidden rounded-lg p-1"
				>
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!chatId}
						onSelect={onRenameChat}
					>
						<Pencil />
						Rename
					</DropdownMenuItem>
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!chatId || !activeWorkspaceId || isUpdatingStar}
						onSelect={handleToggleStar}
					>
						{isStarred ? <StarOff /> : <Star />}
						{isStarred ? "Unstar" : "Star"}
					</DropdownMenuItem>
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!chatId || !activeWorkspaceId}
						onSelect={() => {
							if (chatId) {
								onAddAutomation(chatId);
							}
						}}
					>
						<Clock />
						{hasAutomation ? "Edit automation" : "Add automation"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						className="cursor-pointer"
						disabled={!chatId}
						onSelect={() => setConfirmTrashOpen(true)}
					>
						<Trash2 />
						Move to trash
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<AlertDialog open={confirmTrashOpen} onOpenChange={setConfirmTrashOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Move chat to trash?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the chat from the list. You can restore it later from
							Trash.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isMovingToTrash}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
							onClick={handleConfirmTrash}
							disabled={isMovingToTrash}
						>
							{isMovingToTrash ? "Moving..." : "Move to trash"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

const AppShellContent = React.memo(function AppShellContent({
	isDesktopMac,
	currentView,
	currentDate,
	currentDayOfMonth,
	currentMonthLabel,
	currentWeekdayLabel,
	upcomingCalendarEvents,
	upcomingCalendarStatus,
	isLoadingUpcomingCalendarEvents,
	notes,
	sharedNotes,
	currentNoteId,
	currentNoteTitle,
	selectedNote,
	user,
	onOpenNote,
	onNoteTrashed,
	onCreateNote,
	onOpenCalendarEventNote,
	onOpenCalendarSettings,
	chatComposerId,
	initialChatMessages,
	isInitialChatMessagesLoading,
	chats,
	currentChatId,
	onChatPersisted,
	onOpenChat,
	onPrefetchChat,
	onChatRemoved,
	onOpenConnectionsSettings,
	onCreateNoteFromChatResponse,
	onNoteTitleChange,
	onNoteEditorActionsChange,
	onNoteCommentsOpenChange,
	onAutoStartNoteCaptureHandled,
	shouldAutoStartNoteCapture,
	shouldStopNoteCaptureWhenMeetingEnds,
	onGoHome,
	onCreateAutomation,
	onCreateChatAutomation,
	automations,
	onEditAutomation,
	onOpenAutomation,
	onRunAutomationNow,
	onToggleAutomationPaused,
	onDeleteAutomation,
}: {
	isDesktopMac: boolean;
	currentView: AppView;
	currentDate: Date;
	currentDayOfMonth: number;
	currentMonthLabel: string;
	currentWeekdayLabel: string;
	upcomingCalendarEvents: UpcomingCalendarEvent[];
	upcomingCalendarStatus: "idle" | "ready" | "not_connected" | "error";
	isLoadingUpcomingCalendarEvents: boolean;
	notes: Array<Doc<"notes">> | undefined;
	sharedNotes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	selectedNote: Doc<"notes"> | null | undefined;
	user: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
	onOpenCalendarEventNote: (
		event: UpcomingCalendarEvent,
		options?: {
			autoStartCapture?: boolean;
			stopCaptureWhenMeetingEnds?: boolean;
		},
	) => Promise<void> | void;
	onOpenCalendarSettings: () => void;
	chatComposerId: string;
	initialChatMessages: UIMessage[];
	isInitialChatMessagesLoading: boolean;
	chats: Array<Doc<"chats">> | undefined;
	currentChatId: string | null;
	onChatPersisted?: (chatId: string) => void;
	onOpenChat: (chatId: string) => void;
	onPrefetchChat: (chatId: string) => void;
	onChatRemoved: (chatId: string) => void;
	onOpenConnectionsSettings: () => void;
	onCreateNoteFromChatResponse: (
		title: string,
		content: string,
	) => Promise<"created" | undefined> | "created" | undefined;
	onNoteTitleChange: (title: string) => void;
	onNoteEditorActionsChange: (actions: NoteEditorActions | null) => void;
	onNoteCommentsOpenChange: (opener: (() => void) | null) => void;
	onAutoStartNoteCaptureHandled: () => void;
	shouldAutoStartNoteCapture: boolean;
	shouldStopNoteCaptureWhenMeetingEnds: boolean;
	onGoHome: () => void;
	onCreateAutomation: () => void;
	onCreateChatAutomation: (chatId: string) => void;
	automations: AutomationListItem[] | undefined;
	onEditAutomation: (automationId: Id<"automations">) => void;
	onOpenAutomation: (automation: AutomationListItem) => void;
	onRunAutomationNow: (automationId: Id<"automations">) => void;
	onToggleAutomationPaused: (automationId: Id<"automations">) => void;
	onDeleteAutomation: (automationId: Id<"automations">) => void;
}) {
	const noteViewScrollRef = React.useRef<HTMLDivElement | null>(null);
	const noteScrollResetKey =
		currentView === "note" ? (currentNoteId ?? "new") : null;

	React.useEffect(() => {
		if (noteScrollResetKey === null) {
			return;
		}

		noteViewScrollRef.current?.scrollTo({
			top: 0,
			behavior: "auto",
		});
	}, [noteScrollResetKey]);

	if (currentView === "notFound") {
		return <NotFoundView onGoHome={onGoHome} />;
	}

	if (currentView === "home") {
		return (
			<ScrollArea
				className="min-h-0 flex-1"
				viewportClassName="overscroll-contain overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full"
			>
				<HomeView
					currentDate={currentDate}
					currentDayOfMonth={currentDayOfMonth}
					currentMonthLabel={currentMonthLabel}
					currentWeekdayLabel={currentWeekdayLabel}
					upcomingCalendarEvents={upcomingCalendarEvents}
					upcomingCalendarStatus={upcomingCalendarStatus}
					isLoadingUpcomingCalendarEvents={isLoadingUpcomingCalendarEvents}
					notes={notes}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					currentUser={user}
					isDesktopMac={isDesktopMac}
					onOpenNote={onOpenNote}
					onNoteTrashed={onNoteTrashed}
					onCreateNote={onCreateNote}
					onOpenCalendarEventNote={onOpenCalendarEventNote}
					onOpenCalendarSettings={onOpenCalendarSettings}
				/>
			</ScrollArea>
		);
	}

	if (currentView === "shared") {
		return (
			<ScrollArea
				className="min-h-0 flex-1"
				viewportClassName="overscroll-contain overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full"
			>
				<SharedView
					sharedNotes={sharedNotes}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					currentUser={user}
					isDesktopMac={isDesktopMac}
					onOpenNote={onOpenNote}
					onNoteTrashed={onNoteTrashed}
				/>
			</ScrollArea>
		);
	}

	if (currentView === "automation") {
		return (
			<ScrollArea
				className="min-h-0 flex-1"
				viewportClassName="overscroll-contain"
			>
				<AutomationsPage
					automations={automations}
					isDesktopMac={isDesktopMac}
					onCreateAutomation={onCreateAutomation}
					onDeleteAutomation={onDeleteAutomation}
					onEditAutomation={onEditAutomation}
					onOpenAutomation={onOpenAutomation}
					onRunAutomationNow={onRunAutomationNow}
					onToggleAutomationPaused={onToggleAutomationPaused}
				/>
			</ScrollArea>
		);
	}

	if (currentView === "note") {
		return (
			<ScrollArea
				className="min-h-0 flex-1"
				viewportClassName="overscroll-contain"
				viewportRef={noteViewScrollRef}
			>
				<NotePage
					key={currentNoteId ?? "new"}
					autoStartTranscription={shouldAutoStartNoteCapture}
					currentUser={user}
					isDesktopMac={isDesktopMac}
					noteId={currentNoteId}
					note={selectedNote}
					externalTitle={currentNoteTitle}
					onAutoStartTranscriptionHandled={onAutoStartNoteCaptureHandled}
					onCommentsOpenChange={onNoteCommentsOpenChange}
					onTitleChange={onNoteTitleChange}
					onEditorActionsChange={onNoteEditorActionsChange}
					scrollParentRef={noteViewScrollRef}
					stopTranscriptionWhenMeetingEnds={
						shouldStopNoteCaptureWhenMeetingEnds
					}
				/>
			</ScrollArea>
		);
	}

	return (
		<ChatPage
			key={chatComposerId}
			chatId={chatComposerId}
			initialMessages={initialChatMessages}
			isInitialMessagesLoading={isInitialChatMessagesLoading}
			onChatPersisted={onChatPersisted}
			chats={chats ?? []}
			isChatsLoading={chats === undefined}
			activeChatId={currentChatId}
			onOpenChat={onOpenChat}
			onPrefetchChat={onPrefetchChat}
			onChatRemoved={onChatRemoved}
			isDesktopMac={isDesktopMac}
			onOpenConnectionsSettings={onOpenConnectionsSettings}
			onCreateNoteFromResponse={onCreateNoteFromChatResponse}
			automations={automations}
			onAddAutomation={onCreateChatAutomation}
		/>
	);
});

function NotFoundView({ onGoHome }: { onGoHome: () => void }) {
	return (
		<div className="flex flex-1 items-center justify-center px-8 py-10">
			<Empty className="max-w-lg border-none">
				<EmptyHeader>
					<EmptyTitle>404 - Not Found</EmptyTitle>
					<EmptyDescription>
						The page you&apos;re looking for doesn&apos;t exist. Use the sidebar
						to search or go back home.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={onGoHome} size="sm">
						Go to Home
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

export function AuthenticatedAppShell({
	session,
	workspaces,
	initialDesktopMac,
}: {
	session: AuthSession;
	workspaces: Array<WorkspaceRecord>;
	initialDesktopMac: boolean;
}) {
	const controller = useAppShellState({
		session,
		workspaces,
		initialDesktopMac,
	});
	const handleOpenConnectionsSettings = React.useCallback(
		() => controller.handleSettingsOpenChange(true, "Connections"),
		[controller.handleSettingsOpenChange],
	);
	const handleNoteCommentsOpenChange = React.useCallback(
		(opener: (() => void) | null) => {
			controller.setCurrentNoteCommentsOpener(() => opener);
		},
		[controller.setCurrentNoteCommentsOpener],
	);
	const handleGoHome = React.useCallback(
		() => controller.handleViewChange("home"),
		[controller.handleViewChange],
	);

	return (
		<ActiveWorkspaceProvider workspaceId={controller.activeWorkspaceId}>
			<SidebarProvider className="h-svh overflow-hidden">
				<AppSidebar
					workspaces={controller.workspaces}
					activeWorkspaceId={controller.activeWorkspaceId}
					currentView={controller.currentView}
					inboxOpen={controller.inboxOpen}
					user={controller.user}
					chats={controller.chats}
					automations={controller.automations}
					notes={controller.notes}
					sharedNotes={controller.sharedNotes}
					onWorkspaceSelect={controller.setActiveWorkspaceId}
					onWorkspaceCreate={controller.handleWorkspaceCreate}
					onViewChange={controller.handleViewChange}
					onInboxOpenChange={controller.handleInboxOpenChange}
					settingsOpen={controller.settingsOpen}
					settingsPage={controller.settingsPage}
					onSettingsOpenChange={controller.handleSettingsOpenChange}
					onSignOut={controller.handleSignOut}
					signingOut={controller.isSigningOut}
					desktopSafeTop={controller.isDesktopMac}
					currentChatId={controller.currentChatId}
					currentChatTitle={controller.currentChatTitle}
					currentNoteId={controller.currentNoteId}
					currentNoteTitle={controller.currentNoteTitle}
					onChatSelect={controller.handleOpenChat}
					onAddAutomation={controller.handleCreateChatAutomationOpen}
					onNotePrefetch={controller.handlePrefetchNote}
					onNoteSelect={controller.openNote}
					onNoteTitleChange={controller.setCurrentNoteTitle}
					onNoteTrashed={controller.handleNoteTrashed}
					onCreateNote={controller.handleQuickNote}
				/>
				<AppShellInset reserveRightSidebar={controller.currentView === "note"}>
					<AppShellHeader
						isDesktopMac={controller.isDesktopMac}
						inboxOpen={controller.inboxOpen}
						breadcrumbSectionLabel={controller.breadcrumbSectionLabel}
						breadcrumbDetailLabel={controller.breadcrumbDetailLabel}
						onBreadcrumbSectionClick={controller.handleBreadcrumbSectionClick}
						currentView={controller.currentView}
						currentChatId={controller.currentChatId}
						currentChat={controller.currentChat}
						currentChatTitle={controller.currentChatTitle}
						currentChatNoteId={controller.currentChatNoteId}
						currentChatHasAutomation={controller.currentChatHasAutomation}
						currentNoteId={controller.currentNoteId}
						currentNoteTitle={controller.currentNoteTitle}
						currentNoteTemplateSlug={controller.currentNoteTemplateSlug}
						currentNoteEditorActions={controller.currentNoteEditorActions}
						currentNoteCommentsOpener={controller.currentNoteCommentsOpener}
						onCreateNote={controller.handleQuickNote}
						onNoteTitleChange={controller.setCurrentNoteTitle}
						onNoteTrashed={controller.handleNoteTrashed}
						onChatTrashed={controller.handleChatRemoved}
						onNewChat={controller.handleNewChat}
						onNewAutomation={controller.handleCreateAutomationOpen}
						onNewChatAutomation={controller.handleCreateChatAutomationOpen}
					/>
					<AppShellContent
						isDesktopMac={controller.isDesktopMac}
						currentView={controller.currentView}
						currentDate={controller.currentDate}
						currentDayOfMonth={controller.currentDayOfMonth}
						currentMonthLabel={controller.currentMonthLabel}
						currentWeekdayLabel={controller.currentWeekdayLabel}
						upcomingCalendarEvents={controller.upcomingCalendarEvents}
						upcomingCalendarStatus={controller.upcomingCalendarStatus}
						isLoadingUpcomingCalendarEvents={
							controller.isLoadingUpcomingCalendarEvents
						}
						notes={controller.notes}
						sharedNotes={controller.sharedNotes}
						currentNoteId={controller.currentNoteId}
						currentNoteTitle={controller.currentNoteTitle}
						selectedNote={controller.selectedNote}
						user={controller.user}
						onOpenNote={controller.openNote}
						onNoteTrashed={controller.handleNoteTrashed}
						onCreateNote={controller.handleQuickNote}
						onOpenCalendarEventNote={controller.handleOpenCalendarEventNote}
						onOpenCalendarSettings={controller.handleOpenCalendarSettings}
						chatComposerId={controller.chatComposerId}
						initialChatMessages={controller.initialChatMessages}
						isInitialChatMessagesLoading={
							controller.isInitialChatMessagesLoading
						}
						chats={controller.chats}
						currentChatId={controller.currentChatId}
						onChatPersisted={controller.handleChatPersisted}
						onOpenChat={controller.handleOpenChat}
						onPrefetchChat={controller.handlePrefetchChat}
						onChatRemoved={controller.handleChatRemoved}
						onOpenConnectionsSettings={handleOpenConnectionsSettings}
						onCreateNoteFromChatResponse={
							controller.handleCreateNoteFromChatResponse
						}
						onNoteTitleChange={controller.setCurrentNoteTitle}
						onNoteEditorActionsChange={controller.setCurrentNoteEditorActions}
						onNoteCommentsOpenChange={handleNoteCommentsOpenChange}
						onAutoStartNoteCaptureHandled={
							controller.handleAutoStartNoteCaptureHandled
						}
						shouldAutoStartNoteCapture={controller.shouldAutoStartNoteCapture}
						shouldStopNoteCaptureWhenMeetingEnds={
							controller.shouldStopNoteCaptureWhenMeetingEnds
						}
						onGoHome={handleGoHome}
						onCreateAutomation={controller.handleCreateAutomationOpen}
						onCreateChatAutomation={controller.handleCreateChatAutomationOpen}
						automations={controller.automations}
						onEditAutomation={controller.handleEditAutomationOpen}
						onOpenAutomation={controller.handleOpenAutomation}
						onRunAutomationNow={controller.handleRunAutomationNow}
						onToggleAutomationPaused={controller.handleToggleAutomationPaused}
						onDeleteAutomation={controller.handleDeleteAutomation}
					/>
				</AppShellInset>
				<CreateAutomationDialog
					open={controller.automationDialogOpen}
					onOpenChange={controller.handleAutomationDialogOpenChange}
					onCreateAutomation={controller.handleAutomationSave}
					onOpenConnectionsSettings={handleOpenConnectionsSettings}
					initialAutomation={controller.editingAutomation}
					initialTitle={controller.automationChatTitle}
				/>
			</SidebarProvider>
		</ActiveWorkspaceProvider>
	);
}
