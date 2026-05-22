"use client";

import { Tiptap, useEditor } from "@tiptap/react";
import { Button } from "@workspace/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@workspace/ui/components/command";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { Kbd } from "@workspace/ui/components/kbd";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import { useOptionalSidebarShell } from "@workspace/ui/components/sidebar";
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
import type { UIMessage } from "ai";
import {
	ChevronRight,
	Clock3,
	ExternalLink,
	FileText,
	Globe,
	Paperclip,
	Plus,
	X,
} from "lucide-react";
import * as React from "react";
import { AppSourceIcon } from "@/components/app-source-icon";
import type { AutomationListItem } from "@/components/automations/automation-types";
import { getAutomationSchedulePeriodLabel } from "@/components/automations/automation-utils";
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
import {
	ResizableSidePanelHandle,
	useResizableSidePanel,
} from "@/components/layout/resizable-side-panel";
import {
	SearchCommand,
	type SearchCommandItem,
} from "@/components/search/search-command";
import {
	extractFileParts,
	extractGeneratedArtifacts,
	getChatMessageMetadata,
} from "@/lib/chat-message";
import {
	CHAT_APP_SOURCE_PROVIDERS,
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import { collectMessageSources, type ToolSource } from "@/lib/chat-sources";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import {
	createNoteEditorExtensions,
	parseStoredNoteContent,
} from "@/lib/note-editor";

export const OPEN_CHAT_SUMMARY_EVENT = "opengran:open-chat-summary";

const CHAT_SUMMARY_PANEL_STORAGE_KEY_DESKTOP =
	"opengran.chat-summary-panel-width.desktop";
const CHAT_SUMMARY_PANEL_STORAGE_KEY_MOBILE =
	"opengran.chat-summary-panel-width.mobile";
const CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY =
	"opengran.chat-summary-panel-pinned.desktop";

type SummaryWorkspaceSource = {
	id: string;
	title: string;
	preview?: string;
	content?: string;
	updatedAt?: number;
};

export type ChatSummaryOpenSourceRequest = {
	sourceId: string;
	requestId: number;
};

type SummaryArtifact = {
	filename?: string;
	mediaType: string;
	url: string;
};

type SummarySource =
	| ({ kind: "link" } & ToolSource)
	| ({
			kind: "file";
	  } & SummaryArtifact)
	| {
			id: string;
			kind: "tool";
			title: string;
	  };

type SummaryTab =
	| { id: "summary"; kind: "summary"; title: "Summary" }
	| {
			id: string;
			kind: "file";
			sourceId: string;
			title: string;
			preview?: string;
			content?: string;
	  }
	| { id: "automation"; kind: "automation"; title: "Automation" };

const SUMMARY_TAB: SummaryTab = {
	id: "summary",
	kind: "summary",
	title: "Summary",
};

const AUTOMATION_TAB: SummaryTab = {
	id: "automation",
	kind: "automation",
	title: "Automation",
};

const readDesktopChatSummaryPanelPinnedState = () => {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		return (
			window.localStorage.getItem(CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY) ===
			"true"
		);
	} catch {
		return false;
	}
};

const writeDesktopChatSummaryPanelPinnedState = (isPinned: boolean) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY,
			String(isPinned),
		);
	} catch {
		// Keep the in-memory state if localStorage is unavailable.
	}
};

