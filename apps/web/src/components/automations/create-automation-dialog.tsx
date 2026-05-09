"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@workspace/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Icons } from "@workspace/ui/components/icons";
import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "convex/react";
import {
	AtSign,
	CirclePlus,
	Clock,
	FileText,
	Globe,
	LayoutGrid,
	Plus,
	Settings2,
	X,
} from "lucide-react";
import * as React from "react";
import {
	AUTOMATION_SCHEDULE_PERIODS,
	type AutomationAppSource,
	type AutomationDraft,
	type AutomationSchedulePeriod,
	type AutomationTarget,
} from "@/components/automations/automation-types";
import { getAutomationSchedulePeriodLabel } from "@/components/automations/automation-utils";
import { ChatModelPicker } from "@/components/chat/model-picker";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { type AppSource, useAppSources } from "@/hooks/use-app-sources";
import { defaultChatModel, findChatModel } from "@/lib/ai/models";
import {
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const AUTOMATION_PICKER_TRIGGER_CLASS_NAME =
	"group/automation-picker min-w-0 max-w-[180px] justify-start overflow-hidden rounded-full font-normal text-muted-foreground";

type CreateAutomationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateAutomation: (automation: AutomationDraft) => void | Promise<void>;
	onOpenConnectionsSettings: () => void;
	initialAutomation?: AutomationDraft | null;
	initialTitle?: string;
};

type AutomationNoteSource = {
	id: Id<"notes">;
	title: string;
	preview: string;
};

type NoteMentionRange = {
	start: number;
	end: number;
	query: string;
};

const findNoteMentionRange = (
	value: string,
	cursorPosition: number,
): NoteMentionRange | null => {
	const textBeforeCursor = value.slice(0, cursorPosition);
	const mentionStart = textBeforeCursor.lastIndexOf("@");

	if (mentionStart === -1) {
		return null;
	}

	const characterBeforeMention = value[mentionStart - 1];
	if (characterBeforeMention && !/\s/.test(characterBeforeMention)) {
		return null;
	}

	const mentionText = value.slice(mentionStart + 1, cursorPosition);
	if (/\s/.test(mentionText)) {
		return null;
	}

	return {
		start: mentionStart,
		end: cursorPosition,
		query: mentionText,
	};
};

const createInitialScheduledAt = () => {
	const nextDate = new Date();
	nextDate.setHours(9, 0, 0, 0);
	return nextDate;
};

