"use client";

import type { Editor } from "@tiptap/react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
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
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import {
	useSidebarRight,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import { cn } from "@workspace/ui/lib/utils";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
	ArrowUp,
	Bell,
	BellOff,
	Check,
	Link2,
	LoaderCircle,
	MessageSquareDot,
	MessageSquareMore,
	Minus,
	MoreHorizontal,
	PencilLine,
	SlidersHorizontal,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	DESKTOP_DOCKED_PANEL_MAX_WIDTH,
	DESKTOP_DOCKED_PANEL_MIN_WIDTH,
	MOBILE_DOCKED_PANEL_MIN_WIDTH,
} from "@/components/layout/docked-panel-dimensions";
import {
	DesktopDockedSidePanel,
	DockedPanelPinButton,
	useDockedPanelInset,
} from "@/components/layout/docked-side-panel";
import { parseCssLengthToPixels } from "@/components/layout/parse-css-length";
import {
	ResizableSidePanelHandle,
	useResizableSidePanel,
} from "@/components/layout/resizable-side-panel";
import { useDesktopPanelPin } from "@/components/layout/use-desktop-panel-pin";
import { getDesktopCommentsPanelPinnedStorageKey } from "@/components/note/note-comments-panel-state";
import {
	buildCommentTree,
	type CommentViewer,
	commentsUiReducer,
	type FlattenedThreadComment,
	flattenCommentTree,
	formatCommentTimestamp,
	formatDiscussionTitle,
	getAvatarLabel,
	getErrorMessage,
	INITIAL_COMMENTS_UI_STATE,
	resolveAuthorIdentity,
	THREAD_VIEW_OPTIONS,
	type ThreadView,
} from "@/components/note/note-comments-utils";
import { writeTextToClipboard } from "@/components/note/share-note";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const COMMENTS_PANEL_STORAGE_KEY_DESKTOP =
	"graneri.note-comments-panel-width.desktop";
const COMMENTS_PANEL_STORAGE_KEY_MOBILE =
	"graneri.note-comments-panel-width.mobile";
const INITIAL_VISIBLE_THREAD_COMMENTS = 2;
const THREAD_COMMENT_PAGE_SIZE = 4;

type ThreadSummary = Doc<"noteCommentThreads">;
type ThreadComment = Doc<"noteComments">;
type ThreadDetail = ThreadSummary & { comments: ThreadComment[] };
type FlattenedNoteComment = FlattenedThreadComment<ThreadComment>;

export type PendingNoteCommentSelection = {
	from: number;
	to: number;
	text: string;
};

const collectVisibleThreadOrder = (editor: Editor | null) => {
	const threadIds = new Set<string>();
	const orderedThreadIds: string[] = [];

	if (!editor) {
		return orderedThreadIds;
	}

	editor.state.doc.descendants((node) => {
		for (const mark of node.marks) {
			if (mark.type.name !== "noteComment") {
				continue;
			}

			const threadId =
				typeof mark.attrs.threadId === "string"
					? mark.attrs.threadId.trim()
					: "";
			if (threadId && !threadIds.has(threadId)) {
				threadIds.add(threadId);
				orderedThreadIds.push(threadId);
			}
		}

		return true;
	});

	return orderedThreadIds;
};

function CommentComposerField({
	value,
	onChange,
	onSubmit,
	shouldFocusOnMount = false,
	singleLine = false,
	isSubmitting,
	ariaLabel,
	sendAriaLabel,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	shouldFocusOnMount?: boolean;
	singleLine?: boolean;
	isSubmitting: boolean;
	ariaLabel: string;
	sendAriaLabel: string;
	placeholder: string;
}) {
	const containerRef = React.useRef<HTMLDivElement | null>(null);

	React.useEffect(() => {
		if (!shouldFocusOnMount) {
			return;
		}

		const focusComposerControl = () => {
			const control = containerRef.current?.querySelector(
				'[data-slot="input-group-control"]',
			);

			if (
				!(
					control instanceof HTMLInputElement ||
					control instanceof HTMLTextAreaElement
				)
			) {
				return;
			}

			control.focus({ preventScroll: true });
			const cursorPosition = control.value.length;
			control.setSelectionRange(cursorPosition, cursorPosition);
		};

		const frameId = window.requestAnimationFrame(focusComposerControl);
		const immediateTimeoutId = window.setTimeout(focusComposerControl, 0);
		const delayedTimeoutId = window.setTimeout(focusComposerControl, 50);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.clearTimeout(immediateTimeoutId);
			window.clearTimeout(delayedTimeoutId);
		};
	}, [shouldFocusOnMount]);

	return (
		<div ref={containerRef}>
			<InputGroup
				className={cn(
					"overflow-hidden rounded-lg border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 dark:bg-input/30 dark:has-disabled:bg-input/30",
					singleLine ? "h-12 min-h-0" : "min-h-[96px]",
				)}
			>
				{singleLine ? (
					<InputGroupInput
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" || event.shiftKey) {
								return;
							}

							event.preventDefault();
							onSubmit();
						}}
						placeholder={placeholder}
						aria-label={ariaLabel}
						className="h-full px-4 text-base font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				) : (
					<InputGroupTextarea
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" || event.shiftKey) {
								return;
							}

							event.preventDefault();
							onSubmit();
						}}
						rows={1}
						placeholder={placeholder}
						aria-label={ariaLabel}
						className="min-h-[40px] max-h-52 overflow-y-auto px-4 pt-2 pb-0 text-base font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				)}
				<InputGroupAddon
					align={singleLine ? "inline-end" : "block-end"}
					className={singleLine ? "gap-1 pr-2" : "gap-1 px-4 pb-2.5"}
				>
					<InputGroupButton
						type="button"
						variant="default"
						size="icon-sm"
						className={cn(singleLine ? "rounded-full" : "ml-auto rounded-full")}
						aria-label={sendAriaLabel}
						onClick={onSubmit}
						disabled={isSubmitting || value.trim().length === 0}
					>
						{isSubmitting ? (
							<LoaderCircle className="size-4 animate-spin" />
						) : (
							<ArrowUp className="size-4" />
						)}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}

function CommentComposerDismissButton({
	label,
	onClick,
	showShortcut = false,
}: {
	label: string;
	onClick: () => void;
	showShortcut?: boolean;
}) {
	return (
		<div className="pointer-events-none mb-3 flex justify-center">
			<Button
				type="button"
				variant="ghost"
				className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/80 px-4 py-1.5 text-sm text-secondary-foreground shadow-sm hover:bg-secondary"
				onClick={onClick}
			>
				<span>{label}</span>
				{showShortcut ? (
					<Kbd className="rounded-full border border-border/60 bg-muted px-2">
						Esc
					</Kbd>
				) : null}
			</Button>
		</div>
	);
}