const collectChatSources = (messages: UIMessage[]): SummarySource[] => {
	const sources = messages.flatMap<SummarySource>((message) => {
		if (message.role === "assistant") {
			return collectMessageSources(message).map((source) => ({
				...source,
				kind: "link",
			}));
		}

		const fileSources = extractFileParts(message).map(
			(file) =>
				({
					filename: file.filename,
					kind: "file",
					mediaType: file.mediaType,
					url: file.url,
				}) satisfies SummarySource,
		);
		const mentionSources = (
			getChatMessageMetadata(message)?.mentionPositions ?? []
		).flatMap((mention) =>
			mention.type === "tool" || mention.id.startsWith("app:")
				? [
						{
							id: mention.id,
							kind: "tool",
							title: mention.label,
						} satisfies SummarySource,
					]
				: [],
		);

		return [...fileSources, ...mentionSources];
	});
	const seen = new Set<string>();

	return sources.filter((source) => {
		const key = getSummarySourceKey(source);

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
};

const collectChatArtifacts = (messages: UIMessage[]): SummaryArtifact[] => {
	const artifacts = messages.flatMap((message) => {
		if (message.role !== "assistant") {
			return [];
		}

		return [
			...extractFileParts(message),
			...extractGeneratedArtifacts(message),
		];
	});
	const seen = new Set<string>();

	return artifacts.filter((artifact) => {
		if (seen.has(artifact.url)) {
			return false;
		}

		seen.add(artifact.url);
		return true;
	});
};

export function ChatSummarySheet({
	open,
	messages,
	automation,
	chatTitle,
	desktopSafeTop = false,
	workspaceSources,
	openSourceRequest,
	onAddSource,
	onRemoveAutoAddedSource,
	onOpenChange,
}: {
	open: boolean;
	messages: UIMessage[];
	automation?: AutomationListItem | null;
	chatTitle: string;
	desktopSafeTop?: boolean;
	workspaceSources: SummaryWorkspaceSource[];
	openSourceRequest?: ChatSummaryOpenSourceRequest | null;
	onAddSource?: (sourceId: string) => void;
	onRemoveAutoAddedSource?: (sourceId: string) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const sidebarShell = useOptionalSidebarShell();
	const isMobile = useIsMobile();
	const [isPinned, setIsPinned] = React.useState(
		readDesktopChatSummaryPanelPinnedState,
	);
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "right",
			desktopStorageKey: CHAT_SUMMARY_PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: CHAT_SUMMARY_PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
		});
	const leftSidebarReservedWidth =
		sidebarShell?.state === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const sources = React.useMemo(() => collectChatSources(messages), [messages]);
	const artifacts = React.useMemo(
		() => collectChatArtifacts(messages),
		[messages],
	);
	const togglePinned = React.useCallback(() => {
		setIsPinned((current) => {
			const nextPinned = !current;
			writeDesktopChatSummaryPanelPinnedState(nextPinned);
			return nextPinned;
		});
	}, []);
	useDockedPanelInset({
		side: "right",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});

	const panel = (
		<ChatSummaryPanel
			isMobile={isMobile}
			isPinned={isPinned}
			automation={automation}
			chatTitle={chatTitle}
			desktopSafeTop={desktopSafeTop}
			artifacts={artifacts}
			sources={sources}
			workspaceSources={workspaceSources}
			openSourceRequest={openSourceRequest}
			onAddSource={onAddSource}
			onRemoveAutoAddedSource={onRemoveAutoAddedSource}
			onOpenSummary={() => onOpenChange(true)}
			onTogglePinned={togglePinned}
		/>
	);

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					showCloseButton={false}
					className="group/docked-sheet gap-0 border-l bg-background p-0 shadow-none data-[side=right]:sm:max-w-none"
					style={{ width: panelWidth, maxWidth: "100vw" }}
				>
					<SheetTitle className="sr-only">Chat summary</SheetTitle>
					<SheetDescription className="sr-only">
						View files, artifacts, and sources used in this chat.
					</SheetDescription>
					<ResizableSidePanelHandle
						side="right"
						label="Resize chat summary panel"
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
			dismissLeadingOffset={`${leftSidebarReservedWidth}px`}
			desktopSafeTop={desktopSafeTop}
			onOpenChange={onOpenChange}
			panelName="chat summary"
			resizeLabel="Resize chat summary panel"
			isResizing={isResizing}
			onResizeStart={handleResizeStart}
			onResizeKeyDown={handleResizeKeyDown}
		>
			{panel}
		</DesktopDockedSidePanel>
	);
}

