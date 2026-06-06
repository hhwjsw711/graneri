"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Calendar,
	CalendarDayButton,
	type DateRange,
} from "@workspace/ui/components/calendar";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@workspace/ui/components/command";
import { Kbd } from "@workspace/ui/components/kbd";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "convex/react";
import {
	CalendarDays,
	CaseSensitive,
	Check,
	ChevronDown,
	FileText,
	ListFilter,
	type LucideIcon,
	MessageCircle,
} from "lucide-react";
import * as React from "react";
import {
	groupItemsByRelativeDate,
	RELATIVE_DATE_GROUP_SECTIONS,
} from "@/lib/group-by-relative-date";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export interface SearchCommandItem {
	id: string;
	title: string;
	kind: "note" | "chat";
	icon: LucideIcon;
	projectName?: string;
	preview?: string;
	updatedAt?: number;
}

export interface SearchCommandProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	items: SearchCommandItem[];
	onSelectItem: (itemId: string) => void;
	workspaceId?: Id<"workspaces"> | null;
	searchKind?: "notes" | "chats";
	searchPlaceholder?: string;
	searchDescription?: string;
	filtersEnabled?: boolean;
	groupByDate?: boolean;
	showResultsOnEmptySearch?: boolean;
	showKeyboardHintsFooter?: boolean;
	keyboardHintsSearchKind?: "notes" | "chats";
}

type SearchFiltersState = {
	searchValue: string;
	filtersVisible: boolean;
	titleOnly: boolean;
	dateFilter: "all" | "today" | "last7" | "last30" | "custom";
	dateRange: DateRange | undefined;
	datePopoverOpen: boolean;
};

const INITIAL_SEARCH_FILTERS_STATE: SearchFiltersState = {
	searchValue: "",
	filtersVisible: false,
	titleOnly: false,
	dateFilter: "all",
	dateRange: undefined,
	datePopoverOpen: false,
};

const searchDateRangeFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

const reduceSearchFiltersState = (
	state: SearchFiltersState,
	patch: Partial<SearchFiltersState>,
) => ({ ...state, ...patch });

function useSearchCommandFilters({ open }: { open: boolean }) {
	const [state, setState] = React.useReducer(
		reduceSearchFiltersState,
		INITIAL_SEARCH_FILTERS_STATE,
	);
	const {
		searchValue,
		filtersVisible,
		titleOnly,
		dateFilter,
		dateRange,
		datePopoverOpen,
	} = state;

	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-event-handler
		if (!open) {
			setState(INITIAL_SEARCH_FILTERS_STATE);
		}
	}, [open]);

	const hideFilters = React.useCallback(() => {
		setState({
			filtersVisible: false,
			searchValue: "",
			titleOnly: false,
			dateFilter: "all",
			dateRange: undefined,
			datePopoverOpen: false,
		});
	}, []);

	return {
		searchValue,
		filtersVisible,
		titleOnly,
		dateFilter,
		dateRange,
		datePopoverOpen,
		setState,
		hideFilters,
	};
}