function ThreadCommentNodeItem({
	item,
	currentUser,
	commentActionsOpenId,
	setCommentActionsOpenId,
	handleStartEditComment,
	handleCancelEdit,
	handleDeleteComment,
	editingCommentId,
	editBody,
	isReplySubmitting,
	setEditBody,
	handleSaveEdit,
}: {
	item: FlattenedNoteComment;
	currentUser: CommentViewer;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleCancelEdit: () => void;
	handleDeleteComment: (comment: ThreadComment) => void;
	editingCommentId: Id<"noteComments"> | null;
	editBody: string;
	isReplySubmitting: boolean;
	setEditBody: (value: string) => void;
	handleSaveEdit: () => void;
}) {
	const commentAuthor = resolveAuthorIdentity({
		name: item.comment.authorName,
		currentUser,
	});
	const canManageComment = commentAuthor.name === "You";
	const isEditingComment = editingCommentId === item.comment._id;
	const composerContainerRef = React.useRef<HTMLDivElement | null>(null);

	React.useEffect(() => {
		if (!isEditingComment) {
			return;
		}

		const scrollComposerIntoView = () => {
			composerContainerRef.current?.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
		};

		const frameId = window.requestAnimationFrame(scrollComposerIntoView);
		const timeoutId = window.setTimeout(scrollComposerIntoView, 50);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.clearTimeout(timeoutId);
		};
	}, [isEditingComment]);

	return (
		<div className="min-w-0">
			<div className="group">
				<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1">
					<div className="flex pt-0.5">
						<Avatar className="size-4">
							<AvatarImage
								src={commentAuthor.avatarSrc ?? undefined}
								alt={commentAuthor.name}
							/>
							<AvatarFallback className="text-[9px] font-medium">
								{getAvatarLabel(commentAuthor.name)}
							</AvatarFallback>
						</Avatar>
					</div>
					<div className="min-w-0">
						<div className="flex items-start justify-between gap-3">
							<p className="truncate text-sm font-medium">
								{commentAuthor.name}
							</p>
							<div className="relative flex min-w-[6.5rem] shrink-0 items-start justify-end pt-0.5">
								<span
									className={cn(
										"pointer-events-none text-xs text-muted-foreground transition-opacity duration-150",
										commentActionsOpenId === item.comment._id
											? "opacity-0"
											: "opacity-100 group-hover:opacity-0 group-focus-within:opacity-0",
									)}
								>
									{formatCommentTimestamp(item.comment.createdAt)}
								</span>
								<div
									className={cn(
										"absolute top-0 right-0 flex items-center gap-1 transition-opacity duration-150",
										commentActionsOpenId === item.comment._id
											? "opacity-100"
											: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
									)}
								>
									<DropdownMenu
										modal
										open={commentActionsOpenId === item.comment._id}
										onOpenChange={(nextOpen) =>
											setCommentActionsOpenId(
												nextOpen ? item.comment._id : null,
											)
										}
									>
										<DropdownMenuTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="size-6 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
												aria-label="Comment actions"
											>
												<MoreHorizontal className="size-4" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="end"
											className="min-w-36"
											onCloseAutoFocus={(event) => event.preventDefault()}
										>
											{canManageComment ? (
												<DropdownMenuItem
													className="cursor-pointer"
													onSelect={() => handleStartEditComment(item.comment)}
												>
													<PencilLine className="size-4" />
													<span>Edit</span>
												</DropdownMenuItem>
											) : null}
											{canManageComment ? <DropdownMenuSeparator /> : null}
											{canManageComment ? (
												<DropdownMenuItem
													variant="destructive"
													className="cursor-pointer"
													onSelect={() => handleDeleteComment(item.comment)}
												>
													<Trash2 className="size-4" />
													<span>Delete</span>
												</DropdownMenuItem>
											) : null}
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>
						</div>
						{isEditingComment ? (
							<div ref={composerContainerRef} className="mt-3">
								<CommentComposerDismissButton
									label="Cancel edit"
									onClick={handleCancelEdit}
									showShortcut
								/>
								<CommentComposerField
									key={`${item.comment._id}:edit`}
									value={editBody}
									onChange={setEditBody}
									onSubmit={handleSaveEdit}
									shouldFocusOnMount
									singleLine
									isSubmitting={isReplySubmitting}
									ariaLabel="Edit comment"
									sendAriaLabel="Save comment"
									placeholder="Edit Comment..."
								/>
							</div>
						) : (
							<p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
								{item.comment.body}
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function DiscussionThreadRow({
	thread,
	currentUser,
	activeThreadId,
	expandedThreadId,
	editingCommentId,
	threadActionsOpenId,
	expandedThread,
	optimisticReadThreadIds,
	isReplySubmitting,
	replyBody,
	handleMarkThreadRead,
	handleMarkThreadUnread,
	handleCopyThreadLink,
	handleToggleMuteThread,
	handleDeleteThread,
	handleOpenThread,
	handlePrefetchThread,
	commentActionsOpenId,
	setCommentActionsOpenId,
	editBody,
	setEditBody,
	setReplyBody,
	handleSaveEdit,
	handleCancelEdit,
	handleReply,
	handleStartEditComment,
	handleDeleteComment,
	setThreadActionsOpenId,
}: {
	thread: ThreadSummary;
	currentUser: CommentViewer;
	activeThreadId: Id<"noteCommentThreads"> | null;
	expandedThreadId: Id<"noteCommentThreads"> | null;
	editingCommentId: Id<"noteComments"> | null;
	threadActionsOpenId: Id<"noteCommentThreads"> | null;
	expandedThread: ThreadDetail | null | undefined;
	optimisticReadThreadIds: Set<string>;
	isReplySubmitting: boolean;
	replyBody: string;
	handleMarkThreadRead: (thread: ThreadSummary) => void;
	handleMarkThreadUnread: (threadId: Id<"noteCommentThreads">) => void;
	handleCopyThreadLink: (threadId: Id<"noteCommentThreads">) => Promise<void>;
	handleToggleMuteThread: (thread: ThreadSummary) => void;
	handleDeleteThread: (threadId: Id<"noteCommentThreads">) => void;
	handleOpenThread: (thread: ThreadSummary) => void;
	handlePrefetchThread: (threadId: Id<"noteCommentThreads">) => void;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	editBody: string;
	setEditBody: (value: string) => void;
	setReplyBody: (value: string) => void;
	handleSaveEdit: () => void;
	handleCancelEdit: () => void;
	handleReply: () => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleDeleteComment: (comment: ThreadComment) => void;
	setThreadActionsOpenId: (threadId: Id<"noteCommentThreads"> | null) => void;
}) {
	const isActive = activeThreadId === thread._id;
	const isExpanded = expandedThreadId === thread._id;
	const isEditComposerOpen =
		isExpanded &&
		editingCommentId !== null &&
		expandedThread?.comments.some(
			(comment) => comment._id === editingCommentId,
		) === true;
	const isRead =
		thread.isRead || optimisticReadThreadIds.has(String(thread._id));
	const expandedDetail = !isExpanded
		? undefined
		: expandedThread === undefined
			? undefined
			: expandedThread && expandedThread._id === thread._id
				? expandedThread
				: null;
	const threadAuthor = resolveAuthorIdentity({
		name: thread.createdByName,
		currentUser,
	});

	return (
		<div className={cn(!isExpanded && !isEditComposerOpen && "border-b")}>
			<DiscussionThreadSummary
				thread={thread}
				threadAuthor={threadAuthor}
				isRead={isRead}
				isActive={isActive}
				isExpanded={isExpanded}
				threadActionsOpenId={threadActionsOpenId}
				setThreadActionsOpenId={setThreadActionsOpenId}
				handleMarkThreadRead={handleMarkThreadRead}
				handleMarkThreadUnread={handleMarkThreadUnread}
				handleCopyThreadLink={handleCopyThreadLink}
				handleToggleMuteThread={handleToggleMuteThread}
				handleDeleteThread={handleDeleteThread}
				handleOpenThread={handleOpenThread}
				handlePrefetchThread={handlePrefetchThread}
			/>

			{isExpanded ? (
				expandedDetail === null ? (
					<div className="mx-4 mt-4 border-b pb-4 text-sm text-muted-foreground">
						This discussion is no longer available.
					</div>
				) : expandedDetail ? (
					<ExpandedDiscussionThread
						key={expandedDetail._id}
						expandedDetail={expandedDetail}
						currentUser={currentUser}
						commentActionsOpenId={commentActionsOpenId}
						setCommentActionsOpenId={setCommentActionsOpenId}
						editingCommentId={editingCommentId}
						editBody={editBody}
						replyBody={replyBody}
						isReplySubmitting={isReplySubmitting}
						setEditBody={setEditBody}
						setReplyBody={setReplyBody}
						handleSaveEdit={handleSaveEdit}
						handleCancelEdit={handleCancelEdit}
						handleReply={handleReply}
						handleStartEditComment={handleStartEditComment}
						handleDeleteComment={handleDeleteComment}
					/>
				) : null
			) : null}
		</div>
	);
}

function DiscussionThreadSummary({
	thread,
	threadAuthor,
	isRead,
	isActive,
	isExpanded,
	threadActionsOpenId,
	setThreadActionsOpenId,
	handleMarkThreadRead,
	handleMarkThreadUnread,
	handleCopyThreadLink,
	handleToggleMuteThread,
	handleDeleteThread,
	handleOpenThread,
	handlePrefetchThread,
}: {
	thread: ThreadSummary;
	threadAuthor: ReturnType<typeof resolveAuthorIdentity>;
	isRead: boolean;
	isActive: boolean;
	isExpanded: boolean;
	threadActionsOpenId: Id<"noteCommentThreads"> | null;
	setThreadActionsOpenId: (threadId: Id<"noteCommentThreads"> | null) => void;
	handleMarkThreadRead: (thread: ThreadSummary) => void;
	handleMarkThreadUnread: (threadId: Id<"noteCommentThreads">) => void;
	handleCopyThreadLink: (threadId: Id<"noteCommentThreads">) => Promise<void>;
	handleToggleMuteThread: (thread: ThreadSummary) => void;
	handleDeleteThread: (threadId: Id<"noteCommentThreads">) => void;
	handleOpenThread: (thread: ThreadSummary) => void;
	handlePrefetchThread: (threadId: Id<"noteCommentThreads">) => void;
}) {
	return (
		<div
			className={cn(
				"group transition-colors hover:bg-accent/20",
				isActive && "bg-accent/10",
			)}
		>
			<div className="flex items-start gap-3 p-3">
				<button
					type="button"
					className={cn(
						"min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
						isRead && "opacity-50",
					)}
					aria-expanded={isExpanded}
					aria-label={formatDiscussionTitle(
						threadAuthor.name,
						thread.latestCommentIsReply ?? false,
					)}
					onFocus={() => handlePrefetchThread(thread._id)}
					onClick={() => handleOpenThread(thread)}
					onPointerEnter={() => handlePrefetchThread(thread._id)}
				>
					<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1">
						<div className="flex pt-0.5">
							<Avatar className="size-4">
								<AvatarImage
									src={threadAuthor.avatarSrc ?? undefined}
									alt={threadAuthor.name}
								/>
								<AvatarFallback className="text-[9px] font-medium">
									{getAvatarLabel(threadAuthor.name)}
								</AvatarFallback>
							</Avatar>
						</div>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">
								{formatDiscussionTitle(
									threadAuthor.name,
									thread.latestCommentIsReply ?? false,
								)}
							</p>
						</div>
						<div className="col-start-2 min-w-0">
							<p className="truncate text-xs leading-4 text-muted-foreground">
								{thread.excerpt}
							</p>
						</div>
						{isExpanded ? null : (
							<div className="col-start-2 min-w-0">
								<p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
									{thread.latestCommentPreview}
								</p>
							</div>
						)}
					</div>
					{isExpanded ? null : (
						<div className="pl-6 pt-3">
							<Button
								asChild
								type={undefined}
								variant="outline"
								size="sm"
								className="pointer-events-none text-xs"
							>
								<span>Reply</span>
							</Button>
						</div>
					)}
				</button>
				<div className="relative flex min-w-[3.75rem] shrink-0 items-start justify-end pt-0.5">
					<span
						className={cn(
							"pointer-events-none text-xs text-muted-foreground transition-opacity duration-150",
							threadActionsOpenId === thread._id
								? "opacity-0"
								: isRead
									? "opacity-50 group-hover:opacity-0 group-focus-within:opacity-0"
									: "opacity-100 group-hover:opacity-0 group-focus-within:opacity-0",
						)}
					>
						{formatCommentTimestamp(thread.lastCommentAt)}
					</span>
					<DropdownMenu
						modal
						open={threadActionsOpenId === thread._id}
						onOpenChange={(nextOpen) =>
							setThreadActionsOpenId(nextOpen ? thread._id : null)
						}
					>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className={cn(
									"absolute top-0 right-0 z-10 h-6 w-6 cursor-pointer rounded-md text-muted-foreground transition-[opacity,color,background-color] duration-150 hover:bg-accent hover:text-foreground",
									threadActionsOpenId === thread._id
										? "opacity-100"
										: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
								)}
								aria-label="Comment actions"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-40">
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() =>
									isRead
										? handleMarkThreadUnread(thread._id)
										: handleMarkThreadRead(thread)
								}
							>
								{isRead ? (
									<MessageSquareDot className="size-4" />
								) : (
									<Check className="size-4" />
								)}
								<span>{isRead ? "Mark as unread" : "Mark as read"}</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() => void handleCopyThreadLink(thread._id)}
							>
								<Link2 className="size-4" />
								<span>Copy link</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() => handleToggleMuteThread(thread)}
							>
								{thread.isMutedReplies ? (
									<Bell className="size-4" />
								) : (
									<BellOff className="size-4" />
								)}
								<span>
									{thread.isMutedReplies ? "Unmute replies" : "Mute replies"}
								</span>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								className="cursor-pointer"
								onSelect={() => handleDeleteThread(thread._id)}
							>
								<Trash2 className="size-4" />
								<span>Delete</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</div>
	);
}

