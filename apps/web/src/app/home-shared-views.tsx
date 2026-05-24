import { openDesktopExternalUrl } from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Icons } from "@workspace/ui/components/icons";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { CalendarClock, FileText, MoreHorizontal } from "lucide-react";
import * as React from "react";
import type { AppUser, UpcomingCalendarEvent } from "@/app/app-types";
import {
	formatUpcomingEventMeta,
	getUpcomingCalendarIndicator,
	isUpcomingEventLive,
	isUpcomingEventToday,
} from "@/app/location";
import { PageTitle } from "@/components/layout/page-title";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { useRecordingNoteId } from "@/hooks/use-transcription-session";
import { formatRelativeTimestamp } from "@/lib/chat-timestamp";
import {
	groupItemsByRelativeDate,
	RELATIVE_DATE_GROUP_SECTIONS,
} from "@/lib/group-by-relative-date";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const HOME_NOTE_SKELETON_IDS = [
	"home-note-skeleton-1",
	"home-note-skeleton-2",
	"home-note-skeleton-3",
] as const;

const getNoteAuthorDisplayName = (note: Doc<"notes">, currentUser: AppUser) =>
	note.authorName?.trim() || currentUser.name;

const formatNoteCreatedTime = (note: Doc<"notes">) =>
	formatRelativeTimestamp(note.createdAt || note._creationTime);

const getNoteCreatedDateTime = (note: Doc<"notes">) =>
	new Date(note.createdAt || note._creationTime).toISOString();