const formatTimeInputValue = (value: Date) => {
	const hours = String(value.getHours()).padStart(2, "0");
	const minutes = String(value.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
};

type AutomationDialogState = {
	schedulePickerOpen: boolean;
	modelPickerOpen: boolean;
	appSourcesPickerOpen: boolean;
	notePickerOpen: boolean;
	noteSearchTerm: string;
	noteMentionRange: NoteMentionRange | null;
	title: string;
	prompt: string;
	selectedModel: typeof defaultChatModel;
	schedulePeriod: AutomationSchedulePeriod;
	scheduledAt: Date;
	target: AutomationTarget | null;
	webSearchEnabled: boolean;
	appsEnabled: boolean;
	selectedConnectedAppIds: string[];
	selectedNoteIds: Array<Id<"notes">>;
};

type AutomationDialogStateUpdate =
	| Partial<AutomationDialogState>
	| ((currentState: AutomationDialogState) => Partial<AutomationDialogState>);

const createEmptyAutomationDialogState = (): AutomationDialogState => ({
	schedulePickerOpen: false,
	modelPickerOpen: false,
	appSourcesPickerOpen: false,
	notePickerOpen: false,
	noteSearchTerm: "",
	noteMentionRange: null,
	title: "",
	prompt: "",
	selectedModel: defaultChatModel,
	schedulePeriod: "daily",
	scheduledAt: createInitialScheduledAt(),
	target: null,
	webSearchEnabled: false,
	appsEnabled: true,
	selectedConnectedAppIds: [],
	selectedNoteIds: [],
});

const createAutomationDialogState = (
	initialAutomation: AutomationDraft | null,
	initialTitle = "",
): AutomationDialogState => {
	const emptyState = createEmptyAutomationDialogState();

	if (!initialAutomation) {
		return {
			...emptyState,
			title: initialTitle.trim(),
		};
	}

	return {
		...emptyState,
		title: initialAutomation.title,
		prompt: initialAutomation.prompt,
		selectedModel: findChatModel(initialAutomation.model) ?? defaultChatModel,
		schedulePeriod: initialAutomation.schedulePeriod,
		scheduledAt: new Date(initialAutomation.scheduledAt),
		webSearchEnabled: initialAutomation.webSearchEnabled,
		appsEnabled: initialAutomation.appsEnabled,
		target:
			initialAutomation.target.kind === "project"
				? initialAutomation.target
				: null,
		selectedConnectedAppIds: (initialAutomation.appSources ?? []).map(
			(source) => source.id,
		),
		selectedNoteIds:
			initialAutomation.target.kind === "notes"
				? initialAutomation.target.noteIds
				: [],
	};
};

const automationDialogStateReducer = (
	state: AutomationDialogState,
	update: AutomationDialogStateUpdate,
): AutomationDialogState => ({
	...state,
	...(typeof update === "function" ? update(state) : update),
});

function useCreateAutomationDialogElement({
	open,
	onOpenChange,
	onCreateAutomation,
	onOpenConnectionsSettings,
	initialAutomation = null,
	initialTitle = "",
}: CreateAutomationDialogProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const promptTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const notes = useQuery(
		api.notes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const connectedAppSources = useAppSources(activeWorkspaceId);
	const noteSources = React.useMemo<AutomationNoteSource[]>(
		() =>
			(notes ?? []).map((note) => ({
				id: note._id,
				title: getNoteDisplayTitle(note.title),
				preview: note.searchableText.trim(),
			})),
		[notes],
	);
	const [dialogState, updateDialogState] = React.useReducer(
		automationDialogStateReducer,
		null,
		() => createAutomationDialogState(initialAutomation, initialTitle),
	);
	const {
		schedulePickerOpen,
		modelPickerOpen,
		appSourcesPickerOpen,
		notePickerOpen,
		noteSearchTerm,
		noteMentionRange,
		title,
		prompt,
		selectedModel,
		schedulePeriod,
		scheduledAt,
		target,
		webSearchEnabled,
		appsEnabled,
		selectedConnectedAppIds,
		selectedNoteIds,
	} = dialogState;
	const selectedNoteSources = React.useMemo(
		() =>
			selectedNoteIds.flatMap((sourceId) => {
				const source = noteSources.find(
					(noteSource) => noteSource.id === sourceId,
				);
				return source ? [source] : [];
			}),
		[noteSources, selectedNoteIds],
	);
	const selectedConnectedAppSources = React.useMemo<AutomationAppSource[]>(
		() =>
			selectedConnectedAppIds.flatMap((sourceId): AutomationAppSource[] => {
				const source = connectedAppSources.find(
					(appSource) => appSource.id === sourceId,
				);
				if (source) {
					return [
						{
							id: source.id,
							label: getAppSourceLabel(source.provider),
							provider: source.provider,
						},
					];
				}

				return [];
			}),
		[connectedAppSources, selectedConnectedAppIds],
	);
	React.useEffect(() => {
		updateDialogState(
			createAutomationDialogState(
				open ? initialAutomation : null,
				initialTitle,
			),
		);
	}, [initialAutomation, initialTitle, open]);

	React.useEffect(() => {
		updateDialogState((currentState) => {
			const availableAppIds = new Set(
				connectedAppSources.map((source) => source.id),
			);
			const nextIds = currentState.selectedConnectedAppIds.filter((sourceId) =>
				availableAppIds.has(sourceId),
			);

			return nextIds.length === currentState.selectedConnectedAppIds.length
				? {}
				: { selectedConnectedAppIds: nextIds };
		});
	}, [connectedAppSources]);

	React.useEffect(() => {
		updateDialogState((currentState) => {
			const availableIds = new Set(noteSources.map((source) => source.id));
			const nextIds = currentState.selectedNoteIds.filter((sourceId) =>
				availableIds.has(sourceId),
			);

			return nextIds.length === currentState.selectedNoteIds.length
				? {}
				: { selectedNoteIds: nextIds };
		});
	}, [noteSources]);

	const closeAutomationPickers = React.useCallback(() => {
		updateDialogState({
			schedulePickerOpen: false,
			modelPickerOpen: false,
			appSourcesPickerOpen: false,
			notePickerOpen: false,
		});
	}, []);

	const handleNotePickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ notePickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleAppSourcesPickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ appSourcesPickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleSchedulePickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ schedulePickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleModelPickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ modelPickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleConnectedAppToggle = React.useCallback((sourceId: string) => {
		updateDialogState((currentState) => ({
			selectedConnectedAppIds: currentState.selectedConnectedAppIds.includes(
				sourceId,
			)
				? currentState.selectedConnectedAppIds.filter(
						(currentId) => currentId !== sourceId,
					)
				: [...currentState.selectedConnectedAppIds, sourceId],
		}));
	}, []);

	const handlePromptChange = React.useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			const nextPrompt = event.target.value;
			const cursorPosition = event.target.selectionStart;
			const nextNoteMentionRange = findNoteMentionRange(
				nextPrompt,
				cursorPosition,
			);

			updateDialogState({
				prompt: nextPrompt,
				noteMentionRange: nextNoteMentionRange,
			});

			if (nextNoteMentionRange) {
				updateDialogState({ noteSearchTerm: nextNoteMentionRange.query });
				handleNotePickerOpenChange(true);
			}
		},
		[handleNotePickerOpenChange],
	);

	const handleNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => {
			updateDialogState((currentState) => {
				const range = noteMentionRange;
				const nextNoteIds = currentState.selectedNoteIds.includes(noteId)
					? currentState.selectedNoteIds
					: [...currentState.selectedNoteIds, noteId];
				if (!range) {
					return {
						target: null,
						selectedNoteIds: nextNoteIds,
						noteMentionRange: null,
						noteSearchTerm: "",
					};
				}

				const nextPrompt = `${currentState.prompt.slice(0, range.start)}${currentState.prompt.slice(range.end)}`;
				queueMicrotask(() => {
					const textarea = promptTextareaRef.current;
					if (!textarea) {
						return;
					}

					textarea.focus();
					textarea.setSelectionRange(range.start, range.start);
				});
				return {
					target: null,
					selectedNoteIds: nextNoteIds,
					prompt: nextPrompt,
					noteMentionRange: null,
					noteSearchTerm: "",
				};
			});
		},
		[noteMentionRange],
	);

	const handleNoteRemove = React.useCallback((noteId: Id<"notes">) => {
		updateDialogState((currentState) => ({
			selectedNoteIds: currentState.selectedNoteIds.filter(
				(currentId) => currentId !== noteId,
			),
		}));
	}, []);

	const handleTimeChange = React.useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const nextValue = event.target.value;
			if (!nextValue) {
				return;
			}

			const [hoursString, minutesString] = nextValue.split(":");
			const hours = Number(hoursString);
			const minutes = Number(minutesString);

			if (Number.isNaN(hours) || Number.isNaN(minutes)) {
				return;
			}

			updateDialogState((currentState) => {
				const nextDate = new Date(currentState.scheduledAt);
				nextDate.setHours(hours, minutes, 0, 0);
				return { scheduledAt: nextDate };
			});
		},
		[],
	);

	const handleCreate = React.useCallback(async () => {
		const trimmedPrompt = prompt.trim();
		const effectiveTarget =
			selectedNoteIds.length > 0
				? ({
						kind: "notes",
						label:
							selectedNoteSources.length === 1
								? selectedNoteSources[0]?.title
								: `${selectedNoteIds.length} notes`,
						noteIds: selectedNoteIds,
					} satisfies AutomationTarget)
				: target;
		if (!trimmedPrompt || !effectiveTarget) {
			return;
		}

		const trimmedTitle = title.trim();

		await onCreateAutomation({
			title: trimmedTitle || trimmedPrompt,
			prompt: trimmedPrompt,
			model: selectedModel.model,
			webSearchEnabled,
			appsEnabled,
			appSources: selectedConnectedAppSources,
			schedulePeriod,
			scheduledAt: scheduledAt.getTime(),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
			target: effectiveTarget,
		});
	}, [
		onCreateAutomation,
		prompt,
		schedulePeriod,
		scheduledAt,
		selectedConnectedAppSources,
		selectedModel.model,
		selectedNoteIds,
		selectedNoteSources,
		target,
		title,
		webSearchEnabled,
		appsEnabled,
	]);

	const scheduleLabel = getAutomationSchedulePeriodLabel({
		schedulePeriod,
		scheduledAt: scheduledAt.getTime(),
	});
	const canCreateAutomation =
		prompt.trim().length > 0 && (!!target || selectedNoteIds.length > 0);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{initialAutomation ? "Edit automation" : "New automation"}
					</DialogTitle>
					<DialogDescription>
						Create a prompt that runs automatically on your schedule.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<Field>
						<FieldLabel
							htmlFor="automation-title"
							className="text-xs text-muted-foreground"
						>
							Title
						</FieldLabel>
						<Input
							id="automation-title"
							value={title}
							onChange={(event) =>
								updateDialogState({ title: event.target.value })
							}
							placeholder="Meeting notes recap"
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor="automation-prompt"
							className="text-xs text-muted-foreground"
						>
							Prompt
						</FieldLabel>
						<InputGroup className="min-h-40 items-stretch rounded-xl bg-background">
							<InputGroupAddon align="block-start" className="px-2.5 pt-2">
								<NotePicker
									open={notePickerOpen}
									onOpenChange={handleNotePickerOpenChange}
									sources={noteSources}
									searchTerm={noteSearchTerm}
									onSearchTermChange={(value) =>
										updateDialogState({ noteSearchTerm: value })
									}
									selectedSourceIds={selectedNoteIds}
									isLoading={notes === undefined}
									onSelectSource={handleNoteSelect}
								/>
								{selectedNoteSources.length > 0 ? (
									<NoteChips
										sources={selectedNoteSources}
										onRemoveSource={handleNoteRemove}
									/>
								) : null}
							</InputGroupAddon>
							<InputGroupTextarea
								ref={promptTextareaRef}
								id="automation-prompt"
								value={prompt}
								onChange={handlePromptChange}
								placeholder="Summarize meeting notes and list follow-ups"
								className="min-h-28 px-4 py-3 text-sm"
							/>
							<InputGroupAddon
								align="block-end"
								className="flex-wrap justify-start gap-1 px-2.5 py-2"
							>
								<SchedulePicker
									open={schedulePickerOpen}
									onOpenChange={handleSchedulePickerOpenChange}
									scheduleLabel={scheduleLabel}
									schedulePeriod={schedulePeriod}
									scheduledAt={scheduledAt}
									onSchedulePeriodChange={(value) =>
										updateDialogState({ schedulePeriod: value })
									}
									onTimeChange={handleTimeChange}
								/>
								<AppSourcesPicker
									open={appSourcesPickerOpen}
									onOpenChange={handleAppSourcesPickerOpenChange}
									sources={connectedAppSources}
									selectedSourceIds={selectedConnectedAppIds}
									webSearchEnabled={webSearchEnabled}
									onWebSearchEnabledChange={(value) =>
										updateDialogState({ webSearchEnabled: value })
									}
									appsEnabled={appsEnabled}
									onAppsEnabledChange={(value) =>
										updateDialogState({ appsEnabled: value })
									}
									onToggleSource={handleConnectedAppToggle}
									onOpenConnectionsSettings={onOpenConnectionsSettings}
								/>
								<div className="ml-auto flex min-w-0 items-center gap-1">
									<ChatModelPicker
										open={modelPickerOpen}
										onOpenChange={handleModelPickerOpenChange}
										selectedModel={selectedModel}
										onSelectedModelChange={(value) =>
											updateDialogState({ selectedModel: value })
										}
										triggerClassName="text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
										triggerIconClassName="text-current"
										modelNameClassName="max-w-[120px] truncate"
										contentClassName="w-72"
										menuLabel="Model"
									/>
								</div>
							</InputGroupAddon>
						</InputGroup>
					</Field>
				</FieldGroup>
				<div className="flex justify-end gap-2 pt-6 pb-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={!canCreateAutomation}
						onClick={() => void handleCreate()}
					>
						{initialAutomation ? "Save" : "Create"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function CreateAutomationDialog(props: CreateAutomationDialogProps) {
	return useCreateAutomationDialogElement(props);
}

function AppSourcesPicker({
	open,
	onOpenChange,
	sources,
	selectedSourceIds,
	webSearchEnabled,
	onWebSearchEnabledChange,
	appsEnabled,
	onAppsEnabledChange,
	onToggleSource,
	onOpenConnectionsSettings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sources: AppSource[];
	selectedSourceIds: string[];
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	appsEnabled: boolean;
	onAppsEnabledChange: (value: boolean) => void;
	onToggleSource: (sourceId: string) => void;
	onOpenConnectionsSettings: () => void;
}) {
	const keepPickerOpen = React.useCallback((event: Event) => {
		event.preventDefault();
	}, []);
	const selectedSource =
		selectedSourceIds.length === 1
			? sources.find((source) => source.id === selectedSourceIds[0])
			: null;
	const label =
		selectedSourceIds.length === 1 && selectedSource
			? getAppSourceLabel(selectedSource.provider)
			: selectedSourceIds.length > 1
				? `${selectedSourceIds.length} sources`
				: "All sources";

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<InputGroupButton
							type="button"
							variant="ghost"
							size="icon-sm"
							className="group/automation-picker rounded-full text-muted-foreground"
							aria-label={`Select scope: ${label}`}
						>
							<Settings2 className="size-4 shrink-0 text-muted-foreground group-hover/automation-picker:text-foreground group-focus-visible/automation-picker:text-foreground group-data-[state=open]/automation-picker:text-foreground" />
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Select scope</TooltipContent>
			</Tooltip>
			<DropdownMenuContent side="bottom" align="start" className="w-64">
				<DropdownMenuGroup>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="automation-web-search">
							<Globe className="text-foreground" /> Web search
							<Switch
								id="automation-web-search"
								className="ml-auto"
								checked={webSearchEnabled}
								onCheckedChange={onWebSearchEnabledChange}
							/>
						</label>
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="automation-apps">
							<LayoutGrid aria-hidden="true" className="text-foreground" />
							<span aria-hidden="true">Tools and integrations</span>
							<span className="sr-only">Apps and integrations</span>
							<Switch
								id="automation-apps"
								className="ml-auto"
								checked={appsEnabled}
								onCheckedChange={onAppsEnabledChange}
							/>
						</label>
					</DropdownMenuItem>
					<DropdownMenuCheckboxItem
						checked={selectedSourceIds.length === 0}
						className="pl-2 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
						onSelect={keepPickerOpen}
						onCheckedChange={(checked) => {
							if (!checked) {
								return;
							}

							for (const sourceId of selectedSourceIds) {
								onToggleSource(sourceId);
							}
						}}
					>
						<CirclePlus /> All sources I can access
					</DropdownMenuCheckboxItem>
					{sources.length > 0 ? (
						sources.map((source, index) => {
							const selected = selectedSourceIds.includes(source.id);
							const sourceKey = source.id
								? `${source.provider}:${source.id}`
								: `app-source-${index}`;

							return (
								<DropdownMenuCheckboxItem
									key={sourceKey}
									checked={selected}
									className="pl-2 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
									onSelect={keepPickerOpen}
									onCheckedChange={() => onToggleSource(source.id)}
								>
									<ConnectedAppIcon provider={source.provider} />
									<div className="min-w-0 truncate">
										{getAppSourceLabel(source.provider)}
									</div>
								</DropdownMenuCheckboxItem>
							);
						})
					) : (
						<DropdownMenuItem disabled>No connected apps</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						aria-label="Connect apps"
						onClick={onOpenConnectionsSettings}
					>
						<Plus aria-hidden="true" />
						<span aria-hidden="true">Connect tools</span>
						<span className="sr-only">Connect apps</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NotePicker({
	open,
	onOpenChange,
	sources,
	searchTerm = "",
	onSearchTermChange,
	selectedSourceIds,
	isLoading,
	onSelectSource,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sources: AutomationNoteSource[];
	searchTerm?: string;
	onSearchTermChange: (value: string) => void;
	selectedSourceIds: string[];
	isLoading: boolean;
	onSelectSource: (sourceId: Id<"notes">) => void;
}) {
	const filteredSources = React.useMemo(() => {
		const query = searchTerm.trim().toLowerCase();

		if (!query) {
			return sources;
		}

		return sources.filter((source) =>
			[source.title, source.preview].join(" ").toLowerCase().includes(query),
		);
	}, [searchTerm, sources]);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<InputGroupButton
							variant="ghost"
							size="icon-sm"
							className="rounded-full bg-transparent text-muted-foreground transition-transform hover:bg-muted hover:text-foreground"
						>
							<AtSign />
							<span className="sr-only">Mention a note</span>
						</InputGroupButton>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Mention a note</TooltipContent>
			</Tooltip>
			<PopoverContent
				className="w-72 p-0 [&_[data-slot=scroll-area]]:w-full [&_[data-slot=scroll-area-viewport]]:w-full [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:w-full [&_[data-slot=scroll-area-viewport]>div]:min-w-0 [&_[data-slot=command-list]]:w-full [&_[data-slot=command-list]]:min-w-0"
				align="start"
			>
				<Command>
					<CommandInput
						placeholder="Search notes..."
						value={searchTerm}
						onValueChange={onSearchTermChange}
					/>
					<CommandList>
						{isLoading ? (
							<CommandGroup heading="Notes">
								<div className="p-2 text-sm text-muted-foreground">
									Loading notes…
								</div>
							</CommandGroup>
						) : null}
						<CommandEmpty>No notes found.</CommandEmpty>
						{filteredSources.length > 0 ? (
							<CommandGroup heading={searchTerm ? "Search results" : "Notes"}>
								{filteredSources.map((source) => {
									const selected = selectedSourceIds.includes(source.id);

									return (
										<CommandItem
											key={source.id}
											value={`${source.id} ${source.title}`}
											onSelect={() => {
												onSelectSource(source.id);
												onOpenChange(false);
											}}
											data-checked={selected}
											className="w-full cursor-pointer gap-1.5 overflow-hidden rounded-md px-1.5"
										>
											<div className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
												<FileText className="size-4" />
											</div>
											<div
												className="min-w-0 flex-1 truncate"
												title={source.title}
											>
												{source.title}
											</div>
										</CommandItem>
									);
								})}
							</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function NoteChips({
	sources,
	onRemoveSource,
}: {
	sources: AutomationNoteSource[];
	onRemoveSource: (sourceId: Id<"notes">) => void;
}) {
	return (
		<div className="no-scrollbar -m-1.5 flex gap-1 overflow-y-auto p-1.5">
			{sources.map((source) => (
				<InputGroupButton
					key={source.id}
					size="sm"
					variant="secondary"
					className="group/note-mention-chip max-w-48 rounded-full pl-2!"
					onClick={() => onRemoveSource(source.id)}
				>
					<FileText />
					<span className="min-w-0 truncate">{source.title}</span>
					<X className="opacity-0 transition-opacity group-hover/note-mention-chip:opacity-100 group-focus-visible/note-mention-chip:opacity-100" />
				</InputGroupButton>
			))}
		</div>
	);
}

function ConnectedAppIcon({ provider }: { provider: ChatAppSourceProvider }) {
	if (provider === "google-calendar") {
		return <Icons.googleCalendarLogo className="size-4" />;
	}

	if (provider === "google-drive") {
		return <Icons.googleDriveLogo className="size-4" />;
	}

	if (provider === "yandex-calendar") {
		return <Icons.yandexCalendarLogo className="size-4" />;
	}

	if (provider === "yandex-tracker") {
		return <Icons.yandexTrackerLogo className="size-4 text-blue-500" />;
	}

	if (provider === "jira") {
		return <Icons.jiraLogo className="size-4" />;
	}

	if (provider === "notion") {
		return <Icons.notionLogo className="size-4" />;
	}

	if (provider === "posthog") {
		return <Icons.planeLogo className="size-4" />;
	}

	return <LayoutGrid className="size-4" />;
}

function SchedulePicker({
	open,
	onOpenChange,
	scheduleLabel,
	schedulePeriod,
	scheduledAt,
	onSchedulePeriodChange,
	onTimeChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	scheduleLabel: string;
	schedulePeriod: AutomationSchedulePeriod;
	scheduledAt: Date;
	onSchedulePeriodChange: (value: AutomationSchedulePeriod) => void;
	onTimeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<InputGroupButton
							type="button"
							variant="ghost"
							size="sm"
							className={cn(AUTOMATION_PICKER_TRIGGER_CLASS_NAME)}
						>
							<span className="flex items-center gap-2">
								<Clock className="size-4 shrink-0 text-muted-foreground group-hover/automation-picker:text-foreground group-focus-visible/automation-picker:text-foreground group-data-[state=open]/automation-picker:text-foreground" />
								<span>{scheduleLabel}</span>
							</span>
						</InputGroupButton>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Edit schedule</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="start"
				sideOffset={6}
				className="w-64 gap-0 p-1.5"
				onFocusOutside={(event) => event.preventDefault()}
				onInteractOutside={(event) => {
					const target = event.target;
					if (
						target instanceof HTMLElement &&
						target.closest("[data-slot='select-content']")
					) {
						event.preventDefault();
					}
				}}
			>
				<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
					Schedule
				</div>
				<div className="space-y-1">
					<Select
						value={schedulePeriod}
						onValueChange={(value) =>
							onSchedulePeriodChange(value as AutomationSchedulePeriod)
						}
					>
						<SelectTrigger
							size="sm"
							className="w-full border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{AUTOMATION_SCHEDULE_PERIODS.map((period) => (
									<SelectItem key={period.value} value={period.value}>
										{period.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<Input
						id="automation-schedule-time"
						type="time"
						value={formatTimeInputValue(scheduledAt)}
						onChange={onTimeChange}
						className="appearance-none border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
