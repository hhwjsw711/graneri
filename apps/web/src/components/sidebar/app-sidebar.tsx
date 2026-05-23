"use client";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import { useQuery } from "convex/react";
import { FileText, MessageCircle } from "lucide-react";
import * as React from "react";
import type { AutomationListItem } from "@/components/automations/automation-types";
import { InboxSheet } from "@/components/inbox/inbox-sheet";
import { NavMain } from "@/components/nav/nav-main";
import { NavNotes } from "@/components/nav/nav-notes";
import { NavProjects } from "@/components/nav/nav-projects";
import { NavStarred } from "@/components/nav/nav-starred";
import { NavTrash } from "@/components/nav/nav-trash";
import { RecipesDialog } from "@/components/recipes/recipes-dialog";
import {
	SearchCommand,
	type SearchCommandItem,
} from "@/components/search/search-command";
import {
	SettingsDialog,
	type SettingsPage,
} from "@/components/settings/settings-dialog";
import { NavUser } from "@/components/sidebar/nav-user";
import { TemplatesDialog } from "@/components/templates/templates-dialog";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";
import { getChatId } from "@/lib/chat";
import { SIDEBAR_NAVIGATION } from "@/lib/navigation";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type AppSidebarView =
	| "home"
	| "chat"
	| "automation"
	| "inbox"
	| "shared"
	| "note"
	| "notFound";

type NoteNavigationSource = "notes" | "projects" | "shared" | "starred";

type AppSidebarUser = {
	name: string;
	email: string;
	avatar: string;
};

type AppSidebarNavItem = (typeof SIDEBAR_NAVIGATION)[number] & {
	isActive: boolean;
	badge?: number;
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
	workspaces: Array<WorkspaceRecord>;
	activeWorkspaceId: Id<"workspaces"> | null;
	currentView: AppSidebarView;
	inboxOpen: boolean;
	user: AppSidebarUser;
	chats: Array<Doc<"chats">> | undefined;
	automations: AutomationListItem[] | undefined;
	notes: Array<Doc<"notes">> | undefined;
	sharedNotes: Array<Doc<"notes">> | undefined;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	onWorkspaceCreate: (input: { name: string }) => Promise<WorkspaceRecord>;
	onViewChange: (
		view: "home" | "chat" | "automation" | "inbox" | "shared" | "note",
	) => void;
	onInboxOpenChange: (open: boolean) => void;
	settingsOpen: boolean;
	settingsPage?: SettingsPage;
	onSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	onSignOut: () => void;
	signingOut?: boolean;
	desktopSafeTop?: boolean;
	currentChatId: string | null;
	currentChatTitle?: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	onChatSelect: (chatId: string) => void;
	onAddAutomation?: (chatId: string) => void;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
};

type SidebarUiState = {
	searchOpen: boolean;
	chatSearchOpen: boolean;
	trashOpen: boolean;
	recipesOpen: boolean;
	templatesOpen: boolean;
	optimisticReadInboxItemIds: Set<string>;
};

type SidebarUiAction =
	| {
			type: "setOpen";
			key:
				| "searchOpen"
				| "chatSearchOpen"
				| "trashOpen"
				| "recipesOpen"
				| "templatesOpen";
			value: boolean;
	  }
	| { type: "resetReadInboxItems" }
	| { type: "markInboxItemsRead"; itemIds: string[] };

const createInitialSidebarUiState = (): SidebarUiState => ({
	searchOpen: false,
	chatSearchOpen: false,
	trashOpen: false,
	recipesOpen: false,
	templatesOpen: false,
	optimisticReadInboxItemIds: new Set(),
});

function sidebarUiReducer(
	state: SidebarUiState,
	action: SidebarUiAction,
): SidebarUiState {
	switch (action.type) {
		case "setOpen":
			return {
				...state,
				[action.key]: action.value,
			};
		case "resetReadInboxItems":
			return {
				...state,
				optimisticReadInboxItemIds: new Set(),
			};
		case "markInboxItemsRead": {
			const nextReadItemIds = new Set(state.optimisticReadInboxItemIds);
			for (const itemId of action.itemIds) {
				nextReadItemIds.add(itemId);
			}

			return {
				...state,
				optimisticReadInboxItemIds: nextReadItemIds,
			};
		}
	}
}