function ChatSummaryPanel({
	isMobile,
	isPinned,
	automation,
	chatTitle,
	desktopSafeTop,
	artifacts,
	sources,
	workspaceSources,
	openSourceRequest,
	onAddSource,
	onRemoveAutoAddedSource,
	onOpenSummary,
	onTogglePinned,
}: {
	isMobile: boolean;
	isPinned: boolean;
	automation?: AutomationListItem | null;
	chatTitle: string;
	desktopSafeTop: boolean;
	artifacts: SummaryArtifact[];
	sources: SummarySource[];
	workspaceSources: SummaryWorkspaceSource[];
	openSourceRequest?: ChatSummaryOpenSourceRequest | null;
	onAddSource?: (sourceId: string) => void;
	onRemoveAutoAddedSource?: (sourceId: string) => void;
	onOpenSummary: () => void;
	onTogglePinned: () => void;
}) {
	const [fileTabs, setFileTabs] = React.useState<
		Extract<SummaryTab, { kind: "file" }>[]
	>([]);
	const tabs = React.useMemo(
		() => [SUMMARY_TAB, ...(automation ? [AUTOMATION_TAB] : []), ...fileTabs],
		[automation, fileTabs],
	);
	const [activeTabId, setActiveTabId] = React.useState(SUMMARY_TAB.id);
	const [fileSearchOpen, setFileSearchOpen] = React.useState(false);
	const autoAddedSourceIdsRef = React.useRef(new Set<string>());
	const handledOpenSourceRequestIdRef = React.useRef<number | null>(null);
	const effectiveActiveTabId =
		activeTabId === AUTOMATION_TAB.id && !automation
			? SUMMARY_TAB.id
			: activeTabId;
	const activeTab =
		tabs.find((tab) => tab.id === effectiveActiveTabId) ?? SUMMARY_TAB;
	const fileSearchItems = React.useMemo<SearchCommandItem[]>(
		() =>
			workspaceSources.map((source) => ({
				id: source.id,
				title: source.title,
				kind: "note" as const,
				icon: FileText,
				preview: source.preview,
				updatedAt: source.updatedAt,
			})),
		[workspaceSources],
	);
	const addTab = React.useCallback(
		(tab: Extract<SummaryTab, { kind: "file" }>) => {
			setFileTabs((current) =>
				current.some((item) => item.id === tab.id)
					? current
					: [...current, tab],
			);
			setActiveTabId(tab.id);
		},
		[],
	);
	const openWorkspaceSource = React.useCallback(
		(sourceId: string) => {
			const source = workspaceSources.find((item) => item.id === sourceId);

			if (!source) {
				return;
			}

			addTab({
				id: `file:${source.id}`,
				kind: "file",
				sourceId: source.id,
				title: source.title,
				preview: source.preview,
				content: source.content,
			});
			autoAddedSourceIdsRef.current.add(source.id);
			onAddSource?.(source.id);
			onOpenSummary();
		},
		[addTab, onAddSource, onOpenSummary, workspaceSources],
	);
	const openFileSearch = React.useCallback(() => {
		setFileSearchOpen(true);
	}, []);
	const openAutomationTab = React.useCallback(() => {
		if (automation) {
			setActiveTabId(AUTOMATION_TAB.id);
		}
	}, [automation]);
	const handleOpenSummaryShortcut = React.useEffectEvent(() => {
		onOpenSummary();
		openAutomationTab();
	});
	const handleOpenFileSearchShortcut = React.useEffectEvent(() => {
		openFileSearch();
	});

	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				isEditableShortcutTarget(event.target)
			) {
				return;
			}

			const key = event.key.toLowerCase();
			if (key !== "p" && key !== "t") {
				return;
			}

			event.preventDefault();
			if (key === "p") {
				handleOpenFileSearchShortcut();
				return;
			}

			handleOpenSummaryShortcut();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
	const closeTab = React.useCallback(
		(tabId: string) => {
			const tabToClose = fileTabs.find((tab) => tab.id === tabId);
			if (
				tabToClose?.kind === "file" &&
				autoAddedSourceIdsRef.current.has(tabToClose.sourceId)
			) {
				autoAddedSourceIdsRef.current.delete(tabToClose.sourceId);
				onRemoveAutoAddedSource?.(tabToClose.sourceId);
			}

			if (activeTabId === tabId) {
				setActiveTabId(SUMMARY_TAB.id);
			}

			setFileTabs((current) => current.filter((tab) => tab.id !== tabId));
		},
		[activeTabId, fileTabs, onRemoveAutoAddedSource],
	);
	React.useEffect(() => {
		if (!openSourceRequest) {
			return;
		}

		if (handledOpenSourceRequestIdRef.current === openSourceRequest.requestId) {
			return;
		}

		handledOpenSourceRequestIdRef.current = openSourceRequest.requestId;
		// react-doctor-disable-next-line react-doctor/no-derived-state
		openWorkspaceSource(openSourceRequest.sourceId);
	}, [openSourceRequest, openWorkspaceSource]);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				className={cn(
					"flex shrink-0 items-center justify-between",
					!isMobile && desktopSafeTop ? "h-10 px-2" : "h-16 px-4",
				)}
			>
				<SummaryTabRail
					tabs={tabs}
					activeTabId={effectiveActiveTabId}
					className={cn(
						desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						isMobile && desktopSafeTop && "mt-1",
					)}
					onSelectTab={setActiveTabId}
					onCloseTab={closeTab}
				/>
				<div
					className={cn(
						"flex items-center gap-1",
						!isMobile && desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						isMobile && desktopSafeTop && "mt-1",
					)}
				>
					<SummaryAddPopover onOpenFileSearch={openFileSearch} />
					{isMobile ? null : (
						<DockedPanelPinButton
							isPinned={isPinned}
							label="summary"
							onTogglePinned={onTogglePinned}
						/>
					)}
				</div>
			</div>
			{fileSearchOpen ? (
				<SearchCommand
					open={fileSearchOpen}
					onOpenChange={setFileSearchOpen}
					items={fileSearchItems}
					searchPlaceholder="Search notes..."
					searchDescription="Search notes..."
					filtersEnabled={false}
					groupByDate={false}
					showResultsOnEmptySearch={false}
					onSelectItem={openWorkspaceSource}
				/>
			) : null}
			<SummaryTabContent
				activeTab={activeTab}
				automation={automation}
				chatTitle={chatTitle}
				artifacts={artifacts}
				sources={sources}
			/>
		</div>
	);
}