function SearchCommandFilters({
	searchValue,
	filtersVisible,
	titleOnly,
	dateFilter,
	dateRange,
	datePopoverOpen,
	searchPlaceholder,
	filtersEnabled,
	dateFilterLabel,
	onOpenChange,
	setState,
	hideFilters,
}: {
	searchValue: string;
	filtersVisible: boolean;
	titleOnly: boolean;
	dateFilter: "all" | "today" | "last7" | "last30" | "custom";
	dateRange: DateRange | undefined;
	datePopoverOpen: boolean;
	searchPlaceholder: string;
	filtersEnabled: boolean;
	dateFilterLabel: string;
	onOpenChange: (open: boolean) => void;
	setState: React.ActionDispatch<[patch: Partial<SearchFiltersState>]>;
	hideFilters: () => void;
}) {
	const [defaultCalendarMonth] = React.useState(() => new Date());

	return (
		<>
			<div className="flex items-start gap-1 px-1 pt-1">
				<div className="relative min-w-0 flex-1">
					<CommandInput
						value={searchValue}
						onValueChange={(value) => setState({ searchValue: value })}
						placeholder={searchPlaceholder}
						className="pr-14"
					/>
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="absolute top-5 right-4 z-10 flex -translate-y-1/2 items-center"
						aria-label="Close search"
					>
						<Kbd className="font-mono">Esc</Kbd>
					</button>
				</div>
				{filtersEnabled ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-pressed={filtersVisible}
								aria-label={filtersVisible ? "Hide filters" : "Show filters"}
								onClick={() => {
									if (filtersVisible) {
										hideFilters();
										return;
									}

									setState({ filtersVisible: true });
								}}
								className={cn(
									"mt-1 size-8 rounded-lg p-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground",
									filtersVisible && "bg-muted text-foreground",
								)}
							>
								<ListFilter className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							{filtersVisible ? "Hide filters" : "Show filters"}
						</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{filtersEnabled && filtersVisible ? (
				<div className="flex items-center gap-1.5 px-2 pb-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-pressed={titleOnly}
						aria-label="Search titles only"
						onClick={() => setState({ titleOnly: !titleOnly })}
						className={cn(
							"h-7 rounded-full border border-transparent bg-transparent px-2.5 font-normal text-sm text-muted-foreground shadow-none hover:bg-muted hover:text-foreground",
							titleOnly && "border-border/60 bg-muted text-foreground",
						)}
					>
						<CaseSensitive className="size-3.5" />
						<span className="truncate">Title only</span>
					</Button>
					<Popover
						open={datePopoverOpen}
						onOpenChange={(nextOpen) => setState({ datePopoverOpen: nextOpen })}
					>
						<PopoverTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className={cn(
									"h-7 rounded-full border border-transparent bg-transparent px-2.5 font-normal text-sm text-muted-foreground shadow-none hover:bg-muted hover:text-foreground aria-expanded:border-border/60 aria-expanded:bg-muted aria-expanded:text-foreground",
									dateFilter !== "all" && "bg-muted text-foreground",
								)}
							>
								<CalendarDays className="size-3.5" />
								<span className="truncate">{dateFilterLabel}</span>
								<ChevronDown className="size-3.5 opacity-70" />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							sideOffset={6}
							className="w-56 gap-0 p-0"
						>
							<div className="flex flex-col gap-0.5 p-1.5">
								<SearchDatePresetOption
									label="Today"
									selected={dateFilter === "today"}
									onSelect={() => {
										setState({
											dateFilter: "today",
											dateRange: undefined,
											datePopoverOpen: false,
										});
									}}
								/>
								<SearchDatePresetOption
									label="Last 7 days"
									selected={dateFilter === "last7"}
									onSelect={() => {
										setState({
											dateFilter: "last7",
											dateRange: undefined,
											datePopoverOpen: false,
										});
									}}
								/>
								<SearchDatePresetOption
									label="Last 30 days"
									selected={dateFilter === "last30"}
									onSelect={() => {
										setState({
											dateFilter: "last30",
											dateRange: undefined,
											datePopoverOpen: false,
										});
									}}
								/>
							</div>
							<Separator />
							<div className="p-1.5">
								<Calendar
									mode="range"
									selected={dateRange}
									defaultMonth={dateRange?.from ?? defaultCalendarMonth}
									classNames={{
										root: "w-full",
										today:
											"rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-(--cell-radius)",
									}}
									components={{
										DayButton: SearchDateCalendarDayButton,
									}}
									onSelect={(range) => {
										setState({
											dateRange: range,
											dateFilter: range?.from ? "custom" : "all",
										});
									}}
									className="p-0 text-sm [--cell-size:--spacing(6)]"
								/>
							</div>
							<Separator />
							<div className="px-2.5 py-1.5">
								<button
									type="button"
									onClick={() => {
										setState({
											dateFilter: "all",
											dateRange: undefined,
											datePopoverOpen: false,
										});
									}}
									className="cursor-pointer text-sm hover:text-foreground"
								>
									Clear
								</button>
							</div>
						</PopoverContent>
					</Popover>
				</div>
			) : null}
		</>
	);
}

export function SearchCommand({
	open,
	onOpenChange,
	items,
	onSelectItem,
	workspaceId,
	searchKind = "notes",
	searchPlaceholder = "Search notes...",
	searchDescription = "Search notes...",
	filtersEnabled = true,
	groupByDate = true,
	showResultsOnEmptySearch = true,
	showKeyboardHintsFooter = false,
	keyboardHintsSearchKind = searchKind,
}: SearchCommandProps) {
	const filters = useSearchCommandFilters({ open });

	if (workspaceId) {
		return (
			<SearchCommandWithServerSearch
				open={open}
				onOpenChange={onOpenChange}
				items={items}
				onSelectItem={onSelectItem}
				workspaceId={workspaceId}
				searchKind={searchKind}
				searchPlaceholder={searchPlaceholder}
				searchDescription={searchDescription}
				filtersEnabled={filtersEnabled}
				groupByDate={groupByDate}
				showResultsOnEmptySearch={showResultsOnEmptySearch}
				showKeyboardHintsFooter={showKeyboardHintsFooter}
				keyboardHintsSearchKind={keyboardHintsSearchKind}
				filters={filters}
			/>
		);
	}

	return (
		<SearchCommandView
			open={open}
			onOpenChange={onOpenChange}
			items={items}
			onSelectItem={onSelectItem}
			searchPlaceholder={searchPlaceholder}
			searchDescription={searchDescription}
			filtersEnabled={filtersEnabled}
			groupByDate={groupByDate}
			showResultsOnEmptySearch={showResultsOnEmptySearch}
			showKeyboardHintsFooter={showKeyboardHintsFooter}
			keyboardHintsSearchKind={keyboardHintsSearchKind}
			filters={filters}
			shouldFilter
		/>
	);
}

function SearchCommandWithServerSearch({
	items,
	workspaceId,
	searchKind = "notes",
	filters,
	...props
}: SearchCommandProps & {
	workspaceId: Id<"workspaces">;
	filters: ReturnType<typeof useSearchCommandFilters>;
}) {
	const deferredSearchValue = React.useDeferredValue(filters.searchValue);
	const normalizedSearchValue = deferredSearchValue.trim();
	const shouldUseServerSearch = normalizedSearchValue.length > 0;
	const serverSearchResults = useQuery(
		api.search.command,
		shouldUseServerSearch
			? {
					workspaceId,
					query: normalizedSearchValue,
					kind: searchKind,
					titleOnly: filters.titleOnly,
				}
			: "skip",
	);
	const searchItems = React.useMemo<SearchCommandItem[] | null>(() => {
		if (!shouldUseServerSearch) {
			return null;
		}

		return (serverSearchResults ?? []).map((item) => ({
			id: item.id,
			title: item.title,
			kind: item.kind,
			icon: item.kind === "chat" ? MessageCircle : FileText,
			projectName: item.projectName,
			preview: item.preview,
			updatedAt: item.updatedAt,
		}));
	}, [serverSearchResults, shouldUseServerSearch]);

	return (
		<SearchCommandView
			{...props}
			items={searchItems ?? items}
			workspaceId={workspaceId}
			filters={filters}
			shouldFilter={!shouldUseServerSearch}
		/>
	);
}

function SearchCommandView({
	open,
	onOpenChange,
	items,
	onSelectItem,
	searchPlaceholder = "Search notes...",
	searchDescription = "Search notes...",
	filtersEnabled = true,
	groupByDate = true,
	showResultsOnEmptySearch = true,
	showKeyboardHintsFooter = false,
	keyboardHintsSearchKind = "notes",
	filters,
	shouldFilter,
}: SearchCommandProps & {
	filters: ReturnType<typeof useSearchCommandFilters>;
	shouldFilter: boolean;
}) {
	const {
		searchValue,
		filtersVisible,
		titleOnly,
		dateFilter,
		dateRange,
		datePopoverOpen,
		setState,
		hideFilters,
	} = filters;

	const titleFilteredItems = React.useMemo(() => {
		const normalizedSearchValue = searchValue.trim().toLocaleLowerCase();

		if (!shouldFilter || !titleOnly || !normalizedSearchValue) {
			return items;
		}

		return items.filter((item) =>
			item.title.toLocaleLowerCase().includes(normalizedSearchValue),
		);
	}, [items, searchValue, shouldFilter, titleOnly]);
	const dateFilteredItems = React.useMemo(
		() =>
			titleFilteredItems.filter((item) =>
				matchesDateFilter(item.updatedAt, dateFilter, dateRange),
			),
		[dateFilter, dateRange, titleFilteredItems],
	);

	const visibleItems = dateFilteredItems;
	const groupedItems = React.useMemo(
		() => groupItemsByRelativeDate(visibleItems, (item) => item.updatedAt),
		[visibleItems],
	);
	const itemSections = React.useMemo(
		() =>
			RELATIVE_DATE_GROUP_SECTIONS.map((section) => ({
				...section,
				items: groupedItems[section.key],
			})),
		[groupedItems],
	);
	const dateFilterLabel = getDateFilterLabel(dateFilter, dateRange);
	const isFilterPopoverOpen = datePopoverOpen;
	const shouldShowResults =
		showResultsOnEmptySearch || searchValue.trim().length > 0;
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Search"
			description={searchDescription}
			className="top-1/2 max-w-[calc(100%-2rem)] -translate-y-1/2 rounded-lg sm:max-w-lg"
		>
			<Command
				shouldFilter={shouldFilter && !titleOnly}
				className="**:[[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 **:[[cmdk-group-heading]]:px-1.5 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 **:[[cmdk-input-wrapper]_svg]:size-5 **:[[cmdk-input]]:h-12"
			>
				<SearchCommandFilters
					searchValue={searchValue}
					filtersVisible={filtersVisible}
					titleOnly={titleOnly}
					dateFilter={dateFilter}
					dateRange={dateRange}
					datePopoverOpen={datePopoverOpen}
					searchPlaceholder={searchPlaceholder}
					filtersEnabled={filtersEnabled}
					dateFilterLabel={dateFilterLabel}
					onOpenChange={onOpenChange}
					setState={setState}
					hideFilters={hideFilters}
				/>
				{shouldShowResults ? (
					<CommandList
						className={cn(
							"h-[22rem] max-h-[calc(100vh-14rem)] min-h-[14rem]",
							isFilterPopoverOpen && "pointer-events-none",
						)}
					>
						<CommandEmpty>No results found.</CommandEmpty>
						{groupByDate ? (
							itemSections.map((section) =>
								section.items.length > 0 ? (
									<CommandGroup key={section.key} heading={section.label}>
										<div className="flex flex-col gap-1">
											{section.items.map((item) => (
												<SearchCommandRow
													key={item.id}
													item={item}
													titleOnly={titleOnly}
													onSelect={() => {
														onOpenChange(false);
														onSelectItem(item.id);
													}}
												/>
											))}
										</div>
									</CommandGroup>
								) : null,
							)
						) : (
							<CommandGroup>
								<div className="flex flex-col gap-1">
									{visibleItems.map((item) => (
										<SearchCommandRow
											key={item.id}
											item={item}
											titleOnly={titleOnly}
											onSelect={() => {
												onOpenChange(false);
												onSelectItem(item.id);
											}}
										/>
									))}
								</div>
							</CommandGroup>
						)}
					</CommandList>
				) : (
					<div className="flex h-12 items-center px-3 text-muted-foreground text-xs">
						Type to search for notes
					</div>
				)}
				{showKeyboardHintsFooter ? (
					<SearchCommandKeyboardHints searchKind={keyboardHintsSearchKind} />
				) : null}
			</Command>
		</CommandDialog>
	);
}

