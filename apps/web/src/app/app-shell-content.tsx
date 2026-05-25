import { Button } from "@workspace/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import type { UIMessage } from "ai";
import * as React from "react";
import type { AppUser, UpcomingCalendarEvent } from "@/app/app-types";
import { HomeView, SharedView } from "@/app/home-shared-views";
import type { AutomationListItem } from "@/components/automations/automation-types";
import { AutomationsPageEntry } from "@/components/automations/automations-page-entry";
import { ChatPageEntry } from "@/components/chat/chat-page-entry";
import type { NoteEditorActions } from "@/components/note/note-page";
import { NotePageEntry } from "@/components/note/note-page-entry";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type NoteListViewProps = {
	isDesktopMac: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	user: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
};

export type AppShellContentView =
	| ({
			kind: "home";
			currentDate: Date;
			currentDayOfMonth: number;
			currentMonthLabel: string;
			currentWeekdayLabel: string;
			upcomingCalendarEvents: UpcomingCalendarEvent[];
			upcomingCalendarStatus: "idle" | "ready" | "not_connected" | "error";
			isLoadingUpcomingCalendarEvents: boolean;
			notes: Array<Doc<"notes">> | undefined;
			onCreateNote: () => void;
			onOpenCalendarEventNote: (
				event: UpcomingCalendarEvent,
				options?: {
					autoStartCapture?: boolean;
					stopCaptureWhenMeetingEnds?: boolean;
				},
			) => Promise<void> | void;
			onOpenCalendarSettings: () => void;
	  } & NoteListViewProps)
	| ({
			kind: "shared";
			sharedNotes: Array<Doc<"notes">> | undefined;
	  } & NoteListViewProps)
	| {
			kind: "automation";
			automations: AutomationListItem[] | undefined;
			isDesktopMac: boolean;
			onCreateAutomation: () => void;
			onDeleteAutomation: (automationId: Id<"automations">) => void;
			onEditAutomation: (automationId: Id<"automations">) => void;
			onOpenAutomation: (automation: AutomationListItem) => void;
			onRunAutomationNow: (automationId: Id<"automations">) => void;
			onToggleAutomationPaused: (automationId: Id<"automations">) => void;
	  }
	| {
			kind: "note";
			currentNoteId: Id<"notes"> | null;
			currentNoteTitle: string;
			selectedNote: Doc<"notes"> | null | undefined;
			user: AppUser;
			isDesktopMac: boolean;
			onAutoStartNoteCaptureHandled: () => void;
			onNoteCommentsOpenChange: (opener: (() => void) | null) => void;
			onNoteEditorActionsChange: (actions: NoteEditorActions | null) => void;
			onNoteTitleChange: (title: string) => void;
			shouldAutoStartNoteCapture: boolean;
			shouldStopNoteCaptureWhenMeetingEnds: boolean;
	  }
	| {
			kind: "chat";
			activeStreamingChatIds: ReadonlySet<string>;
			automations: AutomationListItem[] | undefined;
			chatComposerId: string;
			chats: Array<Doc<"chats">> | undefined;
			currentChatId: string | null;
			initialChatMessages: UIMessage[];
			isDesktopMac: boolean;
			onChatPersisted?: (chatId: string) => void;
			onChatRemoved: (chatId: string) => void;
			onCreateChatAutomation: (chatId: string) => void;
			onCreateNoteFromChatResponse: (
				title: string,
				content: string,
			) => Promise<"created" | undefined> | "created" | undefined;
			onOpenChat: (chatId: string) => void;
			onOpenConnectionsSettings: () => void;
			onPrefetchChat: (chatId: string) => void;
	  }
	| {
			kind: "notFound";
			onGoHome: () => void;
	  };