function useMobileSidebarNavigation({
	dispatchUi,
	isMobile,
	onChatSelect,
	onCreateNote,
	onInboxOpenChange,
	onNoteSelect,
	onViewChange,
	onWorkspaceSelect,
	setOpenMobile,
}: {
	dispatchUi: React.ActionDispatch<[action: SidebarUiAction]>;
	isMobile: boolean;
	onChatSelect: (chatId: string) => void;
	onCreateNote: () => void;
	onInboxOpenChange: (open: boolean) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onViewChange: (
		view: "home" | "chat" | "automation" | "inbox" | "shared" | "note",
	) => void;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	setOpenMobile: (open: boolean) => void;
}) {
	const closeMobileSidebar = React.useCallback(() => {
		if (!isMobile) {
			return;
		}

		setOpenMobile(false);
	}, [isMobile, setOpenMobile]);

	const handleSearchOpen = React.useCallback(() => {
		closeMobileSidebar();
		dispatchUi({
			type: "setOpen",
			key: "chatSearchOpen",
			value: false,
		});
		dispatchUi({
			type: "setOpen",
			key: "searchOpen",
			value: true,
		});
	}, [closeMobileSidebar, dispatchUi]);

	const handleChatSearchOpen = React.useCallback(() => {
		closeMobileSidebar();
		dispatchUi({
			type: "setOpen",
			key: "searchOpen",
			value: false,
		});
		dispatchUi({
			type: "setOpen",
			key: "chatSearchOpen",
			value: true,
		});
	}, [closeMobileSidebar, dispatchUi]);

	const handleInboxOpenChange = React.useCallback(
		(open: boolean) => {
			if (open) {
				closeMobileSidebar();
			}

			onInboxOpenChange(open);
		},
		[closeMobileSidebar, onInboxOpenChange],
	);

	const handleViewChange = React.useCallback(
		(view: "home" | "chat" | "automation" | "inbox" | "shared" | "note") => {
			closeMobileSidebar();
			onViewChange(view);
		},
		[closeMobileSidebar, onViewChange],
	);

	const handleWorkspaceSelect = React.useCallback(
		(workspaceId: Id<"workspaces">) => {
			closeMobileSidebar();
			onWorkspaceSelect(workspaceId);
		},
		[closeMobileSidebar, onWorkspaceSelect],
	);

	const handleChatSelect = React.useCallback(
		(chatId: string) => {
			closeMobileSidebar();
			onChatSelect(chatId);
		},
		[closeMobileSidebar, onChatSelect],
	);

	const handleNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => {
			closeMobileSidebar();
			onNoteSelect(noteId);
		},
		[closeMobileSidebar, onNoteSelect],
	);

	const handleCreateNote = React.useCallback(() => {
		closeMobileSidebar();
		onCreateNote();
	}, [closeMobileSidebar, onCreateNote]);

	return {
		handleChatSearchOpen,
		handleChatSelect,
		handleCreateNote,
		handleInboxOpenChange,
		handleNoteSelect,
		handleSearchOpen,
		handleViewChange,
		handleWorkspaceSelect,
	};
}