function SearchCommandKeyboardHints({
	searchKind,
}: {
	searchKind: "notes" | "chats";
}) {
	const kbdClassName =
		"border border-border/60 bg-muted px-1.5 font-mono text-xs";
	const switchSearchLabel =
		searchKind === "chats" ? "search notes" : "search chats";

	return (
		<div className="flex h-11 items-center gap-5 px-4 text-muted-foreground text-xs">
			<div className="flex items-center gap-2">
				<Kbd aria-hidden="true" className={kbdClassName}>
					↑↓
				</Kbd>
				<span>navigate</span>
			</div>
			<div className="flex items-center gap-2">
				<Kbd aria-hidden="true" className={kbdClassName}>
					↵
				</Kbd>
				<span>open</span>
			</div>
			<div className="flex items-center gap-2">
				{searchKind === "chats" ? (
					<Kbd aria-hidden="true" className={kbdClassName}>
						<span>⌘</span>
						<span>K</span>
					</Kbd>
				) : (
					<Kbd aria-hidden="true" className={kbdClassName}>
						<span>⌘</span>
						<span>⌥</span>
						<span>K</span>
					</Kbd>
				)}
				<span>{switchSearchLabel}</span>
			</div>
		</div>
	);
}

function SearchCommandRow({
	item,
	titleOnly,
	onSelect,
}: {
	item: SearchCommandItem;
	titleOnly: boolean;
	onSelect: () => void;
}) {
	return (
		<CommandItem
			value={getSearchCommandItemValue(item, titleOnly)}
			onSelect={onSelect}
			className="h-8 cursor-pointer gap-1.5 rounded-md px-1.5"
		>
			<div className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
				<item.icon className="size-4" />
			</div>
			<div className="min-w-0 flex-1 truncate">{item.title}</div>
			{item.projectName ? (
				<div className="max-w-32 shrink-0 truncate text-muted-foreground">
					{item.projectName}
				</div>
			) : null}
		</CommandItem>
	);
}