function SummaryTabRail({
	tabs,
	activeTabId,
	className,
	onSelectTab,
	onCloseTab,
}: {
	tabs: SummaryTab[];
	activeTabId: string;
	className?: string;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
}) {
	return (
		<div
			className={cn(
				"no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden",
				className,
			)}
		>
			<div className="flex min-w-max items-center gap-1 pr-2">
				{tabs.map((tab) => {
					const isActive = tab.id === activeTabId;

					return (
						<div
							key={tab.id}
							className={cn(
								"group/tab flex h-8 max-w-36 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm transition-colors",
								isActive
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
								"focus-within:text-foreground",
							)}
							title={tab.title}
						>
							<button
								type="button"
								className="min-w-0 flex-1 cursor-pointer truncate text-left"
								onClick={() => onSelectTab(tab.id)}
							>
								{tab.title}
							</button>
							{tab.kind === "file" ? (
								<button
									type="button"
									aria-label={`Close ${tab.title}`}
									className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-0 transition-opacity group-hover/tab:opacity-100"
									onClick={() => {
										onCloseTab(tab.id);
									}}
								>
									<X className="size-3" />
								</button>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SummaryAddPopover({
	onOpenFileSearch,
}: {
	onOpenFileSearch: () => void;
}) {
	const [open, setOpen] = React.useState(false);
	const handleOpenChange = React.useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
	}, []);

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Add tab"
						>
							<Plus className="size-4" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Add tab</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" sideOffset={6} className="w-56 p-0">
				<Command>
					<CommandList>
						<CommandGroup>
							<CommandItem
								value="open-file"
								className="group/summary-add-item cursor-pointer"
								onSelect={() => {
									handleOpenChange(false);
									onOpenFileSearch();
								}}
							>
								<FileText className="size-4" />
								Open note
								<SummaryAddShortcut keyLabel="P" />
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function SummaryAddShortcut({ keyLabel }: { keyLabel: string }) {
	return (
		<CommandShortcut className="opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/summary-add-item:opacity-100 group-focus-visible/summary-add-item:opacity-100">
			<Kbd
				aria-hidden="true"
				className="border border-border/60 bg-muted px-1.5 font-mono"
			>
				<span className="text-xs">⌘</span>
				{keyLabel}
			</Kbd>
		</CommandShortcut>
	);
}

function isEditableShortcutTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target.closest("[data-chat-prompt='true']")) {
		return false;
	}

	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target.isContentEditable
	);
}

function SummaryTabContent({
	activeTab,
	automation,
	chatTitle,
	artifacts,
	sources,
}: {
	activeTab: SummaryTab;
	automation?: AutomationListItem | null;
	chatTitle: string;
	artifacts: SummaryArtifact[];
	sources: SummarySource[];
}) {
	if (activeTab.kind === "automation") {
		return automation ? (
			<AutomationSummaryContent automation={automation} chatTitle={chatTitle} />
		) : (
			<div className="min-h-0 flex-1 p-4">
				<Empty className="h-full border-0">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Clock3 />
						</EmptyMedia>
						<EmptyTitle>Automation unavailable</EmptyTitle>
						<EmptyDescription>There are no automations yet.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	if (activeTab.kind === "file") {
		return (
			<ScrollArea
				className="min-h-0 flex-1"
				reserveScrollbarGap
				viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
			>
				<div className="summary-note-preview-content flex flex-col gap-4 px-5 py-4">
					<div className="flex items-center gap-2 text-lg font-medium leading-tight tracking-tight">
						<span className="min-w-0 truncate">{activeTab.title}</span>
					</div>
					{activeTab.preview ? (
						<ReadOnlyNoteContent
							content={activeTab.content}
							fallbackText={activeTab.preview}
						/>
					) : (
						<p className="text-xs text-muted-foreground">
							No preview available.
						</p>
					)}
				</div>
			</ScrollArea>
		);
	}

	return <SummaryDefaultContent artifacts={artifacts} sources={sources} />;
}

const automationDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
	year: "numeric",
});

const automationRelativeDayFormatter = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

const automationTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

function formatAutomationTimestamp(value: number | null) {
	if (!value) {
		return "Never";
	}

	return automationDateTimeFormatter.format(new Date(value));
}

function formatAutomationNextRun(value: number | null) {
	if (!value) {
		return "Not scheduled";
	}

	const now = new Date();
	const date = new Date(value);
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const startOfRunDay = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
	const dayDiff = Math.round((startOfRunDay - startOfToday) / 86_400_000);
	const dayLabel = automationRelativeDayFormatter.format(dayDiff, "day");
	const timeLabel = automationTimeFormatter.format(date);

	return `${dayLabel.charAt(0).toUpperCase()}${dayLabel.slice(1)} at ${timeLabel}`;
}

function AutomationSummaryContent({
	automation,
	chatTitle,
}: {
	automation: AutomationListItem;
	chatTitle: string;
}) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			reserveScrollbarGap
			viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
		>
			<div className="flex flex-col gap-5 px-3 py-4">
				<div className="flex items-start gap-3 rounded-lg p-2">
					<div className="min-w-0 flex-1">
						<h2 className="truncate text-sm font-medium text-foreground">
							{automation.title}
						</h2>
						<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
							{automation.prompt}
						</p>
					</div>
				</div>

				<AutomationSummarySection title="Status">
					<AutomationSummaryRow
						label="Status"
						value={
							<span className="inline-flex min-w-0 items-center gap-2">
								<span
									className={cn(
										"size-2 rounded-full",
										automation.isPaused
											? "bg-muted-foreground"
											: "bg-emerald-500",
									)}
								/>
								{automation.isPaused ? "Paused" : "Active"}
							</span>
						}
					/>
					<AutomationSummaryRow
						label="Next run"
						value={formatAutomationNextRun(automation.nextRunAt)}
					/>
					<AutomationSummaryRow
						label="Last ran"
						value={formatAutomationTimestamp(automation.lastRunAt)}
					/>
				</AutomationSummarySection>

				<AutomationSummarySection title="Details">
					<AutomationSummaryRow
						label="Chat"
						value={chatTitle.trim() || "New chat"}
					/>
					<AutomationSummaryRow
						label="Interval"
						value={getAutomationSchedulePeriodLabel(automation)}
					/>
				</AutomationSummarySection>
			</div>
		</ScrollArea>
	);
}

function AutomationSummarySection({
	children,
	defaultOpen = true,
	title,
}: {
	children: React.ReactNode;
	defaultOpen?: boolean;
	title: string;
}) {
	return (
		<SummarySection defaultOpen={defaultOpen} title={title}>
			<div className="space-y-0.5">{children}</div>
		</SummarySection>
	);
}

function AutomationSummaryRow({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="grid min-h-8 grid-cols-[minmax(5.5rem,0.8fr)_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 text-sm">
			<div className="truncate text-muted-foreground">{label}</div>
			<div className="min-w-0 justify-self-end truncate text-right text-muted-foreground">
				{value}
			</div>
		</div>
	);
}

function ReadOnlyNoteContent({
	content,
	fallbackText,
}: {
	content?: string;
	fallbackText: string;
}) {
	const editor = useEditor({
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		editable: false,
		editorProps: {
			attributes: {
				class:
					"note-tiptap min-h-0 border border-transparent bg-transparent px-0 py-0 text-base outline-none",
			},
		},
	});

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		editor.commands.setContent(
			parseStoredNoteContent(
				content?.trim() ? content : fallbackText,
				editor.state.schema,
			),
			{
				emitUpdate: false,
			},
		);
	}, [content, editor, fallbackText]);

	if (!editor) {
		return null;
	}

	return (
		<Tiptap editor={editor}>
			<Tiptap.Content className="text-base text-foreground" />
		</Tiptap>
	);
}