function ExpandedDiscussionThread({
	expandedDetail,
	currentUser,
	commentActionsOpenId,
	setCommentActionsOpenId,
	editingCommentId,
	editBody,
	replyBody,
	isReplySubmitting,
	setEditBody,
	setReplyBody,
	handleSaveEdit,
	handleCancelEdit,
	handleReply,
	handleStartEditComment,
	handleDeleteComment,
}: {
	expandedDetail: ThreadDetail;
	currentUser: CommentViewer;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	editingCommentId: Id<"noteComments"> | null;
	editBody: string;
	replyBody: string;
	isReplySubmitting: boolean;
	setEditBody: (value: string) => void;
	setReplyBody: (value: string) => void;
	handleSaveEdit: () => void;
	handleCancelEdit: () => void;
	handleReply: () => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleDeleteComment: (comment: ThreadComment) => void;
}) {
	const isEditingComment = editingCommentId !== null;
	const commentTree = React.useMemo(
		() => buildCommentTree(expandedDetail.comments),
		[expandedDetail.comments],
	);
	const flattenedComments = React.useMemo(
		() => flattenCommentTree(commentTree),
		[commentTree],
	);
	const rootComment = flattenedComments[0] ?? null;
	const replyComments = React.useMemo(
		() => flattenedComments.slice(rootComment ? 1 : 0),
		[flattenedComments, rootComment],
	);
	const initialVisibleReplyCount = Math.min(
		INITIAL_VISIBLE_THREAD_COMMENTS,
		replyComments.length,
	);
	const [visibleReplyCount, setVisibleReplyCount] = React.useReducer(
		(current: number, next: number | ((current: number) => number)) =>
			typeof next === "function" ? next(current) : next,
		initialVisibleReplyCount,
	);
	const hiddenReplyCount = Math.max(
		replyComments.length - visibleReplyCount,
		0,
	);
	const canCollapseToRecent =
		replyComments.length > initialVisibleReplyCount && hiddenReplyCount === 0;
	const historyToggleLabel =
		hiddenReplyCount > 0
			? "Show more"
			: canCollapseToRecent
				? "Show less"
				: null;
	const visibleReplyComments =
		visibleReplyCount > 0
			? replyComments.slice(-visibleReplyCount)
			: replyComments;

	React.useEffect(() => {
		const activeTargetIndex = editingCommentId
			? replyComments.findIndex((item) => item.comment._id === editingCommentId)
			: -1;
		const requiredVisibleCount =
			activeTargetIndex >= 0 ? replyComments.length - activeTargetIndex : 0;

		setVisibleReplyCount((current) => {
			const next = Math.min(
				replyComments.length,
				Math.max(current, initialVisibleReplyCount, requiredVisibleCount),
			);
			return current === next ? current : next;
		});
	}, [editingCommentId, initialVisibleReplyCount, replyComments]);

	return (
		<div className="mx-4 mt-4 border-b pb-4">
			<div className="space-y-4">
				{rootComment ? (
					<ThreadCommentNodeItem
						key={rootComment.comment._id}
						item={rootComment}
						currentUser={currentUser}
						commentActionsOpenId={commentActionsOpenId}
						setCommentActionsOpenId={setCommentActionsOpenId}
						handleStartEditComment={handleStartEditComment}
						handleCancelEdit={handleCancelEdit}
						handleDeleteComment={handleDeleteComment}
						editingCommentId={editingCommentId}
						editBody={editBody}
						isReplySubmitting={isReplySubmitting}
						setEditBody={setEditBody}
						handleSaveEdit={handleSaveEdit}
					/>
				) : null}
				{historyToggleLabel ? (
					<div className="pt-1 pb-3">
						<button
							type="button"
							className="inline-flex h-auto w-fit cursor-pointer items-center gap-2 rounded-sm px-0 text-xs font-normal text-muted-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:size-4 [&>svg]:shrink-0"
							onClick={() =>
								hiddenReplyCount > 0
									? setVisibleReplyCount((current) =>
											Math.min(
												replyComments.length,
												current + THREAD_COMMENT_PAGE_SIZE,
											),
										)
									: setVisibleReplyCount(initialVisibleReplyCount)
							}
						>
							<MoreHorizontal />
							<span>{historyToggleLabel}</span>
						</button>
					</div>
				) : null}
				{visibleReplyComments.length > 0 ? (
					<div className="ml-3 border-l border-border/60 pl-4 space-y-4">
						{visibleReplyComments.map((item) => (
							<ThreadCommentNodeItem
								key={item.comment._id}
								item={item}
								currentUser={currentUser}
								commentActionsOpenId={commentActionsOpenId}
								setCommentActionsOpenId={setCommentActionsOpenId}
								handleStartEditComment={handleStartEditComment}
								handleCancelEdit={handleCancelEdit}
								handleDeleteComment={handleDeleteComment}
								editingCommentId={editingCommentId}
								editBody={editBody}
								isReplySubmitting={isReplySubmitting}
								setEditBody={setEditBody}
								handleSaveEdit={handleSaveEdit}
							/>
						))}
					</div>
				) : null}
			</div>

			{expandedDetail.isResolved || isEditingComment ? null : (
				<div className="mt-4">
					<CommentComposerField
						key={`${expandedDetail._id}:reply`}
						value={replyBody}
						onChange={setReplyBody}
						onSubmit={handleReply}
						shouldFocusOnMount
						singleLine
						isSubmitting={isReplySubmitting}
						ariaLabel="Reply to thread"
						sendAriaLabel="Send reply"
						placeholder="Reply..."
					/>
				</div>
			)}
		</div>
	);
}