function useAppSidebarModel({
	activeWorkspaceId,
	chats,
	currentNoteId,
	currentNoteTitle,
	currentView,
	inboxOpen,
	isMobile,
	notes,
	projects,
	onChatSelect,
	onCreateNote,
	onInboxOpenChange,
	onNoteSelect,
	onSettingsOpenChange,
	onViewChange,
	onWorkspaceSelect,
	setOpenMobile,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	chats: Array<Doc<"chats">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	currentView: AppSidebarView;
	inboxOpen: boolean;
	isMobile: boolean;
	notes: Array<Doc<"notes">> | undefined;
	projects: Array<Doc<"projects">> | undefined;
	onChatSelect: (chatId: string) => void;
	onCreateNote: () => void;
	onInboxOpenChange: (open: boolean) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	onViewChange: (
		view: "home" | "chat" | "automation" | "inbox" | "shared" | "note",
	) => void;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	setOpenMobile: (open: boolean) => void;
}) {
	const [uiState, dispatchUi] = React.useReducer(
		sidebarUiReducer,
		undefined,
		createInitialSidebarUiState,
	);
	const mobileNavigation = useMobileSidebarNavigation({
		dispatchUi,
		isMobile,
		onChatSelect,
		onCreateNote,
		onInboxOpenChange,
		onNoteSelect,
		onViewChange,
		onWorkspaceSelect,
		setOpenMobile,
	});
	const transcriptionSession = useTranscriptionSession();
	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				!event.altKey ||
				event.shiftKey ||
				(event.key.toLowerCase() !== "k" && event.code !== "KeyK")
			) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			mobileNavigation.handleChatSearchOpen();
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [mobileNavigation.handleChatSearchOpen]);
	const inboxItems = useQuery(
		api.inboxItems.list,
		activeWorkspaceId
			? { workspaceId: activeWorkspaceId, view: "unread" }
			: "skip",
	);
	const unreadInboxCount =
		inboxItems?.filter(
			(item) => !uiState.optimisticReadInboxItemIds.has(String(item._id)),
		).length ?? 0;
	const recordingNoteId = React.useMemo(() => {
		if (!transcriptionSession.isListening) {
			return null;
		}

		const scopeKey = transcriptionSession.scopeKey;
		if (!scopeKey?.startsWith("note:")) {
			return null;
		}

		const scopedNoteId = scopeKey.slice("note:".length);
		if (!scopedNoteId || scopedNoteId === "draft") {
			return null;
		}

		return scopedNoteId as Id<"notes">;
	}, [transcriptionSession.isListening, transcriptionSession.scopeKey]);

	React.useEffect(() => {
		const workspaceScope = activeWorkspaceId ?? "no-workspace";

		if (!workspaceScope) {
			return;
		}

		dispatchUi({ type: "resetReadInboxItems" });
	}, [activeWorkspaceId]);

	const navItems = React.useMemo<AppSidebarNavItem[]>(
		() =>
			SIDEBAR_NAVIGATION.map((item) => ({
				...item,
				isActive:
					item.action === "inbox"
						? inboxOpen
						: item.action === "view" && item.view === currentView,
				badge:
					item.action === "inbox" && unreadInboxCount > 0
						? unreadInboxCount
						: undefined,
			})),
		[currentView, inboxOpen, unreadInboxCount],
	);
	const projectNamesById = React.useMemo(
		() =>
			new Map((projects ?? []).map((project) => [project._id, project.name])),
		[projects],
	);
	const searchItems = React.useMemo<SearchCommandItem[]>(
		() =>
			(notes ?? [])
				.map((note) => ({
					id: note._id,
					title: getNoteDisplayTitle(
						note._id === currentNoteId && currentNoteTitle?.trim()
							? currentNoteTitle
							: note.title,
					),
					kind: "note" as const,
					icon: FileText,
					projectName: note.projectId
						? projectNamesById.get(note.projectId)
						: undefined,
					preview: note.searchableText.trim() || undefined,
					updatedAt: note.updatedAt,
				}))
				.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
		[currentNoteId, currentNoteTitle, notes, projectNamesById],
	);
	const chatSearchItems = React.useMemo<SearchCommandItem[]>(
		() =>
			(chats ?? [])
				.map((chat) => ({
					id: getChatId(chat),
					title: chat.title || "New chat",
					kind: "chat" as const,
					icon: MessageCircle,
					preview: chat.preview.trim() || undefined,
					updatedAt: chat.updatedAt,
				}))
				.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
		[chats],
	);
	const handleDialogOpenChange = React.useCallback(
		(
			key: "searchOpen" | "chatSearchOpen" | "recipesOpen" | "templatesOpen",
			value: boolean,
		) => {
			dispatchUi({
				type: "setOpen",
				key,
				value,
			});
		},
		[],
	);
	const handleMarkInboxItemsRead = React.useCallback((itemIds: string[]) => {
		dispatchUi({ type: "markInboxItemsRead", itemIds });
	}, []);
	const handleTrashOpenChange = React.useCallback((open: boolean) => {
		dispatchUi({
			type: "setOpen",
			key: "trashOpen",
			value: open,
		});
	}, []);
	const handleRecipesOpen = React.useCallback(() => {
		dispatchUi({
			type: "setOpen",
			key: "recipesOpen",
			value: true,
		});
	}, []);
	const handleTemplatesOpen = React.useCallback(() => {
		dispatchUi({
			type: "setOpen",
			key: "templatesOpen",
			value: true,
		});
	}, []);
	const handleSettingsOpen = React.useCallback(() => {
		onSettingsOpenChange(true, "Profile");
	}, [onSettingsOpenChange]);

	return {
		...mobileNavigation,
		handleDialogOpenChange,
		handleMarkInboxItemsRead,
		handleRecipesOpen,
		handleSettingsOpen,
		handleTemplatesOpen,
		handleTrashOpenChange,
		chatSearchItems,
		inboxItems,
		navItems,
		recordingNoteId,
		searchItems,
		uiState,
	};
}