export function HomeView({
	currentDate,
	currentDayOfMonth,
	currentMonthLabel,
	currentWeekdayLabel,
	upcomingCalendarEvents,
	upcomingCalendarStatus,
	isLoadingUpcomingCalendarEvents,
	notes,
	currentNoteId,
	currentNoteTitle,
	currentUser,
	isDesktopMac,
	onOpenNote,
	onNoteTrashed,
	onCreateNote,
	onOpenCalendarEventNote,
	onOpenCalendarSettings,
}: {
	currentDate: Date;
	currentDayOfMonth: number;
	currentMonthLabel: string;
	currentWeekdayLabel: string;
	upcomingCalendarEvents: UpcomingCalendarEvent[];
	upcomingCalendarStatus: "idle" | "ready" | "not_connected" | "error";
	isLoadingUpcomingCalendarEvents: boolean;
	notes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentUser: AppUser;
	isDesktopMac: boolean;
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
}) {
	const visibleUpcomingEvents = [];
	for (const event of upcomingCalendarEvents) {
		if (event.isMeeting && isUpcomingEventToday(event, currentDate)) {
			visibleUpcomingEvents.push(event);
			if (visibleUpcomingEvents.length === 5) {
				break;
			}
		}
	}
	const shouldShowUpcomingCalendarSkeleton =
		isLoadingUpcomingCalendarEvents &&
		upcomingCalendarStatus === "idle" &&
		visibleUpcomingEvents.length === 0;
	const hasLiveUpcomingMeeting = visibleUpcomingEvents.some((event) =>
		isUpcomingEventLive(event, currentDate),
	);
	const upcomingCalendarIndicator = getUpcomingCalendarIndicator({
		hasLiveMeeting: hasLiveUpcomingMeeting,
		status: upcomingCalendarStatus,
	});
	const recordingNoteId = useRecordingNoteId();

	const openMeetingLink = React.useCallback(async (url: string) => {
		if (await openDesktopExternalUrl(url)) {
			return;
		}

		window.open(url, "_blank", "noopener,noreferrer");
	}, []);
	const hasUpcomingEventStarted = React.useCallback(
		(event: UpcomingCalendarEvent) =>
			new Date(event.startAt).getTime() <= currentDate.getTime(),
		[currentDate],
	);

	return (
		<div className="box-border flex w-full max-w-full min-w-0 justify-center px-4 pb-6 md:px-6">
			<div
				className={cn(
					"flex w-full min-w-0 max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 space-y-6 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>Coming up</PageTitle>
					<Card className="max-w-full overflow-hidden rounded-lg border-border py-0 shadow-sm">
						<CardContent className="p-0">
							<div className="grid min-h-[152px] md:grid-cols-[184px_minmax(0,1fr)]">
								<div className="flex items-start border-b border-border/60 px-5 py-4 md:border-b-0 md:border-r">
									<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
										<div className="row-span-2 text-5xl leading-none tracking-tight tabular-nums">
											{currentDayOfMonth}
										</div>
										<div className="flex min-w-0 items-center gap-2 pt-1 text-base leading-none">
											<span>{currentMonthLabel}</span>
											<span
												role="status"
												aria-label={`Calendar status: ${upcomingCalendarIndicator.label}`}
												className="inline-flex"
											>
												<span
													className={cn(
														"size-2 rounded-full",
														upcomingCalendarIndicator.dotClassName,
													)}
												/>
											</span>
										</div>
										<p className="text-base leading-none text-muted-foreground">
											{currentWeekdayLabel}
										</p>
									</div>
								</div>
								<div className="flex min-h-[152px] w-full items-start justify-center p-3">
									{shouldShowUpcomingCalendarSkeleton ? (
										<Empty className="h-full rounded-none border-0 p-4">
											<EmptyHeader>
												<Skeleton className="mb-2 size-8 rounded-lg" />
												<Skeleton className="h-5 w-40 max-w-full" />
												<Skeleton className="h-4 w-56 max-w-full" />
											</EmptyHeader>
											<EmptyContent>
												<Skeleton className="h-9 w-36 rounded-md" />
											</EmptyContent>
										</Empty>
									) : visibleUpcomingEvents.length > 0 ? (
										<div className="w-full p-1">
											<div className="space-y-1.5">
												{visibleUpcomingEvents.map((event) => {
													const isLive = isUpcomingEventLive(
														event,
														currentDate,
													);
													const hasStarted = hasUpcomingEventStarted(event);

													return (
														<div
															key={`${event.id}:${event.startAt}`}
															className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40"
														>
															<div
																className={cn(
																	"h-8 w-1 shrink-0 rounded-full bg-status-planned",
																	isLive && "bg-status-live",
																)}
															/>
															<div className="min-w-0 flex-1">
																<div className="flex items-center justify-between gap-4">
																	<div className="min-w-0">
																		<p className="truncate text-sm font-medium text-foreground">
																			{event.title}
																		</p>
																		<p
																			className={cn(
																				"mt-0.5 text-xs text-muted-foreground",
																				isLive && "text-status-live",
																			)}
																		>
																			{formatUpcomingEventMeta(
																				event,
																				currentDate,
																			)}
																		</p>
																	</div>
																	<Button
																		type="button"
																		variant="default"
																		size="sm"
																		className="shrink-0"
																		onClick={() => {
																			void onOpenCalendarEventNote(event, {
																				autoStartCapture: hasStarted,
																				stopCaptureWhenMeetingEnds: true,
																			});
																			if (event.meetingUrl) {
																				void openMeetingLink(event.meetingUrl);
																			}
																		}}
																	>
																		{event.meetingUrl
																			? "Start now"
																			: "Open note"}
																	</Button>
																</div>
															</div>
														</div>
													);
												})}
											</div>
										</div>
									) : (
										<Empty className="h-full rounded-none border-0 p-4">
											<EmptyHeader>
												<EmptyMedia variant="icon">
													<CalendarClock className="size-4" />
												</EmptyMedia>
												<EmptyTitle>
													{upcomingCalendarStatus === "not_connected"
														? "Connect a calendar"
														: upcomingCalendarStatus === "error"
															? "Couldn’t load calendar"
															: "No upcoming events today"}
												</EmptyTitle>
												<EmptyDescription>
													{upcomingCalendarStatus === "not_connected"
														? "Link your calendar in settings to see upcoming meetings."
														: upcomingCalendarStatus === "error"
															? "Try reconnecting your calendars or refresh the app."
															: "Check your visible calendars for today"}
												</EmptyDescription>
											</EmptyHeader>
											<EmptyContent>
												<Button
													variant="outline"
													onClick={onOpenCalendarSettings}
												>
													Calendar settings
												</Button>
											</EmptyContent>
										</Empty>
									)}
								</div>
							</div>
						</CardContent>
					</Card>
				</section>

				<section className="flex min-w-0 justify-center py-8">
					{notes === undefined ? (
						<HomeNotesSkeleton />
					) : notes.length > 0 ? (
						<NotesList
							notes={notes}
							activeNoteId={currentNoteId}
							activeNoteTitle={currentNoteTitle}
							recordingNoteId={recordingNoteId}
							currentUser={currentUser}
							onOpenNote={onOpenNote}
							onNoteTrashed={onNoteTrashed}
						/>
					) : (
						<Empty className="md:max-w-xl">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileText className="size-4" />
								</EmptyMedia>
								<EmptyTitle>Take your first note</EmptyTitle>
								<EmptyDescription>
									Your meeting notes will appear here
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={onCreateNote}>Quick note</Button>
							</EmptyContent>
						</Empty>
					)}
				</section>
			</div>
		</div>
	);
}

export function SharedView({
	sharedNotes,
	currentNoteId,
	currentNoteTitle,
	currentUser,
	isDesktopMac,
	onOpenNote,
	onNoteTrashed,
}: {
	sharedNotes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentUser: AppUser;
	isDesktopMac: boolean;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	return (
		<div className="box-border flex w-full max-w-full min-w-0 justify-center px-4 pb-6 md:px-6">
			<div
				className={cn(
					"flex w-full min-w-0 max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 space-y-6 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>Shared with others</PageTitle>
					<Card className="max-w-full overflow-hidden rounded-lg border-border py-0 shadow-sm">
						<CardContent
							aria-busy={sharedNotes === undefined}
							className="flex items-start justify-between gap-4 p-5"
						>
							<div>
								{sharedNotes !== undefined ? (
									<p className="text-5xl leading-none tracking-tight tabular-nums">
										{sharedNotes.length}
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>
				</section>
				<section className="flex min-w-0 justify-center py-4">
					{sharedNotes === undefined ? null : sharedNotes.length > 0 ? (
						<div className="w-full md:max-w-xl">
							<SharedNotesList
								notes={sharedNotes}
								activeNoteId={currentNoteId}
								activeNoteTitle={currentNoteTitle}
								currentUser={currentUser}
								onOpenNote={onOpenNote}
								onNoteTrashed={onNoteTrashed}
							/>
						</div>
					) : (
						<Empty className="md:max-w-xl">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileText className="size-4" />
								</EmptyMedia>
								<EmptyTitle>No shared notes yet</EmptyTitle>
								<EmptyDescription>
									Share a note with someone else
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</section>
			</div>
		</div>
	);
}

function HomeNotesSkeleton() {
	return (
		<div className="w-full space-y-3 md:max-w-xl">
			<div className="flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-foreground/70">
				Today
			</div>
			<div className="space-y-2">
				{HOME_NOTE_SKELETON_IDS.map((id) => (
					<div key={id} className="flex items-center gap-3 rounded-lg p-1">
						<Skeleton className="size-8 rounded-lg" />
						<div className="min-w-0 flex-1 space-y-2">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-48" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function SharedNotesList({
	notes,
	activeNoteId,
	activeNoteTitle,
	currentUser,
	onOpenNote,
	onNoteTrashed,
}: {
	notes: Array<Doc<"notes">>;
	activeNoteId: Id<"notes"> | null;
	activeNoteTitle: string;
	currentUser: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	return (
		<NotesList
			notes={notes}
			activeNoteId={activeNoteId}
			activeNoteTitle={activeNoteTitle}
			recordingNoteId={null}
			currentUser={currentUser}
			onOpenNote={onOpenNote}
			onNoteTrashed={onNoteTrashed}
		/>
	);
}

function NotesList({
	notes,
	activeNoteId,
	activeNoteTitle,
	recordingNoteId,
	currentUser,
	onOpenNote,
	onNoteTrashed,
}: {
	notes: Array<Doc<"notes">>;
	activeNoteId: Id<"notes"> | null;
	activeNoteTitle: string;
	recordingNoteId: Id<"notes"> | null;
	currentUser: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	const groupedNotes = groupItemsByRelativeDate(
		notes,
		(note) => note.updatedAt || note.createdAt || note._creationTime,
	);
	const sections = RELATIVE_DATE_GROUP_SECTIONS.map((section) => ({
		...section,
		notes: groupedNotes[section.key],
	}));

	return (
		<div className="w-full space-y-1 md:max-w-xl">
			{sections.map((section) => {
				if (section.notes.length === 0) {
					return null;
				}

				return (
					<div key={section.key} className="space-y-2">
						<div className="flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-foreground/70">
							{section.label}
						</div>
						<div className="space-y-2">
							{section.notes.map((note) => {
								const isActive = note._id === activeNoteId;
								const isRecording = note._id === recordingNoteId;
								const title = getNoteDisplayTitle(
									isActive && activeNoteTitle.trim()
										? activeNoteTitle
										: note.title,
								);
								const authorDisplayName = getNoteAuthorDisplayName(
									note,
									currentUser,
								);
								const createdTime = formatNoteCreatedTime(note);

								return (
									<div
										key={note._id}
										className={cn(
											"group flex items-center rounded-lg p-1 transition-colors hover:bg-accent has-[[data-note-actions]:focus-visible]:bg-transparent has-[[data-note-actions]:hover]:bg-transparent",
											isActive ? "bg-transparent" : "bg-transparent",
										)}
									>
										<button
											type="button"
											onClick={() => onOpenNote(note._id)}
											className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-1 text-left"
										>
											<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
												{isRecording ? (
													<Icons.sidebarRecordingSpinner />
												) : (
													<FileText className="size-4" />
												)}
											</div>
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm font-medium">
													{title}
												</div>
												<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
													<span className="truncate">{authorDisplayName}</span>
													<span aria-hidden="true">·</span>
													<time
														dateTime={getNoteCreatedDateTime(note)}
														className="shrink-0 tabular-nums"
													>
														{createdTime}
													</time>
												</div>
											</div>
										</button>
										<NoteActionsMenu
											noteId={note._id}
											onMoveToTrash={onNoteTrashed}
											align="end"
											showVersionHistory={false}
										>
											<button
												type="button"
												data-note-actions
												className="flex aspect-square size-5 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 outline-hidden transition-[color,opacity] group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 data-[state=open]:text-foreground"
												aria-label={`Open actions for ${title}`}
												onClick={(event) => event.stopPropagation()}
											>
												<MoreHorizontal className="size-4" />
											</button>
										</NoteActionsMenu>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