type CommentsSheetBodyProps = {
	pendingSelection: PendingNoteCommentSelection | null;
	draftBody: string;
	setDraftBody: (value: string) => void;
	handleCreateThread: () => void;
	isCreating: boolean;
	visibleThreads: ThreadSummary[] | null | undefined;
	activeThreadId: Id<"noteCommentThreads"> | null;
	expandedThreadId: Id<"noteCommentThreads"> | null;
	editingCommentId: Id<"noteComments"> | null;
	expandedThread: ThreadDetail | null | undefined;
	optimisticReadThreadIds: Set<string>;
	currentUser: CommentViewer;
	threadActionsOpenId: Id<"noteCommentThreads"> | null;
	setThreadActionsOpenId: (threadId: Id<"noteCommentThreads"> | null) => void;
	handleMarkThreadRead: (thread: ThreadSummary) => void;
	handleMarkThreadUnread: (threadId: Id<"noteCommentThreads">) => void;
	handleCopyThreadLink: (threadId: Id<"noteCommentThreads">) => Promise<void>;
	handleToggleMuteThread: (thread: ThreadSummary) => void;
	handleDeleteThread: (threadId: Id<"noteCommentThreads">) => void;
	handleOpenThread: (thread: ThreadSummary) => void;
	handlePrefetchThread: (threadId: Id<"noteCommentThreads">) => void;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	editBody: string;
	replyBody: string;
	isReplySubmitting: boolean;
	setEditBody: (value: string) => void;
	setReplyBody: (value: string) => void;
	handleSaveEdit: () => void;
	handleCancelEdit: () => void;
	handleReply: () => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleDeleteComment: (comment: ThreadComment) => void;
};

const CommentsSheetBody = React.memo(function CommentsSheetBody({
	pendingSelection,
	draftBody,
	setDraftBody,
	handleCreateThread,
	isCreating,
	visibleThreads,
	activeThreadId,
	expandedThreadId,
	editingCommentId,
	expandedThread,
	optimisticReadThreadIds,
	currentUser,
	threadActionsOpenId,
	setThreadActionsOpenId,
	handleMarkThreadRead,
	handleMarkThreadUnread,
	handleCopyThreadLink,
	handleToggleMuteThread,
	handleDeleteThread,
	handleOpenThread,
	handlePrefetchThread,
	commentActionsOpenId,
	setCommentActionsOpenId,
	editBody,
	replyBody,
	isReplySubmitting,
	setEditBody,
	setReplyBody,
	handleSaveEdit,
	handleCancelEdit,
	handleReply,
	handleStartEditComment,
	handleDeleteComment,
}: CommentsSheetBodyProps) {
	const threadList = visibleThreads ?? [];

	return (
		<ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
			{visibleThreads === undefined ? null : threadList.length === 0 &&
				!pendingSelection ? (
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessageSquareMore className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No discussions yet</EmptyTitle>
						<EmptyDescription>
							Select text in the note to start the first thread.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div>
					{threadList.map((thread) => (
						<DiscussionThreadRow
							key={thread._id}
							thread={thread}
							currentUser={currentUser}
							activeThreadId={activeThreadId}
							expandedThreadId={expandedThreadId}
							editingCommentId={editingCommentId}
							threadActionsOpenId={threadActionsOpenId}
							expandedThread={expandedThread}
							optimisticReadThreadIds={optimisticReadThreadIds}
							isReplySubmitting={isReplySubmitting}
							replyBody={replyBody}
							handleMarkThreadRead={handleMarkThreadRead}
							handleMarkThreadUnread={handleMarkThreadUnread}
							handleCopyThreadLink={handleCopyThreadLink}
							handleToggleMuteThread={handleToggleMuteThread}
							handleDeleteThread={handleDeleteThread}
							handleOpenThread={handleOpenThread}
							handlePrefetchThread={handlePrefetchThread}
							commentActionsOpenId={commentActionsOpenId}
							setCommentActionsOpenId={setCommentActionsOpenId}
							editBody={editBody}
							setEditBody={setEditBody}
							setReplyBody={setReplyBody}
							handleSaveEdit={handleSaveEdit}
							handleCancelEdit={handleCancelEdit}
							handleReply={handleReply}
							handleStartEditComment={handleStartEditComment}
							handleDeleteComment={handleDeleteComment}
							setThreadActionsOpenId={setThreadActionsOpenId}
						/>
					))}
					{pendingSelection ? (
						<div className="bg-accent/10 p-4">
							<p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">
								{pendingSelection.text}
							</p>
							<CommentComposerField
								key={`${pendingSelection.from}:${pendingSelection.to}:${pendingSelection.text}`}
								value={draftBody}
								onChange={setDraftBody}
								onSubmit={handleCreateThread}
								shouldFocusOnMount
								isSubmitting={isCreating}
								ariaLabel="New comment"
								sendAriaLabel="Send comment"
								placeholder="Add comment..."
							/>
						</div>
					) : null}
				</div>
			)}
		</ScrollArea>
	);
});

