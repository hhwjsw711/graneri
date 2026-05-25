"use client";

import { openDesktopExternalUrl } from "@workspace/platform/desktop";
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
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Icons } from "@workspace/ui/components/icons";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import {
	SIDEBAR_WIDTH,
	SIDEBAR_WIDTH_ICON,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
	Archive,
	Check,
	CheckCheck,
	Inbox,
	MoreHorizontal,
	SlidersHorizontal,
	Square,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	INBOX_PANEL_PINNED_STORAGE_KEY,
	INBOX_PANEL_STORAGE_KEY_DESKTOP,
	INBOX_PANEL_STORAGE_KEY_MOBILE,
} from "@/components/inbox/inbox-panel-state";
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
	useDockedPanelOverlayWidth,
} from "@/components/layout/docked-side-panel";
import {
	ResizableSidePanelHandle,
	useResizableSidePanel,
} from "@/components/layout/resizable-side-panel";
import { useDesktopPanelPin } from "@/components/layout/use-desktop-panel-pin";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { getAvatarSrc } from "@/lib/avatar";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const JiraLogo = Icons.jiraLogo;

type InboxView = "all" | "unread" | "archived";

const INBOX_VIEW_OPTIONS: Array<{
	value: InboxView;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}> = [
	{ value: "all", label: "Unread & read", icon: Inbox },
	{ value: "unread", label: "Unread", icon: Square },
	{ value: "archived", label: "Archived", icon: Archive },
];

const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error && error.message.trim().length > 0
		? error.message.replace(/\.$/, "")
		: fallback;

export type InboxSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sidebarState: "expanded" | "collapsed";
	isMobile: boolean;
	currentUser: {
		name: string;
		email: string;
		avatar: string;
	};
	desktopSafeTop?: boolean;
	onMarkItemsRead?: (itemIds: string[]) => void;
	onMarkAllRead?: () => void;
};

export function InboxSheet({
	open,
	onOpenChange,
	sidebarState,
	isMobile,
	currentUser,
	desktopSafeTop = false,
	onMarkItemsRead,
	onMarkAllRead,
}: InboxSheetProps) {
	const sidebarOffset =
		sidebarState === "collapsed" ? SIDEBAR_WIDTH_ICON : SIDEBAR_WIDTH;
	const sidebarOffsetPx =
		sidebarState === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "left",
			desktopStorageKey: INBOX_PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: INBOX_PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
			desktopLeadingOffset: sidebarOffsetPx,
		});
	const { isPinned, togglePinned } = useDesktopPanelPin({
		storageKey: INBOX_PANEL_PINNED_STORAGE_KEY,
	});
	const [view, setView] = React.useState<InboxView>("all");
	const [markAllReadRequestId, setMarkAllReadRequestId] = React.useState(0);
	const [archiveReadRequestId, setArchiveReadRequestId] = React.useState(0);
	const [clearArchivedRequestId, setClearArchivedRequestId] = React.useState(0);

	useDockedPanelInset({
		side: "left",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});
	useDockedPanelOverlayWidth({
		side: "left",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});

	if (!isMobile) {
		return (
			<DesktopDockedSidePanel
				side="left"
				open={open}
				isPinned={isPinned}
				panelWidth={panelWidth}
				panelOffset={sidebarOffset}
				desktopSafeTop={desktopSafeTop}
				onOpenChange={onOpenChange}
				panelName="inbox"
				resizeLabel="Resize inbox panel"
				isResizing={isResizing}
				onResizeStart={handleResizeStart}
				onResizeKeyDown={handleResizeKeyDown}
			>
				<div className="px-2">
					<InboxPaneHeader
						isMobile={false}
						open={open}
						desktopSafeTop={desktopSafeTop}
						view={view}
						onViewChange={setView}
						onMarkAllRead={() => {
							setMarkAllReadRequestId((current) => current + 1);
							onMarkAllRead?.();
						}}
						onArchiveRead={() => {
							setArchiveReadRequestId((current) => current + 1);
						}}
						onClearArchived={() => {
							setClearArchivedRequestId((current) => current + 1);
						}}
						isPinned={isPinned}
						onTogglePinned={togglePinned}
					/>
				</div>
				<div className="min-h-0 flex-1">
					<InboxPanel
						view={view}
						currentUser={currentUser}
						markAllReadRequestId={markAllReadRequestId}
						archiveReadRequestId={archiveReadRequestId}
						clearArchivedRequestId={clearArchivedRequestId}
						onMarkItemsRead={onMarkItemsRead}
					/>
				</div>
			</DesktopDockedSidePanel>
		);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="left"
				showCloseButton={false}
				className={cn(
					"group/docked-sheet gap-0 border-r bg-background p-0 shadow-none",
					"data-[side=left]:left-0 data-[side=left]:sm:max-w-none",
				)}
				style={{
					width: panelWidth,
					maxWidth: "100vw",
				}}
			>
				<ResizableSidePanelHandle
					side="left"
					label="Resize inbox panel"
					panelWidth={panelWidth}
					isResizing={isResizing}
					className="opacity-0 transition-opacity duration-150 group-hover/docked-sheet:opacity-100 group-focus-within/docked-sheet:opacity-100"
					onPointerDown={handleResizeStart}
					onKeyDown={handleResizeKeyDown}
				/>
				<InboxPaneHeader
					isMobile
					open={open}
					view={view}
					onViewChange={setView}
					onMarkAllRead={() => {
						setMarkAllReadRequestId((current) => current + 1);
						onMarkAllRead?.();
					}}
					onArchiveRead={() => {
						setArchiveReadRequestId((current) => current + 1);
					}}
					onClearArchived={() => {
						setClearArchivedRequestId((current) => current + 1);
					}}
					isPinned={false}
					onTogglePinned={() => {}}
				/>
				<InboxPanel
					view={view}
					currentUser={currentUser}
					markAllReadRequestId={markAllReadRequestId}
					archiveReadRequestId={archiveReadRequestId}
					clearArchivedRequestId={clearArchivedRequestId}
					onMarkItemsRead={onMarkItemsRead}
				/>
			</SheetContent>
		</Sheet>
	);
}