function SummaryDefaultContent({
	artifacts,
	sources,
}: {
	artifacts: SummaryArtifact[];
	sources: SummarySource[];
}) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			reserveScrollbarGap
			viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
		>
			<div className="flex flex-col gap-2 px-3 py-4">
				<SummarySection title="Artifacts">
					{artifacts.length > 0 ? (
						<div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
							{artifacts.map((artifact) => (
								<HoverCard key={artifact.url} openDelay={150}>
									<HoverCardTrigger asChild>
										<button
											type="button"
											title={artifact.filename || "Attached file"}
											className={cn(
												"group/artifact flex h-8 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-muted-foreground transition-colors",
												"hover:bg-accent/50 hover:text-foreground",
											)}
										>
											<Paperclip className="size-3.5 shrink-0" />
											<span className="min-w-0 flex-1 basis-0 truncate">
												{artifact.filename || "Attached file"}
											</span>
										</button>
									</HoverCardTrigger>
									<HoverCardContent
										align="start"
										side="left"
										className={
											artifact.mediaType.startsWith("image/")
												? "w-auto max-w-80 border-0 bg-transparent p-0 shadow-none ring-0"
												: "w-64"
										}
									>
										{artifact.mediaType.startsWith("image/") ? (
											<img
												src={artifact.url}
												alt={artifact.filename || "Attached image"}
												className="block max-h-80 max-w-80 rounded-lg object-contain shadow-md ring-1 ring-foreground/10"
											/>
										) : (
											<div className="flex h-28 items-center justify-center bg-muted/40 text-muted-foreground">
												<Paperclip className="size-6" />
											</div>
										)}
									</HoverCardContent>
								</HoverCard>
							))}
						</div>
					) : (
						<p className="px-2 py-1.5 text-xs text-muted-foreground">
							View and open files
						</p>
					)}
				</SummarySection>
				<SummarySection title="Sources">
					{sources.length > 0 ? (
						<div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
							{sources.map((source) => (
								<SummarySourceRow
									key={getSummarySourceKey(source)}
									source={source}
								/>
							))}
						</div>
					) : (
						<p className="px-2 py-1.5 text-xs text-muted-foreground">
							No sources yet
						</p>
					)}
				</SummarySection>
			</div>
		</ScrollArea>
	);
}