export const AppShellContent = React.memo(function AppShellContent({
	view,
}: {
	view: AppShellContentView;
}) {
	const noteViewScrollRef = React.useRef<HTMLDivElement | null>(null);
	const noteScrollResetKey =
		view.kind === "note" ? (view.currentNoteId ?? "new") : null;

	React.useEffect(() => {
		if (noteScrollResetKey === null) {
			return;
		}

		noteViewScrollRef.current?.scrollTo({
			top: 0,
			behavior: "auto",
		});
	}, [noteScrollResetKey]);

	if (view.kind === "notFound") {
		return <NotFoundView onGoHome={view.onGoHome} />;
	}

	if (view.kind === "home") {
		return (
			<ContentScrollArea variant="list">
				<HomeView
					currentDate={view.currentDate}
					currentDayOfMonth={view.currentDayOfMonth}
					currentMonthLabel={view.currentMonthLabel}
					currentWeekdayLabel={view.currentWeekdayLabel}
					upcomingCalendarEvents={view.upcomingCalendarEvents}
					upcomingCalendarStatus={view.upcomingCalendarStatus}
					isLoadingUpcomingCalendarEvents={view.isLoadingUpcomingCalendarEvents}
					notes={view.notes}
					currentNoteId={view.currentNoteId}
					currentNoteTitle={view.currentNoteTitle}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					onOpenNote={view.onOpenNote}
					onNoteTrashed={view.onNoteTrashed}
					onCreateNote={view.onCreateNote}
					onOpenCalendarEventNote={view.onOpenCalendarEventNote}
					onOpenCalendarSettings={view.onOpenCalendarSettings}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "shared") {
		return (
			<ContentScrollArea variant="list">
				<SharedView
					sharedNotes={view.sharedNotes}
					currentNoteId={view.currentNoteId}
					currentNoteTitle={view.currentNoteTitle}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					onOpenNote={view.onOpenNote}
					onNoteTrashed={view.onNoteTrashed}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "automation") {
		return (
			<ContentScrollArea>
				<AutomationsPageEntry
					automations={view.automations}
					isDesktopMac={view.isDesktopMac}
					onCreateAutomation={view.onCreateAutomation}
					onDeleteAutomation={view.onDeleteAutomation}
					onEditAutomation={view.onEditAutomation}
					onOpenAutomation={view.onOpenAutomation}
					onRunAutomationNow={view.onRunAutomationNow}
					onToggleAutomationPaused={view.onToggleAutomationPaused}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "note") {
		return (
			<ContentScrollArea viewportRef={noteViewScrollRef}>
				<NotePageEntry
					key={view.currentNoteId ?? "new"}
					autoStartTranscription={view.shouldAutoStartNoteCapture}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					noteId={view.currentNoteId}
					note={view.selectedNote}
					externalTitle={view.currentNoteTitle}
					onAutoStartTranscriptionHandled={view.onAutoStartNoteCaptureHandled}
					onCommentsOpenChange={view.onNoteCommentsOpenChange}
					onTitleChange={view.onNoteTitleChange}
					onEditorActionsChange={view.onNoteEditorActionsChange}
					scrollParentRef={noteViewScrollRef}
					stopTranscriptionWhenMeetingEnds={
						view.shouldStopNoteCaptureWhenMeetingEnds
					}
				/>
			</ContentScrollArea>
		);
	}

	return (
		<ChatPageEntry
			key={view.chatComposerId}
			chatId={view.chatComposerId}
			initialMessages={view.initialChatMessages}
			onChatPersisted={view.onChatPersisted}
			chats={view.chats ?? []}
			isChatsLoading={view.chats === undefined}
			activeStreamingChatIds={view.activeStreamingChatIds}
			activeChatId={view.currentChatId}
			onOpenChat={view.onOpenChat}
			onPrefetchChat={view.onPrefetchChat}
			onChatRemoved={view.onChatRemoved}
			isDesktopMac={view.isDesktopMac}
			onOpenConnectionsSettings={view.onOpenConnectionsSettings}
			onCreateNoteFromResponse={view.onCreateNoteFromChatResponse}
			automations={view.automations}
			onAddAutomation={view.onCreateChatAutomation}
		/>
	);
});

function ContentScrollArea({
	children,
	variant = "default",
	viewportRef,
}: {
	children: React.ReactNode;
	variant?: "default" | "list";
	viewportRef?: React.Ref<HTMLDivElement>;
}) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			viewportClassName={
				variant === "list"
					? "overscroll-contain overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full"
					: "overscroll-contain"
			}
			viewportRef={viewportRef}
		>
			{children}
		</ScrollArea>
	);
}

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