function getAvatarLabel(name?: string | null) {
	return (
		(name ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("") || "?"
	);
}

function getInboxAvatarProps({
	item,
	currentUser,
}: {
	item: {
		provider: "jira" | "notes";
		actorAvatarUrl?: string | null;
		actorDisplayName?: string | null;
	};
	currentUser: {
		name: string;
		email: string;
		avatar: string;
	};
}) {
	if (item.provider === "jira") {
		return null;
	}

	const resolvedName = item.actorDisplayName?.trim() || "Someone";
	const avatarSrc =
		item.actorAvatarUrl?.trim() ||
		(resolvedName === "You" ? getAvatarSrc(currentUser) : undefined);

	return {
		name: resolvedName,
		avatarSrc,
	};
}

function InboxPaneHeader({
	isMobile = false,
	open = true,
	desktopSafeTop = false,
	view,
	onViewChange,
	onMarkAllRead,
	onArchiveRead,
	onClearArchived,
	isPinned,
	onTogglePinned,
}: {
	isMobile?: boolean;
	open?: boolean;
	desktopSafeTop?: boolean;
	view: InboxView;
	onViewChange: (view: InboxView) => void;
	onMarkAllRead: () => void;
	onArchiveRead: () => void;
	onClearArchived: () => void;
	isPinned: boolean;
	onTogglePinned: () => void;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const markAllRead = useMutation(api.inboxItems.markAllRead);
	const archiveRead = useMutation(api.inboxItems.archiveRead);
	const clearArchived = useMutation(api.inboxItems.clearArchived);
	const [actionsOpen, setActionsOpen] = React.useState(false);
	const [filtersOpen, setFiltersOpen] = React.useState(false);
	const handleMarkAllRead = React.useCallback(() => {
		if (!activeWorkspaceId) {
			return;
		}

		setActionsOpen(false);
		void markAllRead({ workspaceId: activeWorkspaceId })
			.then(() => {
				onMarkAllRead();
			})
			.catch((error) => {
				toast.error(
					getErrorMessage(error, "Failed to mark all inbox items as read"),
				);
			});
	}, [activeWorkspaceId, markAllRead, onMarkAllRead]);
	const handleArchiveRead = React.useCallback(() => {
		if (!activeWorkspaceId) {
			return;
		}

		setActionsOpen(false);
		void archiveRead({ workspaceId: activeWorkspaceId })
			.then(() => {
				onArchiveRead();
			})
			.catch((error) => {
				toast.error(
					getErrorMessage(error, "Failed to archive read inbox items"),
				);
			});
	}, [activeWorkspaceId, archiveRead, onArchiveRead]);
	const handleClearArchived = React.useCallback(() => {
		if (!activeWorkspaceId) {
			return;
		}

		setActionsOpen(false);
		void clearArchived({ workspaceId: activeWorkspaceId })
			.then(() => {
				onClearArchived();
			})
			.catch((error) => {
				toast.error(
					getErrorMessage(error, "Failed to clear archived inbox items"),
				);
			});
	}, [activeWorkspaceId, clearArchived, onClearArchived]);

	return (
		<div
			data-app-region={!isMobile && open ? "no-drag" : undefined}
			className={cn(
				"flex w-full items-center justify-between",
				!isMobile && (desktopSafeTop ? "h-10 px-2" : "h-16 px-2"),
				isMobile && "border-b px-4 py-3",
			)}
		>
			{isMobile ? (
				<SheetTitle
					className={cn(
						"text-sm font-medium",
						desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						desktopSafeTop && "mt-1",
					)}
				>
					Inbox
				</SheetTitle>
			) : (
				<Breadcrumb
					className={
						desktopSafeTop ? DESKTOP_MAIN_HEADER_CONTENT_CLASS : undefined
					}
				>
					<BreadcrumbList className="gap-0">
						<BreadcrumbItem>
							<BreadcrumbPage>Inbox</BreadcrumbPage>
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
				<DropdownMenu
					open={actionsOpen}
					onOpenChange={(open) => {
						setActionsOpen(open);
						if (open) {
							setFiltersOpen(false);
						}
					}}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Inbox actions"
									data-app-region={!isMobile && open ? "no-drag" : undefined}
								>
									<MoreHorizontal className="size-4" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent
							sideOffset={8}
							className="pointer-events-none select-none"
						>
							Inbox actions
						</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="min-w-44">
						<DropdownMenuItem
							disabled={!activeWorkspaceId}
							onSelect={handleMarkAllRead}
						>
							<CheckCheck className="size-4" />
							<span>Mark all as read</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!activeWorkspaceId}
							onSelect={handleArchiveRead}
						>
							<Archive className="size-4" />
							<span>Archive read</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							disabled={!activeWorkspaceId}
							onSelect={handleClearArchived}
						>
							<Trash2 className="size-4" />
							<span>Clear archived</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{!isMobile ? (
					<DockedPanelPinButton
						isPinned={isPinned}
						label="inbox"
						onTogglePinned={onTogglePinned}
					/>
				) : null}
				<DropdownMenu
					open={filtersOpen}
					onOpenChange={(open) => {
						setFiltersOpen(open);
						if (open) {
							setActionsOpen(false);
						}
					}}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Filter inbox"
									data-app-region={!isMobile && open ? "no-drag" : undefined}
								>
									<SlidersHorizontal className="size-4" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent
							sideOffset={8}
							className="pointer-events-none select-none"
						>
							Filter inbox
						</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="min-w-44">
						{INBOX_VIEW_OPTIONS.map((option) => {
							const Icon = option.icon;

							return (
								<DropdownMenuItem
									key={option.value}
									onSelect={() => onViewChange(option.value)}
								>
									<Icon className="size-4" />
									<span>{option.label}</span>
									{view === option.value ? (
										<Check className="ml-auto size-4 text-foreground" />
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

const InboxPanel = React.memo(function InboxPanel({
	view,
	currentUser,
	markAllReadRequestId,
	archiveReadRequestId,
	clearArchivedRequestId,
	onMarkItemsRead,
}: {
	view: InboxView;
	currentUser: {
		name: string;
		email: string;
		avatar: string;
	};
	markAllReadRequestId: number;
	archiveReadRequestId: number;
	clearArchivedRequestId: number;
	onMarkItemsRead?: (itemIds: string[]) => void;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const items = useQuery(
		api.inboxItems.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, view } : "skip",
	);
	const markRead = useMutation(api.inboxItems.markRead);
	const [optimisticReadItemIds, setOptimisticReadItemIds] = React.useState(
		() => new Set<string>(),
	);
	const [optimisticRemovedItemIds, setOptimisticRemovedItemIds] =
		React.useState(() => new Set<string>());

	React.useEffect(() => {
		if (markAllReadRequestId === 0 || !items) {
			return;
		}

		setOptimisticReadItemIds((current) => {
			const next = new Set(current);
			for (const item of items) {
				next.add(String(item._id));
			}
			return next;
		});
	}, [items, markAllReadRequestId]);

	React.useEffect(() => {
		const nextScope = `${activeWorkspaceId ?? "no-workspace"}:${view}`;

		if (!nextScope) {
			return;
		}

		setOptimisticReadItemIds(new Set());
		setOptimisticRemovedItemIds(new Set());
	}, [activeWorkspaceId, view]);

	React.useEffect(() => {
		if (archiveReadRequestId === 0 || !items || view === "archived") {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		setOptimisticRemovedItemIds((current) => {
			const next = new Set(current);
			for (const item of items) {
				const itemId = String(item._id);
				// react-doctor-disable-next-line react-doctor/no-event-handler
				const isRead = item.isRead || optimisticReadItemIds.has(itemId);
				if (isRead) {
					next.add(itemId);
				}
			}
			return next;
		});
	}, [archiveReadRequestId, items, optimisticReadItemIds, view]);

	React.useEffect(() => {
		if (clearArchivedRequestId === 0 || !items || view !== "archived") {
			return;
		}

		setOptimisticRemovedItemIds((current) => {
			const next = new Set(current);
			for (const item of items) {
				next.add(String(item._id));
			}
			return next;
		});
	}, [clearArchivedRequestId, items, view]);

	const handleMarkItemRead = async (item: {
		_id: Id<"inboxItems">;
		isRead: boolean;
	}) => {
		const optimisticItemId = String(item._id);

		if (item.isRead || optimisticReadItemIds.has(optimisticItemId)) {
			return;
		}

		setOptimisticReadItemIds((current) => {
			const next = new Set(current);
			next.add(optimisticItemId);
			return next;
		});
		onMarkItemsRead?.([optimisticItemId]);

		try {
			await markRead({ itemId: item._id });
		} catch (error) {
			setOptimisticReadItemIds((current) => {
				const next = new Set(current);
				next.delete(optimisticItemId);
				return next;
			});
			throw error;
		}
	};

	const handleOpenItem = async (item: {
		_id: Id<"inboxItems">;
		provider: "jira" | "notes";
		kind: "jira-mention" | "note-comment";
		url: string;
		isRead: boolean;
	}) => {
		// react-doctor-disable-next-line react-doctor/async-defer-await
		await handleMarkItemRead(item);

		if (item.provider === "notes" && item.kind === "note-comment") {
			window.history.pushState(null, "", item.url);
			window.dispatchEvent(new PopStateEvent("popstate"));
			return;
		}

		if (await openDesktopExternalUrl(item.url)) {
			return;
		}

		window.open(item.url, "_blank", "noopener,noreferrer");
	};

	if (!activeWorkspaceId) {
		return (
			<ScrollArea className="min-h-0 flex-1">
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox className="size-4" />
						</EmptyMedia>
						<EmptyTitle>Select a workspace</EmptyTitle>
						<EmptyDescription>
							Inbox items are scoped to the active workspace.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</ScrollArea>
		);
	}

	if (!items) {
		return null;
	}

	if (items.length === 0) {
		return (
			<ScrollArea className="min-h-0 flex-1">
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No inbox items</EmptyTitle>
						<EmptyDescription>
							{getInboxEmptyDescription(view)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</ScrollArea>
		);
	}

	const visibleItems = items.filter(
		(item) => !optimisticRemovedItemIds.has(String(item._id)),
	);

	if (visibleItems.length === 0) {
		return (
			<ScrollArea className="min-h-0 flex-1">
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No inbox items</EmptyTitle>
						<EmptyDescription>
							{getInboxEmptyDescription(view)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</ScrollArea>
		);
	}

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div>
				{visibleItems.map((item) => {
					const isRead =
						item.isRead || optimisticReadItemIds.has(String(item._id));
					const avatarProps = getInboxAvatarProps({ item, currentUser });
					const itemTitle = formatInboxTitle(
						item.kind,
						item.title,
						item.actorDisplayName,
					);

					return (
						<div
							key={item._id}
							className="group relative border-b transition-colors hover:bg-accent/20"
						>
							<button
								type="button"
								aria-label={`Mark ${itemTitle} as read`}
								className="absolute inset-0 z-0 cursor-pointer rounded-none focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => {
									void handleMarkItemRead(item).catch((error) => {
										toast.error(
											getErrorMessage(
												error,
												"Failed to mark inbox item as read",
											),
										);
									});
								}}
							/>
							<div className="relative z-10">
								<div
									className={cn(
										"pointer-events-none grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 p-3",
										isRead && "opacity-50",
									)}
								>
									<div className="flex pt-0.5">
										{item.provider === "jira" ? (
											<JiraLogo className="size-4" />
										) : (
											<Avatar className="size-4">
												<AvatarImage
													src={avatarProps?.avatarSrc}
													alt={avatarProps?.name ?? "Comment author"}
												/>
												<AvatarFallback className="text-[9px] font-medium">
													{getAvatarLabel(avatarProps?.name)}
												</AvatarFallback>
											</Avatar>
										)}
									</div>
									<div className="min-w-0">
										<div className="flex items-start justify-between gap-3">
											<p className="truncate text-sm font-medium text-foreground">
												{itemTitle}
											</p>
											<p className="shrink-0 pt-0.5 text-xs text-muted-foreground">
												{formatInboxTimestamp(item.occurredAt)}
											</p>
										</div>
									</div>
									<div className="col-start-2 min-w-0">
										<p className="truncate text-xs leading-4 text-muted-foreground">
											{item.issueKey}
										</p>
									</div>
									<div className="col-start-2 min-w-0">
										<p className="line-clamp-3 text-sm text-muted-foreground">
											{formatInboxPreview(item.preview)}
										</p>
									</div>
								</div>
								<div className="px-3 pb-3 pl-9">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className={cn(
											"relative z-10 cursor-pointer text-xs",
											isRead && "opacity-50",
										)}
										onClick={() => {
											void handleOpenItem(item).catch((error) => {
												toast.error(
													getErrorMessage(error, "Failed to open inbox item"),
												);
											});
										}}
									>
										Reply
									</Button>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</ScrollArea>
	);
});

function getInboxEmptyDescription(view: InboxView) {
	switch (view) {
		case "unread":
			return "Unread inbox items will appear here.";
		case "archived":
			return "Archived inbox items will appear here.";
		default:
			return "Inbox items will appear here as updates come in.";
	}
}

function formatInboxTimestamp(value: number) {
	const date = new Date(value);
	const now = new Date();
	const sameDay = date.toDateString() === now.toDateString();

	return sameDay
		? date.toLocaleTimeString([], {
				hour: "numeric",
				minute: "2-digit",
			})
		: date.toLocaleDateString([], {
				month: "short",
				day: "numeric",
			});
}

function formatInboxPreview(value: string) {
	return value
		.replace(/\[~accountid:[^\]]+\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

function formatInboxTitle(
	kind: "jira-mention" | "note-comment",
	title: string,
	actorDisplayName?: string | null,
) {
	if (kind === "note-comment" && actorDisplayName?.trim()) {
		return `${actorDisplayName.trim()} ${title}`;
	}

	if (kind === "note-comment") {
		return `Someone ${title}`;
	}

	if (kind === "jira-mention" && actorDisplayName?.trim()) {
		return `${actorDisplayName.trim()} mentioned you`;
	}

	if (kind === "jira-mention" && title.startsWith("Mentioned in ")) {
		return "Someone mentioned you";
	}

	return title;
}