function getSummarySourceKey(source: SummarySource) {
	if (source.kind === "link") {
		return `${source.kind}:${source.href}:${source.title}`;
	}

	if (source.kind === "file") {
		return `${source.kind}:${source.url}`;
	}

	return `${source.kind}:${source.id}`;
}

function SummarySourceRow({ source }: { source: SummarySource }) {
	const className = cn(
		"group/source flex h-8 w-full min-w-0 max-w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-muted-foreground transition-colors",
		"hover:bg-accent/50 hover:text-foreground",
	);

	if (source.kind === "file") {
		return (
			<HoverCard openDelay={150}>
				<HoverCardTrigger asChild>
					<button
						type="button"
						className={className}
						title={source.filename || "Attached file"}
					>
						<Paperclip className="size-3.5 shrink-0" />
						<span className="min-w-0 flex-1 basis-0 truncate">
							{source.filename || "Attached file"}
						</span>
					</button>
				</HoverCardTrigger>
				<HoverCardContent
					align="start"
					side="left"
					className={
						source.mediaType.startsWith("image/")
							? "w-auto max-w-80 border-0 bg-transparent p-0 shadow-none ring-0"
							: "w-64"
					}
				>
					{source.mediaType.startsWith("image/") ? (
						<img
							src={source.url}
							alt={source.filename || "Attached image"}
							className="block max-h-80 max-w-80 rounded-lg object-contain shadow-md ring-1 ring-foreground/10"
						/>
					) : (
						<div className="flex h-28 items-center justify-center bg-muted/40 text-muted-foreground">
							<Paperclip className="size-6" />
						</div>
					)}
				</HoverCardContent>
			</HoverCard>
		);
	}

	if (source.kind === "tool") {
		return (
			<div className={className} title={source.title}>
				<SummaryToolSourceIcon source={source} />
				<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
			</div>
		);
	}

	return (
		<a
			href={source.href}
			target="_blank"
			rel="noreferrer"
			className={className}
			title={source.title}
		>
			<Globe className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1 basis-0 truncate">{source.title}</span>
			<ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover/source:opacity-70" />
		</a>
	);
}