function getSearchCommandItemValue(
	item: SearchCommandItem,
	titleOnly: boolean,
) {
	const projectName = item.projectName ?? "";

	if (titleOnly) {
		return `${item.kind} ${item.id} ${item.title} ${projectName}`;
	}

	return `${item.kind} ${item.id} ${item.title} ${projectName} ${item.preview ?? ""}`;
}

function SearchDatePresetOption({
	label,
	selected,
	onSelect,
}: {
	label: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex h-7 w-full cursor-pointer items-center rounded-md px-2 text-sm text-foreground transition-colors hover:bg-muted",
				selected && "bg-muted",
			)}
		>
			<span className="truncate">{label}</span>
			{selected ? <Check className="ml-auto size-3.5" /> : null}
		</button>
	);
}

function SearchDateCalendarDayButton(
	props: React.ComponentProps<typeof CalendarDayButton>,
) {
	const { modifiers } = props;
	const isToday = Boolean(modifiers.today);
	const isSelected = Boolean(
		modifiers.selected ||
			modifiers.range_start ||
			modifiers.range_middle ||
			modifiers.range_end,
	);

	return (
		<CalendarDayButton
			{...props}
			className={cn(
				props.className,
				"text-sm",
				isToday && !isSelected && "text-destructive",
				isToday &&
					"data-[selected-single=true]:bg-destructive/15 data-[selected-single=true]:text-destructive dark:data-[selected-single=true]:bg-destructive/25 data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:bg-destructive/15 data-[range-start=true]:text-destructive dark:data-[range-start=true]:bg-destructive/25 data-[range-middle=true]:bg-destructive/15 data-[range-middle=true]:text-destructive dark:data-[range-middle=true]:bg-destructive/25 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:bg-destructive/15 data-[range-end=true]:text-destructive dark:data-[range-end=true]:bg-destructive/25",
			)}
		/>
	);
}