export function AppSidebar({
	workspaces,
	activeWorkspaceId,
	currentView,
	inboxOpen,
	user,
	chats,
	automations,
	notes,
	sharedNotes,
	onWorkspaceSelect,
	onWorkspaceCreate,
	onViewChange,
	onInboxOpenChange,
	settingsOpen,
	settingsPage = "Profile",
	onSettingsOpenChange,
	onSignOut,
	signingOut = false,
	desktopSafeTop = false,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	onChatSelect,
	onAddAutomation,
	onNotePrefetch,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onCreateNote,
	...props
}: AppSidebarProps) {
	const { isMobile, setOpenMobile, state } = useSidebarShell();
	const projects = useQuery(
		api.projects.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const model = useAppSidebarModel({
		activeWorkspaceId,
		chats,
		currentNoteId,
		currentNoteTitle,
		currentView,
		inboxOpen,
		isMobile,
		notes,
		projects,
		onChatSelect,
		onCreateNote,
		onInboxOpenChange,
		onNoteSelect,
		onSettingsOpenChange,
		onViewChange,
		onWorkspaceSelect,
		setOpenMobile,
	});

	return (
		<>
			<Sidebar {...props}>
				<AppSidebarHeaderSection
					activeWorkspaceId={activeWorkspaceId}
					currentView={currentView}
					desktopSafeTop={desktopSafeTop}
					inboxOpen={inboxOpen}
					navItems={model.navItems}
					onCreateNote={model.handleCreateNote}
					onInboxOpenChange={model.handleInboxOpenChange}
					onSearchOpen={model.handleSearchOpen}
					onViewChange={model.handleViewChange}
					onWorkspaceCreate={onWorkspaceCreate}
					onWorkspaceSelect={model.handleWorkspaceSelect}
					workspaces={workspaces}
				/>
				<AppSidebarContentSection
					activeWorkspaceId={activeWorkspaceId}
					chats={chats}
					automations={automations}
					currentChatId={currentChatId}
					currentChatTitle={currentChatTitle}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					currentView={currentView}
					onChatSelect={model.handleChatSelect}
					onAddAutomation={onAddAutomation}
					notes={notes}
					onCreateNote={model.handleCreateNote}
					onNotePrefetch={onNotePrefetch}
					onNoteSelect={model.handleNoteSelect}
					onNoteTitleChange={onNoteTitleChange}
					onNoteTrashed={onNoteTrashed}
					projects={projects}
					recordingNoteId={model.recordingNoteId}
					sharedNotes={sharedNotes}
				/>
				<AppSidebarFooterSection
					onRecipesOpen={model.handleRecipesOpen}
					onSettingsOpen={model.handleSettingsOpen}
					onSignOut={onSignOut}
					onTemplatesOpen={model.handleTemplatesOpen}
					onTrashOpenChange={model.handleTrashOpenChange}
					signingOut={signingOut}
					trashOpen={model.uiState.trashOpen}
					user={user}
				/>
			</Sidebar>
			<AppSidebarDialogs
				activeWorkspaceId={activeWorkspaceId}
				chatSearchItems={model.chatSearchItems}
				chatSearchOpen={model.uiState.chatSearchOpen}
				onChatSelect={model.handleChatSelect}
				onNoteSelect={model.handleNoteSelect}
				onOpenChange={model.handleDialogOpenChange}
				onSettingsOpenChange={onSettingsOpenChange}
				searchItems={model.searchItems}
				settingsOpen={settingsOpen}
				settingsPage={settingsPage}
				templatesOpen={model.uiState.templatesOpen}
				recipesOpen={model.uiState.recipesOpen}
				searchOpen={model.uiState.searchOpen}
				user={user}
				workspaces={workspaces}
			/>
			<AppSidebarInboxSheet
				desktopSafeTop={desktopSafeTop}
				inboxItems={model.inboxItems}
				inboxOpen={inboxOpen}
				isMobile={isMobile}
				onInboxOpenChange={model.handleInboxOpenChange}
				onMarkInboxItemsRead={model.handleMarkInboxItemsRead}
				sidebarState={state}
				user={user}
			/>
		</>
	);
}

const AppSidebarFooterSection = React.memo(function AppSidebarFooterSection({
	onRecipesOpen,
	onSettingsOpen,
	onSignOut,
	onTemplatesOpen,
	onTrashOpenChange,
	signingOut,
	trashOpen,
	user,
}: {
	onRecipesOpen: () => void;
	onSettingsOpen: () => void;
	onSignOut: () => void;
	onTemplatesOpen: () => void;
	onTrashOpenChange: (open: boolean) => void;
	signingOut: boolean;
	trashOpen: boolean;
	user: AppSidebarUser;
}) {
	return (
		<SidebarFooter>
			<NavTrash open={trashOpen} onOpenChange={onTrashOpenChange} />
			<NavUser
				user={user}
				onRecipesOpen={onRecipesOpen}
				onTemplatesOpen={onTemplatesOpen}
				onSettingsOpen={onSettingsOpen}
				onSignOut={onSignOut}
				signingOut={signingOut}
			/>
		</SidebarFooter>
	);
});

const AppSidebarHeaderSection = React.memo(function AppSidebarHeaderSection({
	activeWorkspaceId,
	currentView,
	desktopSafeTop,
	inboxOpen,
	navItems,
	onCreateNote,
	onInboxOpenChange,
	onSearchOpen,
	onViewChange,
	onWorkspaceCreate,
	onWorkspaceSelect,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	currentView: AppSidebarView;
	desktopSafeTop: boolean;
	inboxOpen: boolean;
	navItems: AppSidebarNavItem[];
	onCreateNote: () => void;
	onInboxOpenChange: (open: boolean) => void;
	onSearchOpen: () => void;
	onViewChange: (
		view: "home" | "chat" | "automation" | "inbox" | "shared" | "note",
	) => void;
	onWorkspaceCreate: (input: { name: string }) => Promise<WorkspaceRecord>;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	workspaces: Array<WorkspaceRecord>;
}) {
	return (
		<SidebarHeader
			data-app-region={desktopSafeTop ? "drag" : undefined}
			className={desktopSafeTop ? "pt-8" : undefined}
		>
			<div
				data-app-region={desktopSafeTop ? "no-drag" : undefined}
				className={
					desktopSafeTop && currentView !== "notFound" ? "mt-4" : undefined
				}
			>
				<WorkspaceSwitcher
					workspaces={workspaces}
					activeWorkspaceId={activeWorkspaceId}
					onSelect={onWorkspaceSelect}
					onCreateWorkspace={onWorkspaceCreate}
				/>
			</div>
			{desktopSafeTop ? <div aria-hidden="true" className="h-3" /> : null}
			<div data-app-region={desktopSafeTop ? "no-drag" : undefined}>
				<NavMain
					className="px-0"
					items={navItems}
					onCreateNote={onCreateNote}
					onViewChange={onViewChange}
					onSearchOpen={onSearchOpen}
					onInboxToggle={() => onInboxOpenChange(!inboxOpen)}
				/>
			</div>
		</SidebarHeader>
	);
});

const AppSidebarContentSection = React.memo(function AppSidebarContentSection({
	activeWorkspaceId,
	chats,
	automations,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	currentView,
	onChatSelect,
	onAddAutomation,
	notes,
	onCreateNote,
	onNotePrefetch,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	projects,
	recordingNoteId,
	sharedNotes,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	chats: Array<Doc<"chats">> | undefined;
	automations: AutomationListItem[] | undefined;
	currentChatId: string | null;
	currentChatTitle?: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	currentView: AppSidebarView;
	onChatSelect: (chatId: string) => void;
	onAddAutomation?: (chatId: string) => void;
	notes: Array<Doc<"notes">> | undefined;
	onCreateNote: () => void;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	projects: Array<Doc<"projects">> | undefined;
	recordingNoteId: Id<"notes"> | null;
	sharedNotes: Array<Doc<"notes">> | undefined;
}) {
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const activeNoteId = currentView === "note" ? currentNoteId : null;
	const [noteNavigationSource, setNoteNavigationSource] =
		React.useState<NoteNavigationSource | null>(null);
	const sourceNoteIdRef = React.useRef<Id<"notes"> | null>(null);
	const activeNoteNavigationSource =
		sourceNoteIdRef.current === activeNoteId ? noteNavigationSource : null;
	const selectNoteFromSource = React.useCallback(
		(noteId: Id<"notes">, navigationSource: NoteNavigationSource) => {
			sourceNoteIdRef.current = noteId;
			setNoteNavigationSource(navigationSource);
			onNoteSelect(noteId);
		},
		[onNoteSelect],
	);
	const handleStarredNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "starred"),
		[selectNoteFromSource],
	);
	const handleSharedNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "shared"),
		[selectNoteFromSource],
	);
	const handleNotesNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "notes"),
		[selectNoteFromSource],
	);
	const handleProjectNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "projects"),
		[selectNoteFromSource],
	);

	return (
		<SidebarContent>
			<NavStarred
				chats={chats}
				automationChatIds={automationChatIds}
				notes={notes}
				projects={projects}
				workspaceId={activeWorkspaceId}
				currentChatId={currentView === "chat" ? currentChatId : null}
				currentChatTitle={currentChatTitle}
				currentNoteId={activeNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				onChatSelect={onChatSelect}
				onAddAutomation={onAddAutomation}
				onNotePrefetch={onNotePrefetch}
				onNoteSelect={handleStarredNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
			/>
			{(sharedNotes?.length ?? 0) > 0 ? (
				<NavNotes
					notes={sharedNotes}
					title="Shared"
					emptyMessage="No shared notes yet"
					showStarred={false}
					filterProjectNotes={false}
					currentNoteId={activeNoteId}
					currentNoteTitle={currentNoteTitle}
					recordingNoteId={recordingNoteId}
					onPrefetchNote={onNotePrefetch}
					onNoteSelect={handleSharedNoteSelect}
					onNoteTitleChange={onNoteTitleChange}
					onNoteTrashed={onNoteTrashed}
				/>
			) : null}
			<NavNotes
				notes={notes}
				showStarred={false}
				currentNoteId={activeNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				onPrefetchNote={onNotePrefetch}
				onNoteSelect={handleNotesNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
				onCreateNote={onCreateNote}
			/>
			<NavProjects
				projects={projects}
				notes={notes}
				workspaceId={activeWorkspaceId}
				currentNoteId={activeNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				revealActiveNoteProject={activeNoteNavigationSource !== "starred"}
				onPrefetchNote={onNotePrefetch}
				onNoteSelect={handleProjectNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
			/>
		</SidebarContent>
	);
});

const AppSidebarDialogs = React.memo(function AppSidebarDialogs({
	activeWorkspaceId,
	chatSearchItems,
	chatSearchOpen,
	onChatSelect,
	onNoteSelect,
	onOpenChange,
	onSettingsOpenChange,
	searchItems,
	settingsOpen,
	settingsPage,
	templatesOpen,
	recipesOpen,
	searchOpen,
	user,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	chatSearchItems: SearchCommandItem[];
	chatSearchOpen: boolean;
	onChatSelect: (chatId: string) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onOpenChange: (
		key: "searchOpen" | "chatSearchOpen" | "recipesOpen" | "templatesOpen",
		value: boolean,
	) => void;
	onSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	searchItems: SearchCommandItem[];
	settingsOpen: boolean;
	settingsPage: SettingsPage;
	templatesOpen: boolean;
	recipesOpen: boolean;
	searchOpen: boolean;
	user: {
		name: string;
		email: string;
		avatar: string;
	};
	workspaces: Array<WorkspaceRecord>;
}) {
	const handleSearchOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("searchOpen", open),
		[onOpenChange],
	);
	const handleChatSearchOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("chatSearchOpen", open),
		[onOpenChange],
	);
	const handleSearchSelectItem = React.useCallback(
		(itemId: string) => {
			const selectedItem = searchItems.find((item) => item.id === itemId);
			if (!selectedItem) {
				return;
			}

			onNoteSelect(itemId as Id<"notes">);
		},
		[onNoteSelect, searchItems],
	);
	const handleChatSearchSelectItem = React.useCallback(
		(itemId: string) => {
			const selectedItem = chatSearchItems.find((item) => item.id === itemId);
			if (!selectedItem) {
				return;
			}

			onChatSelect(itemId);
		},
		[chatSearchItems, onChatSelect],
	);
	const selectedWorkspace = React.useMemo(
		() =>
			workspaces.find((workspace) => workspace._id === activeWorkspaceId) ??
			null,
		[activeWorkspaceId, workspaces],
	);
	const handleSettingsPageChange = React.useCallback(
		(page: SettingsPage) => onSettingsOpenChange(true, page),
		[onSettingsOpenChange],
	);
	const handleRecipesOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("recipesOpen", open),
		[onOpenChange],
	);
	const handleTemplatesOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("templatesOpen", open),
		[onOpenChange],
	);

	return (
		<>
			<SearchCommand
				open={searchOpen}
				onOpenChange={handleSearchOpenChange}
				items={searchItems}
				workspaceId={activeWorkspaceId}
				showKeyboardHintsFooter
				onSelectItem={handleSearchSelectItem}
			/>
			<SearchCommand
				open={chatSearchOpen}
				onOpenChange={handleChatSearchOpenChange}
				items={chatSearchItems}
				workspaceId={activeWorkspaceId}
				searchKind="chats"
				searchPlaceholder="Search chats..."
				searchDescription="Search chats..."
				showKeyboardHintsFooter
				keyboardHintsSearchKind="chats"
				onSelectItem={handleChatSearchSelectItem}
			/>
			<SettingsDialog
				open={settingsOpen}
				onOpenChange={onSettingsOpenChange}
				user={user}
				workspace={selectedWorkspace}
				initialPage={settingsPage}
				onPageChange={handleSettingsPageChange}
			/>
			<RecipesDialog
				open={recipesOpen}
				onOpenChange={handleRecipesOpenChange}
			/>
			<TemplatesDialog
				open={templatesOpen}
				onOpenChange={handleTemplatesOpenChange}
			/>
		</>
	);
});