function CommentsSheetPanel({
	isMobile,
	open,
	desktopSafeTop,
	isPinned,
	filtersOpen,
	setFiltersOpen,
	view,
	setView,
	onTogglePinned,
	onOpenChange,
	...bodyProps
}: {
	isMobile: boolean;
	open: boolean;
	desktopSafeTop: boolean;
	isPinned: boolean;
	filtersOpen: boolean;
	setFiltersOpen: (open: boolean) => void;
	view: ThreadView;
	setView: (view: ThreadView) => void;
	onTogglePinned: () => void;
	onOpenChange: (open: boolean) => void;
} & CommentsSheetBodyProps) {
	const handleClose = React.useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.currentTarget.blur();

			if (!isMobile && isPinned) {
				onTogglePinned();
			}

			onOpenChange(false);
		},
		[isMobile, isPinned, onOpenChange, onTogglePinned],
	);

	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<div
				data-app-region={!isMobile && open ? "no-drag" : undefined}
				className={cn(
					"flex w-full items-center justify-between",
					!isMobile && (desktopSafeTop ? "h-10 px-2" : "h-16 px-4"),
					isMobile && "px-4 py-3",
				)}
			>
				{isMobile ? (
					<h2
						className={cn(
							"truncate text-sm font-medium",
							desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
							desktopSafeTop && "mt-1",
						)}
					>
						All discussions
					</h2>
				) : (
					<Breadcrumb
						className={
							desktopSafeTop ? DESKTOP_MAIN_HEADER_CONTENT_CLASS : undefined
						}
					>
						<BreadcrumbList className="gap-0">
							<BreadcrumbItem>
								<BreadcrumbPage>All discussions</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				)}
				<div
					className={cn(
						"flex items-center gap-0.5",
						desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						desktopSafeTop && isMobile && "mt-1",
					)}
				>
					<DropdownMenu open={filtersOpen} onOpenChange={setFiltersOpen}>
						<Tooltip>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Filter comments"
									>
										<SlidersHorizontal className="size-4" />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								align="end"
								sideOffset={8}
								className="pointer-events-none select-none"
							>
								Filter comments
							</TooltipContent>
						</Tooltip>
						<DropdownMenuContent align="end" className="min-w-44">
							{THREAD_VIEW_OPTIONS.map((option) => (
								<DropdownMenuItem
									key={option.value}
									onSelect={() => setView(option.value)}
								>
									<span>{option.label}</span>
									{view === option.value ? (
										<Check className="ml-auto size-4 text-foreground" />
									) : null}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					{!isMobile ? (
						<DockedPanelPinButton
							isPinned={isPinned}
							label="comments"
							onTogglePinned={onTogglePinned}
						/>
					) : null}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={handleClose}
							>
								<Minus className="size-4" />
								<span className="sr-only">Close comments</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent
							side="bottom"
							align="end"
							sideOffset={8}
							className="pointer-events-none select-none"
						>
							Hide comments
						</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<CommentsSheetBody {...bodyProps} />
		</div>
	);
}

type NoteCommentsSheetProps = {
	noteId: Id<"notes"> | null;
	noteContent: string;
	editor: Editor | null;
	currentUser: CommentViewer;
	open: boolean;
	desktopSafeTop?: boolean;
	onOpenChange: (open: boolean) => void;
	onPinnedChange?: (isPinned: boolean) => void;
	activeThreadId: Id<"noteCommentThreads"> | null;
	onActiveThreadIdChange: (threadId: Id<"noteCommentThreads"> | null) => void;
	pendingSelection: PendingNoteCommentSelection | null;
	onPendingSelectionChange: (
		selection: PendingNoteCommentSelection | null,
	) => void;
};

type NoteCommentsSheetControllerProps = NoteCommentsSheetProps & {
	isPinned: boolean;
	leftSidebarReservedWidth: number;
	onTogglePinned: () => void;
	rightSidebarReservedWidth: number;
};

function useNoteCommentsSheetController({
	noteId,
	noteContent,
	editor,
	currentUser,
	open,
	desktopSafeTop = false,
	isPinned,
	leftSidebarReservedWidth,
	onTogglePinned,
	rightSidebarReservedWidth,
	onOpenChange,
	activeThreadId,
	onActiveThreadIdChange,
	pendingSelection,
	onPendingSelectionChange,
}: NoteCommentsSheetControllerProps) {
	const isMobile = useIsMobile();
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "right",
			desktopStorageKey: COMMENTS_PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: COMMENTS_PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
			desktopLeadingOffset: leftSidebarReservedWidth,
			desktopTrailingOffset: rightSidebarReservedWidth,
		});
	const workspaceId = useActiveWorkspaceId();
	const convex = useConvex();
	const [uiState, setUiState] = React.useReducer(
		commentsUiReducer,
		INITIAL_COMMENTS_UI_STATE,
	);
	const {
		view,
		draftBody,
		replyBody,
		editBody,
		expandedThreadId,
		editingThreadId,
		editingCommentId,
		threadActionsOpenId,
		commentActionsOpenId,
		filtersOpen,
	} = uiState;
	const [optimisticReadThreadIds, setOptimisticReadThreadIds] = React.useState<
		Set<string>
	>(() => new Set());
	const [visibleThreadOrder, setVisibleThreadOrder] = React.useState<string[]>(
		// react-doctor-disable-next-line react-doctor/no-event-handler
		() => collectVisibleThreadOrder(editor),
	);
	const lastAnchorSyncKeyRef = React.useRef<string>("");
	const lastSyncedActiveThreadIdRef =
		React.useRef<Id<"noteCommentThreads"> | null>(null);
	const lastThreadDetailCacheScopeKeyRef = React.useRef<string>("");
	const prefetchedThreadDetailsRef = React.useRef<Map<
		string,
		ThreadDetail | null
	> | null>(null);
	if (prefetchedThreadDetailsRef.current === null) {
		prefetchedThreadDetailsRef.current = new Map();
	}
	const prefetchedThreadDetails = prefetchedThreadDetailsRef.current;
	const inFlightThreadDetailPrefetchesRef = React.useRef<Map<
		string,
		Promise<ThreadDetail | null>
	> | null>(null);
	if (inFlightThreadDetailPrefetchesRef.current === null) {
		inFlightThreadDetailPrefetchesRef.current = new Map();
	}
	const inFlightThreadDetailPrefetches =
		inFlightThreadDetailPrefetchesRef.current;
	const [, forceThreadDetailCacheRender] = React.useReducer(
		(count: number) => count + 1,
		0,
	);
	const [isCreating, startCreating] = React.useTransition();
	const [isReplySubmitting, startReplying] = React.useTransition();
	const setDraftBody = React.useCallback(
		(value: string) => setUiState({ draftBody: value }),
		[],
	);
	const setReplyBody = React.useCallback(
		(value: string) => setUiState({ replyBody: value }),
		[],
	);
	const setEditBody = React.useCallback(
		(value: string) => setUiState({ editBody: value }),
		[],
	);
	const collapseExpandedThread = React.useCallback(() => {
		setUiState({ expandedThreadId: null });
	}, []);
	const syncEditingThreadStarterComment = React.useCallback(
		(thread: ThreadDetail) => {
			const starterComment =
				thread.comments.find((comment) => !comment.parentCommentId) ??
				thread.comments[0];

			if (!starterComment) {
				setUiState({
					editingThreadId: null,
					editingCommentId: null,
					editBody: "",
				});
				return;
			}

			setUiState({
				editingCommentId: starterComment._id,
				editBody: starterComment.body,
				editingThreadId: null,
			});
		},
		[],
	);

	const threads = useQuery(
		api.noteComments.listThreads,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		workspaceId && noteId
			? {
					workspaceId,
					noteId,
					view,
				}
			: "skip",
	);
	const expandedThread = useQuery(
		api.noteComments.getThread,
		workspaceId && noteId && expandedThreadId
			? {
					workspaceId,
					noteId,
					threadId: expandedThreadId,
				}
			: "skip",
	) as ThreadDetail | null | undefined;
	const createThread = useMutation(api.noteComments.createThread);
	const addComment = useMutation(api.noteComments.addComment);
	const markRead = useMutation(api.noteComments.markRead);
	const markUnread = useMutation(api.noteComments.markUnread);
	const updateComment = useMutation(api.noteComments.updateComment);
	const deleteComment = useMutation(api.noteComments.deleteComment);
	const toggleMuteReplies = useMutation(api.noteComments.toggleMuteReplies);
	const deleteThread = useMutation(api.noteComments.deleteThread);
	const visibleThreadIdSet = React.useMemo(
		// react-doctor-disable-next-line react-doctor/no-event-handler
		() => new Set(visibleThreadOrder),
		[visibleThreadOrder],
	);
	const visibleThreads = React.useMemo(() => {
		if (!threads) {
			return threads;
		}

		const orderedThreads = threads.filter((thread) =>
			visibleThreadIdSet.has(String(thread._id)),
		);
		const threadIndexById = new Map(
			visibleThreadOrder.map((threadId, index) => [threadId, index]),
		);

		return orderedThreads.sort(
			(left, right) =>
				(threadIndexById.get(String(left._id)) ?? Number.POSITIVE_INFINITY) -
				(threadIndexById.get(String(right._id)) ?? Number.POSITIVE_INFINITY),
		);
	}, [threads, visibleThreadIdSet, visibleThreadOrder]);
	const cachedExpandedThread = expandedThreadId
		? prefetchedThreadDetails.get(String(expandedThreadId))
		: undefined;
	const resolvedExpandedThread =
		expandedThread !== undefined ? expandedThread : cachedExpandedThread;
	const threadDetailCacheScopeKey = `${noteId ?? "no-note"}:${workspaceId ?? "no-workspace"}`;

	const commitPrefetchedThreadDetail = React.useCallback(
		(threadId: Id<"noteCommentThreads">, detail: ThreadDetail | null) => {
			const cacheKey = String(threadId);
			const cachedDetail = prefetchedThreadDetails.get(cacheKey);

			if (cachedDetail === detail) {
				return detail;
			}

			prefetchedThreadDetails.set(cacheKey, detail);
			React.startTransition(() => {
				forceThreadDetailCacheRender();
			});

			return detail;
		},
		[prefetchedThreadDetails],
	);

	const prefetchThreadDetail = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!workspaceId || !noteId) {
				return Promise.resolve<ThreadDetail | null>(null);
			}

			const cacheKey = String(threadId);
			const cachedDetail = prefetchedThreadDetails.get(cacheKey);
			if (cachedDetail !== undefined) {
				return Promise.resolve(cachedDetail);
			}

			const inFlightRequest = inFlightThreadDetailPrefetches.get(cacheKey);
			if (inFlightRequest) {
				return inFlightRequest;
			}

			const request = convex
				.query(api.noteComments.getThread, {
					workspaceId,
					noteId,
					threadId,
				})
				.then((detail) => commitPrefetchedThreadDetail(threadId, detail))
				.catch((error) => {
					logError({
						event: "client.error",
						error: error,
						message: "Failed to prefetch comment thread detail",
					});
					return commitPrefetchedThreadDetail(threadId, null);
				})
				.finally(() => {
					inFlightThreadDetailPrefetches.delete(cacheKey);
				});

			inFlightThreadDetailPrefetches.set(cacheKey, request);
			return request;
		},
		[
			commitPrefetchedThreadDetail,
			convex,
			inFlightThreadDetailPrefetches,
			noteId,
			prefetchedThreadDetails,
			workspaceId,
		],
	);

	React.useEffect(() => {
		const nextSyncKey = `${noteId ?? "no-note"}:${noteContent}`;
		if (lastAnchorSyncKeyRef.current === nextSyncKey) {
			return;
		}

		lastAnchorSyncKeyRef.current = nextSyncKey;
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setVisibleThreadOrder(collectVisibleThreadOrder(editor));
	}, [editor, noteContent, noteId]);

	React.useEffect(() => {
		if (
			lastThreadDetailCacheScopeKeyRef.current === threadDetailCacheScopeKey
		) {
			return;
		}

		lastThreadDetailCacheScopeKeyRef.current = threadDetailCacheScopeKey;
		prefetchedThreadDetails.clear();
		inFlightThreadDetailPrefetches.clear();
		React.startTransition(() => {
			forceThreadDetailCacheRender();
		});
	}, [
		inFlightThreadDetailPrefetches,
		prefetchedThreadDetails,
		threadDetailCacheScopeKey,
	]);

	React.useEffect(() => {
		if (!visibleThreads?.length) {
			return;
		}

		for (const thread of visibleThreads) {
			void prefetchThreadDetail(thread._id);
		}
	}, [prefetchThreadDetail, visibleThreads]);

	React.useEffect(() => {
		if (!expandedThreadId) {
			return;
		}

		void prefetchThreadDetail(expandedThreadId);
	}, [expandedThreadId, prefetchThreadDetail]);

	React.useEffect(() => {
		if (!expandedThreadId || expandedThread === undefined) {
			return;
		}

		commitPrefetchedThreadDetail(expandedThreadId, expandedThread);
	}, [commitPrefetchedThreadDetail, expandedThread, expandedThreadId]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const syncVisibleThreads = () => {
			setVisibleThreadOrder(collectVisibleThreadOrder(editor));
		};

		editor.on("update", syncVisibleThreads);
		return () => {
			editor.off("update", syncVisibleThreads);
		};
	}, [editor]);

	React.useEffect(() => {
		if (!pendingSelection) {
			setUiState({ draftBody: "" });
			return;
		}

		setUiState({ view: "all" });
	}, [pendingSelection]);

	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-event-handler
		if (!open && pendingSelection) {
			// react-doctor-disable-next-line react-doctor/no-event-handler
			onPendingSelectionChange(null);
		}
	}, [open, onPendingSelectionChange, pendingSelection]);

	React.useEffect(() => {
		if (expandedThreadId) {
			return;
		}

		setUiState({
			replyBody: "",
			editingThreadId: null,
			editingCommentId: null,
			editBody: "",
			commentActionsOpenId: null,
		});
	}, [expandedThreadId]);

	React.useEffect(() => {
		if (
			expandedThreadId &&
			visibleThreads &&
			!visibleThreads.some((thread) => thread._id === expandedThreadId)
		) {
			collapseExpandedThread();
		}
	}, [collapseExpandedThread, expandedThreadId, visibleThreads]);

	React.useEffect(() => {
		if (!threads || optimisticReadThreadIds.size === 0) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-chain-state-updates, react-doctor/no-derived-state
		setOptimisticReadThreadIds((current) => {
			let changed = false;
			const next = new Set(current);

			for (const thread of threads) {
				if (!thread.isRead && next.delete(String(thread._id))) {
					changed = true;
				}
			}

			return changed ? next : current;
		});
	}, [optimisticReadThreadIds.size, threads]);

	React.useEffect(() => {
		if (lastSyncedActiveThreadIdRef.current === activeThreadId) {
			return;
		}

		lastSyncedActiveThreadIdRef.current = activeThreadId;

		// react-doctor-disable-next-line react-doctor/no-event-handler
		if (!activeThreadId) {
			collapseExpandedThread();
			return;
		}

		setUiState({
			view: "all",
			expandedThreadId: activeThreadId,
			replyBody: "",
			editingThreadId: null,
			editingCommentId: null,
			editBody: "",
			threadActionsOpenId: null,
			commentActionsOpenId: null,
		});
	}, [activeThreadId, collapseExpandedThread]);

	React.useEffect(() => {
		if (
			!resolvedExpandedThread ||
			editingThreadId !== resolvedExpandedThread._id
		) {
			return;
		}

		syncEditingThreadStarterComment(resolvedExpandedThread);
	}, [
		editingThreadId,
		resolvedExpandedThread,
		syncEditingThreadStarterComment,
	]);

	React.useEffect(() => {
		if (!editingCommentId) {
			return;
		}

		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			setUiState({
				editingThreadId: null,
				editingCommentId: null,
				editBody: "",
				commentActionsOpenId: null,
			});
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
		};
	}, [editingCommentId]);

	const handleCreateThread = React.useCallback(() => {
		if (
			!workspaceId ||
			!noteId ||
			!pendingSelection ||
			!editor ||
			draftBody.trim().length === 0
		) {
			return;
		}

		startCreating(() => {
			void createThread({
				workspaceId,
				noteId,
				excerpt: pendingSelection.text,
				body: draftBody,
			})
				.then((threadId) => {
					editor
						.chain()
						.focus()
						.setTextSelection({
							from: pendingSelection.from,
							to: pendingSelection.to,
						})
						.setNoteComment({ threadId: String(threadId) })
						.run();
					setUiState({
						draftBody: "",
						expandedThreadId: null,
					});
					onPendingSelectionChange(null);
					onActiveThreadIdChange(threadId);
					toast.success("Comment added");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to add comment"));
				});
		});
	}, [
		createThread,
		draftBody,
		editor,
		noteId,
		onActiveThreadIdChange,
		onPendingSelectionChange,
		pendingSelection,
		workspaceId,
	]);

	const handleReply = React.useCallback(() => {
		if (
			!workspaceId ||
			!noteId ||
			!expandedThreadId ||
			replyBody.trim().length === 0
		) {
			return;
		}

		startReplying(() => {
			void addComment({
				workspaceId,
				noteId,
				threadId: expandedThreadId,
				body: replyBody,
			})
				.then(() => {
					setUiState({ replyBody: "" });
					toast.success("Reply sent");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to send reply"));
				});
		});
	}, [addComment, expandedThreadId, noteId, replyBody, workspaceId]);

	const handleMarkThreadRead = React.useCallback(
		(thread: ThreadSummary) => {
			if (!workspaceId || !noteId) {
				return;
			}

			const optimisticThreadId = String(thread._id);
			if (thread.isRead || optimisticReadThreadIds.has(optimisticThreadId)) {
				return;
			}

			setOptimisticReadThreadIds((current) => {
				const next = new Set(current);
				next.add(optimisticThreadId);
				return next;
			});

			void markRead({
				workspaceId,
				noteId,
				threadId: thread._id,
			}).catch((error) => {
				setOptimisticReadThreadIds((current) => {
					const next = new Set(current);
					next.delete(optimisticThreadId);
					return next;
				});
				toast.error(
					getErrorMessage(error, "Failed to mark discussion as read"),
				);
			});
		},
		[markRead, noteId, optimisticReadThreadIds, workspaceId],
	);

	const removeThreadMarks = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!editor) {
				return;
			}

			const noteCommentMark = editor.state.schema.marks.noteComment;
			if (!noteCommentMark) {
				return;
			}

			const transaction = editor.state.tr;

			editor.state.doc.descendants((node, position) => {
				if (!node.isText || !node.marks.length) {
					return;
				}

				const hasMatchingCommentMark = node.marks.some(
					(mark) =>
						mark.type === noteCommentMark &&
						mark.attrs.threadId === String(threadId),
				);

				if (!hasMatchingCommentMark) {
					return;
				}

				transaction.removeMark(
					position,
					position + node.nodeSize,
					noteCommentMark,
				);
			});

			if (transaction.docChanged) {
				editor.view.dispatch(transaction);
			}
		},
		[editor],
	);

	const handleOpenThread = React.useCallback(
		(thread: ThreadSummary) => {
			onPendingSelectionChange(null);
			if (expandedThreadId === thread._id) {
				setUiState({
					expandedThreadId: null,
					replyBody: "",
				});
				handleMarkThreadRead(thread);
				onActiveThreadIdChange(null);
				return;
			}

			setUiState({
				expandedThreadId: thread._id,
				replyBody: "",
			});
			handleMarkThreadRead(thread);
			onActiveThreadIdChange(thread._id);
		},
		[
			expandedThreadId,
			handleMarkThreadRead,
			onActiveThreadIdChange,
			onPendingSelectionChange,
		],
	);

	const handleMarkThreadUnread = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });
			setOptimisticReadThreadIds((current) => {
				const next = new Set(current);
				next.delete(String(threadId));
				return next;
			});

			void markUnread({
				workspaceId,
				noteId,
				threadId,
			})
				.then(() => {
					toast.success("Marked as unread");
				})
				.catch((error) => {
					toast.error(
						getErrorMessage(error, "Failed to mark discussion as unread"),
					);
				});
		},
		[markUnread, noteId, workspaceId],
	);

	const handleStartEditComment = React.useCallback((comment: ThreadComment) => {
		setUiState({
			commentActionsOpenId: null,
			editingCommentId: comment._id,
			editBody: comment.body,
		});
	}, []);
	const handleCancelEdit = React.useCallback(() => {
		setUiState({
			editingThreadId: null,
			editingCommentId: null,
			editBody: "",
			commentActionsOpenId: null,
		});
	}, []);

	const handleSaveEdit = React.useCallback(() => {
		if (
			!workspaceId ||
			!noteId ||
			!expandedThreadId ||
			!editingCommentId ||
			editBody.trim().length === 0
		) {
			return;
		}

		startReplying(() => {
			void updateComment({
				workspaceId,
				noteId,
				threadId: expandedThreadId,
				commentId: editingCommentId,
				body: editBody,
			})
				.then(() => {
					setUiState({
						editingCommentId: null,
						editBody: "",
						commentActionsOpenId: null,
					});
					toast.success("Comment updated");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to update comment"));
				});
		});
	}, [
		editBody,
		editingCommentId,
		expandedThreadId,
		noteId,
		updateComment,
		workspaceId,
	]);

	const handleDeleteComment = React.useCallback(
		(comment: ThreadComment) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ commentActionsOpenId: null });

			void deleteComment({
				workspaceId,
				noteId,
				threadId: comment.threadId,
				commentId: comment._id,
			})
				.then(() => {
					if (
						resolvedExpandedThread &&
						resolvedExpandedThread._id === comment.threadId &&
						resolvedExpandedThread.comments.length === 1
					) {
						setUiState({ expandedThreadId: null });
						onActiveThreadIdChange(null);
					}

					if (editingCommentId === comment._id) {
						setUiState({
							editingCommentId: null,
							editBody: "",
						});
					}

					toast.success("Comment deleted");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to delete comment"));
				});
		},
		[
			deleteComment,
			editingCommentId,
			noteId,
			onActiveThreadIdChange,
			resolvedExpandedThread,
			workspaceId,
		],
	);

	const handleCopyThreadLink = React.useCallback(
		async (threadId: Id<"noteCommentThreads">) => {
			if (!noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });

			try {
				const url = new URL(window.location.href);
				url.pathname = "/note";
				url.searchParams.set("noteId", String(noteId));
				url.searchParams.set("commentThreadId", String(threadId));
				await writeTextToClipboard(url.toString());
				toast.success("Link copied");
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to copy link"));
			}
		},
		[noteId],
	);

	const handleToggleMuteThread = React.useCallback(
		(thread: ThreadSummary) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });

			void toggleMuteReplies({
				workspaceId,
				noteId,
				threadId: thread._id,
			})
				.then((muted) => {
					toast.success(muted ? "Replies muted" : "Replies unmuted");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to update mute setting"));
				});
		},
		[noteId, toggleMuteReplies, workspaceId],
	);

	const handleDeleteThread = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });

			void deleteThread({
				workspaceId,
				noteId,
				threadId,
			})
				.then(() => {
					removeThreadMarks(threadId);
					setUiState({
						commentActionsOpenId: null,
						replyBody: "",
					});

					if (activeThreadId === threadId) {
						onActiveThreadIdChange(null);
					}

					if (expandedThreadId === threadId) {
						setUiState({
							expandedThreadId: null,
						});
					}

					toast.success("Comment deleted");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to delete comment"));
				});
		},
		[
			activeThreadId,
			deleteThread,
			expandedThreadId,
			noteId,
			onActiveThreadIdChange,
			removeThreadMarks,
			workspaceId,
		],
	);

	const panel = (
		<CommentsSheetPanel
			isMobile={isMobile}
			open={open}
			desktopSafeTop={desktopSafeTop}
			isPinned={isPinned}
			filtersOpen={filtersOpen}
			setFiltersOpen={(nextOpen) => setUiState({ filtersOpen: nextOpen })}
			view={view}
			setView={(nextView) => setUiState({ view: nextView })}
			onTogglePinned={onTogglePinned}
			onOpenChange={onOpenChange}
			pendingSelection={pendingSelection}
			draftBody={draftBody}
			setDraftBody={setDraftBody}
			handleCreateThread={handleCreateThread}
			isCreating={isCreating}
			visibleThreads={visibleThreads}
			activeThreadId={activeThreadId}
			expandedThreadId={expandedThreadId}
			editingCommentId={editingCommentId}
			expandedThread={resolvedExpandedThread}
			optimisticReadThreadIds={optimisticReadThreadIds}
			currentUser={currentUser}
			threadActionsOpenId={threadActionsOpenId}
			setThreadActionsOpenId={(threadId) =>
				setUiState({
					threadActionsOpenId: threadId,
					commentActionsOpenId: null,
				})
			}
			handleMarkThreadRead={handleMarkThreadRead}
			handleMarkThreadUnread={handleMarkThreadUnread}
			handleCopyThreadLink={handleCopyThreadLink}
			handleToggleMuteThread={handleToggleMuteThread}
			handleDeleteThread={handleDeleteThread}
			handleOpenThread={handleOpenThread}
			handlePrefetchThread={prefetchThreadDetail}
			commentActionsOpenId={commentActionsOpenId}
			setCommentActionsOpenId={(commentId) =>
				setUiState({
					commentActionsOpenId: commentId,
					threadActionsOpenId: null,
				})
			}
			editBody={editBody}
			replyBody={replyBody}
			isReplySubmitting={isReplySubmitting}
			setEditBody={setEditBody}
			setReplyBody={setReplyBody}
			handleSaveEdit={handleSaveEdit}
			handleCancelEdit={handleCancelEdit}
			handleReply={handleReply}
			handleStartEditComment={handleStartEditComment}
			handleDeleteComment={handleDeleteComment}
		/>
	);

	return {
		handleResizeKeyDown,
		handleResizeStart,
		isMobile,
		isResizing,
		panel,
		panelWidth,
	};
}