function matchesDateFilter(
	updatedAt: number | undefined,
	filter: "all" | "today" | "last7" | "last30" | "custom",
	range: DateRange | undefined,
) {
	if (filter === "all") {
		return true;
	}

	if (!updatedAt) {
		return false;
	}

	const now = new Date();

	if (filter === "today") {
		return (
			updatedAt >= startOfDay(now).getTime() &&
			updatedAt <= endOfDay(now).getTime()
		);
	}

	if (filter === "last7") {
		return (
			updatedAt >= startOfDay(daysAgo(6)).getTime() &&
			updatedAt <= endOfDay(now).getTime()
		);
	}

	if (filter === "last30") {
		return (
			updatedAt >= startOfDay(daysAgo(29)).getTime() &&
			updatedAt <= endOfDay(now).getTime()
		);
	}

	if (!range?.from) {
		return true;
	}

	const from = startOfDay(range.from).getTime();
	const to = endOfDay(range.to ?? range.from).getTime();
	return updatedAt >= from && updatedAt <= to;
}

function getDateFilterLabel(
	filter: "all" | "today" | "last7" | "last30" | "custom",
	range: DateRange | undefined,
) {
	if (filter === "all") {
		return "Date";
	}

	if (filter === "today") {
		return "Today";
	}

	if (filter === "last7") {
		return "Last 7 days";
	}

	if (filter === "last30") {
		return "Last 30 days";
	}

	if (!range?.from) {
		return "Date";
	}

	return formatDateRange(range);
}

function formatDateRange(range: DateRange) {
	if (!range.from) {
		return "Date";
	}

	if (!range.to) {
		return searchDateRangeFormatter.format(range.from);
	}

	return `${searchDateRangeFormatter.format(range.from)} - ${searchDateRangeFormatter.format(range.to)}`;
}

function startOfDay(date: Date) {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		0,
		0,
		0,
		0,
	);
}

function endOfDay(date: Date) {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		23,
		59,
		59,
		999,
	);
}

function daysAgo(days: number) {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date;
}