const AppSidebarInboxSheet = React.memo(function AppSidebarInboxSheet({
	desktopSafeTop,
	inboxItems,
	inboxOpen,
	isMobile,
	onInboxOpenChange,
	onMarkInboxItemsRead,
	sidebarState,
	user,
}: {
	desktopSafeTop: boolean;
	inboxItems: Array<{ _id: unknown }> | undefined;
	inboxOpen: boolean;
	isMobile: boolean;
	onInboxOpenChange: (open: boolean) => void;
	onMarkInboxItemsRead: (itemIds: string[]) => void;
	sidebarState: "expanded" | "collapsed";
	user: {
		name: string;
		email: string;
		avatar: string;
	};
}) {
	const handleMarkAllRead = React.useCallback(() => {
		if (!inboxItems) {
			return;
		}

		onMarkInboxItemsRead(inboxItems.map((item) => String(item._id)));
	}, [inboxItems, onMarkInboxItemsRead]);

	return (
		<InboxSheet
			open={inboxOpen}
			onOpenChange={onInboxOpenChange}
			sidebarState={sidebarState}
			isMobile={isMobile}
			desktopSafeTop={desktopSafeTop}
			currentUser={user}
			onMarkItemsRead={onMarkInboxItemsRead}
			onMarkAllRead={handleMarkAllRead}
		/>
	);
});