export function NoteCommentsSheet(props: NoteCommentsSheetProps) {
	const { open, onOpenChange, onPinnedChange } = props;
	const pinnedStorageKey = React.useMemo(
		() => getDesktopCommentsPanelPinnedStorageKey(props.noteId),
		[props.noteId],
	);
	const { state } = useSidebarShell();
	const {
		hasRightSidebar,
		rightMode,
		rightOpen,
		rightSidebarWidth,
		rightSidebarWidthOverride,
	} = useSidebarRight();
	const { isPinned, togglePinned } = useDesktopPanelPin({
		storageKey: pinnedStorageKey,
		onPinnedChange,
	});
	const rightSidebarOffset =
		hasRightSidebar && rightOpen && rightMode === "sidebar"
			? (rightSidebarWidthOverride ?? rightSidebarWidth)
			: undefined;
	const rightSidebarReservedWidth = React.useMemo(
		() => parseCssLengthToPixels(rightSidebarOffset),
		[rightSidebarOffset],
	);
	const leftSidebarReservedWidth =
		state === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const {
		handleResizeKeyDown,
		handleResizeStart,
		isMobile,
		isResizing,
		panel,
		panelWidth,
	} = useNoteCommentsSheetController({
		...props,
		isPinned,
		leftSidebarReservedWidth,
		onTogglePinned: togglePinned,
		rightSidebarReservedWidth,
	});

	useDockedPanelInset({
		side: "right",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});

	const effectiveRightSidebarOffset =
		!isMobile && rightSidebarOffset ? rightSidebarOffset : undefined;

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					showCloseButton={false}
					className="group/docked-sheet gap-0 border-l bg-background p-0 shadow-none data-[side=right]:sm:max-w-none"
					style={{
						width: panelWidth,
						maxWidth: "100vw",
					}}
				>
					<SheetTitle className="sr-only">Comments</SheetTitle>
					<SheetDescription className="sr-only">
						Review and reply to note comment threads.
					</SheetDescription>
					<ResizableSidePanelHandle
						side="right"
						label="Resize comments panel"
						panelWidth={panelWidth}
						isResizing={isResizing}
						className="opacity-0 transition-opacity duration-150 group-hover/docked-sheet:opacity-100 group-focus-within/docked-sheet:opacity-100"
						onPointerDown={handleResizeStart}
						onKeyDown={handleResizeKeyDown}
					/>
					{panel}
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<DesktopDockedSidePanel
			side="right"
			open={open}
			isPinned={isPinned}
			panelWidth={panelWidth}
			panelOffset={effectiveRightSidebarOffset}
			dismissLeadingOffset={`${leftSidebarReservedWidth}px`}
			desktopSafeTop={props.desktopSafeTop}
			onOpenChange={onOpenChange}
			panelName="comments"
			resizeLabel="Resize comments panel"
			isResizing={isResizing}
			onResizeStart={handleResizeStart}
			onResizeKeyDown={handleResizeKeyDown}
		>
			{panel}
		</DesktopDockedSidePanel>
	);
}