function SummaryToolSourceIcon({
	source,
}: {
	source: Extract<SummarySource, { kind: "tool" }>;
}) {
	const provider = getSummaryToolProvider(source);

	return provider ? (
		<AppSourceIcon provider={provider} className="size-3.5 shrink-0" />
	) : null;
}

function getSummaryToolProvider(
	source: Extract<SummarySource, { kind: "tool" }>,
): ChatAppSourceProvider | null {
	const normalizedId = source.id.replace(/^app:/, "");

	for (const provider of CHAT_APP_SOURCE_PROVIDERS) {
		if (
			normalizedId === provider ||
			source.title.toLowerCase() === getAppSourceLabel(provider).toLowerCase()
		) {
			return provider;
		}
	}

	return null;
}

function SummarySection({
	children,
	defaultOpen = true,
	title,
}: {
	children: React.ReactNode;
	defaultOpen?: boolean;
	title: string;
}) {
	const contentId = React.useId();

	return (
		<Collapsible defaultOpen={defaultOpen} className="group/collapsible">
			<CollapsibleTrigger
				aria-controls={contentId}
				className={cn(
					"group/label flex h-8 w-full cursor-pointer items-center justify-start gap-1.5 rounded-lg px-3 text-xs font-medium text-sidebar-foreground/60 outline-hidden transition-colors",
					"hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				)}
			>
				<span>{title}</span>
				<ChevronRight
					className={cn(
						"mt-px size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/label:opacity-100 group-focus-visible/label:opacity-100",
						"group-data-[state=open]/collapsible:rotate-90",
					)}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent
				id={contentId}
				className="min-w-0 overflow-hidden px-1 pb-2"
			>
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
