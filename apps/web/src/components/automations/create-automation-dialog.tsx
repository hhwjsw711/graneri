"use client";

import type { Editor, JSONContent, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Tiptap, useEditor } from "@tiptap/react";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
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
	Clock,
	FileText,
	Globe,
	LoaderCircle,
	Plus,
	Settings2,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { AppSourceIcon } from "@/components/app-source-icon";
import {
	AUTOMATION_SCHEDULE_PERIODS,
	type AutomationAppSource,
	type AutomationDraft,
	type AutomationSchedulePeriod,
	type AutomationTarget,
} from "@/components/automations/automation-types";
import { getAutomationSchedulePeriodLabel } from "@/components/automations/automation-utils";
import {
	ChatModelPicker,
	type ReasoningEffort,
} from "@/components/chat/model-picker";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { type AppSource, useAppSources } from "@/hooks/use-app-sources";
import { getStoredChatModel, storeChatModel } from "@/lib/ai/chat-model";
import { defaultChatModel, findChatModel } from "@/lib/ai/models";
import {
	getStoredReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import {
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { createPlainTextEditorExtensions } from "@/lib/plain-text-editor";
import {
	getMentionAnchorRect,
	getMentionPickerPosition,
	getMentionProvider,
	INLINE_MENTION_CLASS,
	type MentionPickerPosition,
	renderInlineMentionHTML,
	TypedMention,
} from "@/lib/tiptap-mention";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const AUTOMATION_PICKER_TRIGGER_CLASS_NAME =
	"group/automation-picker min-w-0 max-w-[180px] justify-start overflow-hidden rounded-full font-normal text-muted-foreground";

export type CreateAutomationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateAutomation: (automation: AutomationDraft) => void | Promise<void>;
	onDisableAutomation?: () => void | Promise<void>;
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
	from: number;
	to: number;
};

type AutomationPromptMention = {
	id: string;
	label: string;
	from: number;
	to: number;
	type: "note" | "tool";
	provider?: ChatAppSourceProvider;
};

type AutomationMentionPickerItem =
	| {
			type: "tool";
			source: AppSource;
	  }
	| {
			type: "note";
			source: AutomationNoteSource;
	  };

const filterAutomationNotes = (
	sources: AutomationNoteSource[],
	query: string,
): AutomationNoteSource[] => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	return sources.filter((source) =>
		[source.title, source.preview]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

const filterAutomationTools = (sources: AppSource[], query: string) => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return sources;
	}

	return sources.filter((source) =>
		[source.title, source.preview, getAppSourceLabel(source.provider)]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

const getPromptMentionsFromContent = (
	content: JSONContent,
): AutomationPromptMention[] => {
	const mentions: AutomationPromptMention[] = [];
	let textOffset = 0;
	const walk = (node: JSONContent) => {
		if (node.type === "mention" && typeof node.attrs?.id === "string") {
			const mentionId = node.attrs.id;
			const label =
				typeof node.attrs.label === "string" ? node.attrs.label : mentionId;
			const text = `@${label}`;
			mentions.push({
				id: mentionId,
				label,
				from: textOffset,
				to: textOffset + text.length,
				type:
					node.attrs.type === "tool" || mentionId.startsWith("app:")
						? "tool"
						: "note",
				provider:
					typeof node.attrs.provider === "string"
						? (node.attrs.provider as ChatAppSourceProvider)
						: undefined,
			});
			textOffset += text.length;
			return;
		}

		if (typeof node.text === "string") {
			textOffset += node.text.length;
			return;
		}

		for (const child of node.content ?? []) {
			walk(child);
		}
	};

	walk(content);
	return mentions;
};

const getPromptDocument = (
	prompt: string,
	mentions: AutomationPromptMention[] = [],
): JSONContent => {
	if (!prompt) {
		return {
			type: "doc",
			content: [{ type: "paragraph" }],
		};
	}

	const sortedMentions = [...mentions]
		.filter(
			(mention) =>
				mention.from >= 0 &&
				mention.to > mention.from &&
				mention.to <= prompt.length &&
				prompt.slice(mention.from, mention.to) === `@${mention.label}`,
		)
		.sort((a, b) => a.from - b.from);
	const content: JSONContent[] = [];
	let cursor = 0;

	for (const mention of sortedMentions) {
		if (mention.from < cursor) {
			continue;
		}

		if (mention.from > cursor) {
			content.push({ type: "text", text: prompt.slice(cursor, mention.from) });
		}

		content.push({
			type: "mention",
			attrs: {
				id: mention.id,
				label: mention.label,
				type: mention.type,
				provider: mention.provider,
			},
		});
		cursor = mention.to;
	}

	if (cursor < prompt.length) {
		content.push({ type: "text", text: prompt.slice(cursor) });
	}

	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content:
					content.length > 0 ? content : [{ type: "text", text: prompt }],
			},
		],
	};
};

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findMentionRange = ({
	label,
	occupiedRanges,
	prompt,
}: {
	label: string;
	occupiedRanges: Array<Pick<AutomationPromptMention, "from" | "to">>;
	prompt: string;
}) => {
	const mentionText = `@${label}`;
	const mentionRegex = new RegExp(escapeRegExp(mentionText), "g");

	for (const match of prompt.matchAll(mentionRegex)) {
		const index = match.index;
		const end = index + mentionText.length;
		const overlaps = occupiedRanges.some(
			(range) => index < range.to && end > range.from,
		);
		if (!overlaps) {
			return {
				from: index,
				to: end,
			};
		}
	}

	return null;
};

const getInitialAutomationMentions = ({
	automation,
}: {
	automation: AutomationDraft;
}) => {
	const mentions: AutomationPromptMention[] = [];

	for (const source of automation.appSources ?? []) {
		const label = getAppSourceLabel(source.provider);
		const range = findMentionRange({
			label,
			occupiedRanges: mentions,
			prompt: automation.prompt,
		});

		if (!range) {
			continue;
		}

		mentions.push({
			id: source.id,
			label,
			type: "tool",
			provider: source.provider,
			...range,
		});
	}

	if (automation.target.kind === "notes") {
		for (const noteId of automation.target.noteIds) {
			const label = automation.target.label;
			const range = findMentionRange({
				label,
				occupiedRanges: mentions,
				prompt: automation.prompt,
			});

			if (!range) {
				continue;
			}

			mentions.push({
				id: noteId,
				label,
				type: "note",
				...range,
			});
		}
	}

	return mentions.sort((a, b) => a.from - b.from);
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
	title: string;
	prompt: string;
	promptMentions: AutomationPromptMention[];
	selectedModel: typeof defaultChatModel;
	reasoningEffort: ReasoningEffort;
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
	title: "",
	prompt: "",
	promptMentions: [],
	selectedModel: getStoredChatModel(),
	reasoningEffort: getStoredReasoningEffort(),
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

	const promptMentions = getInitialAutomationMentions({
		automation: initialAutomation,
	});

	return {
		...emptyState,
		title: initialAutomation.title,
		prompt: initialAutomation.prompt,
		promptMentions,
		selectedModel: findChatModel(initialAutomation.model) ?? defaultChatModel,
		reasoningEffort: initialAutomation.reasoningEffort,
		schedulePeriod: initialAutomation.schedulePeriod,
		scheduledAt: new Date(initialAutomation.scheduledAt),
		webSearchEnabled: initialAutomation.webSearchEnabled,
		appsEnabled: initialAutomation.appsEnabled,
		target:
			initialAutomation.target.kind === "workspace"
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
	onDisableAutomation,
	onOpenConnectionsSettings,
	initialAutomation = null,
	initialTitle = "",
}: CreateAutomationDialogProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
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
	const [isDisabling, setIsDisabling] = React.useState(false);
	const {
		schedulePickerOpen,
		modelPickerOpen,
		appSourcesPickerOpen,
		title,
		prompt,
		promptMentions,
		selectedModel,
		reasoningEffort,
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
		});
	}, []);

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

	const handlePromptChange = React.useCallback(
		(value: string, mentions: AutomationPromptMention[]) => {
			const nextNoteIds = mentions.flatMap((mention) =>
				mention.type === "note" ? [mention.id as Id<"notes">] : [],
			);
			const nextToolIds = mentions.flatMap((mention) =>
				mention.type === "tool" ? [mention.id] : [],
			);

			updateDialogState({
				prompt: value,
				promptMentions: mentions,
				target: nextNoteIds.length > 0 ? null : target,
				selectedNoteIds: Array.from(new Set(nextNoteIds)),
				selectedConnectedAppIds: Array.from(new Set(nextToolIds)),
			});
		},
		[target],
	);

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
		const trimmedTitle = title.trim();
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
				: (target ??
					({
						kind: "workspace",
						label: "Workspace",
					} satisfies AutomationTarget));
		if (!trimmedPrompt || !effectiveTarget) {
			return;
		}
		if (!trimmedTitle) {
			return;
		}

		await onCreateAutomation({
			title: trimmedTitle,
			prompt: trimmedPrompt,
			model: selectedModel.model,
			reasoningEffort,
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
		reasoningEffort,
		selectedNoteIds,
		selectedNoteSources,
		target,
		title,
		webSearchEnabled,
		appsEnabled,
	]);

	const handleDisable = React.useCallback(async () => {
		if (!onDisableAutomation) {
			return;
		}

		setIsDisabling(true);
		try {
			await onDisableAutomation();
		} finally {
			setIsDisabling(false);
		}
	}, [onDisableAutomation]);

	const scheduleLabel = getAutomationSchedulePeriodLabel({
		schedulePeriod,
		scheduledAt: scheduledAt.getTime(),
	});
	const canCreateAutomation =
		title.trim().length > 0 && prompt.trim().length > 0;

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
							placeholder="Add title"
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
							<AutomationPromptEditor
								id="automation-prompt"
								prompt={prompt}
								mentions={promptMentions}
								noteSources={noteSources}
								appSources={connectedAppSources}
								isNotesLoading={notes === undefined}
								onMentionPickerOpen={closeAutomationPickers}
								onPromptChange={handlePromptChange}
								placeholder="Add prompt. @ to use tools or mention notes"
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
									webSearchEnabled={webSearchEnabled}
									onWebSearchEnabledChange={(value) =>
										updateDialogState({ webSearchEnabled: value })
									}
									onOpenConnectionsSettings={onOpenConnectionsSettings}
								/>
								<div className="ml-auto flex min-w-0 items-center gap-1">
									<ChatModelPicker
										open={modelPickerOpen}
										onOpenChange={handleModelPickerOpenChange}
										selectedModel={selectedModel}
										onSelectedModelChange={(value) => {
											storeChatModel(value);
											updateDialogState({ selectedModel: value });
										}}
										reasoningEffort={reasoningEffort}
										onReasoningEffortChange={(value) => {
											storeReasoningEffort(value);
											updateDialogState({ reasoningEffort: value });
										}}
										triggerClassName="text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
										triggerIconClassName="text-current"
										modelNameClassName="max-w-[120px] truncate"
										menuLabel="Model"
									/>
								</div>
							</InputGroupAddon>
						</InputGroup>
					</Field>
				</FieldGroup>
				<div className="flex items-center justify-between gap-2 pt-6 pb-2">
					{initialAutomation && onDisableAutomation ? (
						<Button
							type="button"
							variant="destructive"
							onClick={() => void handleDisable()}
							disabled={isDisabling}
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
							disabled={isDisabling}
						>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={!canCreateAutomation || isDisabling}
							onClick={() => void handleCreate()}
						>
							{initialAutomation ? "Save" : "Create"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function CreateAutomationDialog(props: CreateAutomationDialogProps) {
	return useCreateAutomationDialogElement(props);
}

// oxlint-disable-next-line react-doctor/no-giant-component -- Tiptap editor shell keeps lifecycle refs and suggestion state together.
function AutomationPromptEditor({
	id,
	prompt,
	mentions,
	noteSources,
	appSources,
	isNotesLoading,
	onMentionPickerOpen,
	onPromptChange,
	placeholder,
}: {
	id: string;
	prompt: string;
	mentions: AutomationPromptMention[];
	noteSources: AutomationNoteSource[];
	appSources: AppSource[];
	isNotesLoading: boolean;
	onMentionPickerOpen: () => void;
	onPromptChange: (value: string, mentions: AutomationPromptMention[]) => void;
	placeholder: string;
}) {
	const editorRef = React.useRef<Editor | null>(null);
	const mentionRangeRef = React.useRef<NoteMentionRange | null>(null);
	const mentionTriggerRectRef = React.useRef<Pick<
		DOMRect,
		"bottom" | "left" | "top"
	> | null>(null);
	const allNoteSourcesRef = React.useRef(noteSources);
	const allAppSourcesRef = React.useRef(appSources);
	const visibleNoteSourcesRef = React.useRef<AutomationNoteSource[]>([]);
	const visibleItemsRef = React.useRef<AutomationMentionPickerItem[]>([]);
	const selectedIndexRef = React.useRef(0);
	const popoverOpenRef = React.useRef(false);
	const [popoverOpen, setPopoverOpen] = React.useState(false);
	const [searchTerm, setSearchTerm] = React.useState("");
	const [selectedIndex, setSelectedIndex] = React.useState(0);
	const [position, setPosition] = React.useState<MentionPickerPosition | null>(
		null,
	);
	const visibleNoteSources = React.useMemo(
		() => filterAutomationNotes(noteSources, searchTerm),
		[noteSources, searchTerm],
	);
	const visibleToolSources = React.useMemo(
		() => filterAutomationTools(appSources, searchTerm),
		[appSources, searchTerm],
	);
	const shouldSearchNotes = searchTerm.trim().length > 0;
	const visibleItems = React.useMemo<AutomationMentionPickerItem[]>(
		() => [
			...visibleToolSources.map<AutomationMentionPickerItem>((source) => ({
				type: "tool",
				source,
			})),
			...visibleNoteSources.map<AutomationMentionPickerItem>((source) => ({
				type: "note",
				source,
			})),
		],
		[visibleNoteSources, visibleToolSources],
	);

	allNoteSourcesRef.current = noteSources;
	allAppSourcesRef.current = appSources;
	visibleNoteSourcesRef.current = visibleNoteSources;
	visibleItemsRef.current = visibleItems;
	selectedIndexRef.current = selectedIndex;
	popoverOpenRef.current = popoverOpen;

	const selectIndex = React.useCallback((index: number) => {
		selectedIndexRef.current = index;
		setSelectedIndex(index);
	}, []);
	const closePicker = React.useCallback(() => {
		mentionRangeRef.current = null;
		mentionTriggerRectRef.current = null;
		popoverOpenRef.current = false;
		setPopoverOpen(false);
		setSearchTerm("");
		setPosition(null);
	}, []);
	const insertMention = React.useCallback(
		(item: AutomationMentionPickerItem) => {
			const editor = editorRef.current;
			const range = mentionRangeRef.current;
			if (!editor || !range) {
				return;
			}

			const mention =
				item.type === "tool"
					? {
							id: item.source.id,
							label: getAppSourceLabel(item.source.provider),
							type: "tool" as const,
							provider: item.source.provider,
						}
					: {
							id: item.source.id,
							label: item.source.title,
							type: "note" as const,
						};
			editor
				.chain()
				.focus()
				.insertContentAt(range, [
					{
						type: "mention",
						attrs: mention,
					},
					{ type: "text", text: " " },
				])
				.run();
			closePicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closePicker],
	);
	const handleKeyDown = React.useCallback(
		(event: KeyboardEvent) =>
			handleAutomationMentionPickerKeyDown({
				event,
				itemsRef: visibleItemsRef,
				selectedIndexRef,
				selectIndex,
				onSelectItem: insertMention,
			}),
		[insertMention, selectIndex],
	);
	React.useEffect(() => {
		if (!popoverOpen) {
			return;
		}

		const rect = mentionTriggerRectRef.current;
		if (!rect) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		setPosition(
			getMentionPickerPosition({
				rect,
				itemCount: visibleItems.length,
				minSectionedHeight: true,
			}),
		);
	}, [popoverOpen, visibleItems.length]);

	const editor = useEditor({
		extensions: [
			...createPlainTextEditorExtensions(),
			TypedMention.configure({
				HTMLAttributes: {
					class: INLINE_MENTION_CLASS,
				},
				renderText({ node }) {
					return `@${node.attrs.label ?? node.attrs.id}`;
				},
				renderHTML({ node }) {
					const id = String(node.attrs.id);
					const label = String(node.attrs.label ?? node.attrs.id);
					return renderInlineMentionHTML({
						id,
						label,
						provider: getMentionProvider(node.attrs.provider) ?? undefined,
						type: node.attrs.type === "tool" ? "tool" : "note",
					});
				},
				suggestion: {
					char: "@",
					allowedPrefixes: [" ", "\n"],
					command: ({ editor, range, props }) => {
						editor
							.chain()
							.focus()
							.insertContentAt(range, [
								{
									type: "mention",
									attrs: {
										id: props.id,
										label: props.label,
									},
								},
								{ type: "text", text: " " },
							])
							.run();
					},
					items: () => [],
					render: () => {
						const updatePicker = ({
							editor,
							range,
							query,
						}: {
							editor: Editor;
							range: Range;
							query: string;
						}) => {
							const nextNotes = filterAutomationNotes(
								allNoteSourcesRef.current,
								query,
							);
							const nextTools = filterAutomationTools(
								allAppSourcesRef.current,
								query,
							);
							const nextItems = [
								...nextTools.map<AutomationMentionPickerItem>((source) => ({
									type: "tool",
									source,
								})),
								...nextNotes.map<AutomationMentionPickerItem>((source) => ({
									type: "note",
									source,
								})),
							];
							mentionRangeRef.current = range;
							visibleNoteSourcesRef.current = nextNotes;
							visibleItemsRef.current = nextItems;
							setSearchTerm(query);
							selectIndex(0);
							requestAnimationFrame(() => {
								const rect = getMentionAnchorRect(editor, range);
								mentionTriggerRectRef.current = rect;
								setPosition(
									getMentionPickerPosition({
										rect,
										itemCount: nextItems.length,
										minSectionedHeight: true,
									}),
								);
							});
							onMentionPickerOpen();
							popoverOpenRef.current = true;
							setPopoverOpen(true);
						};

						return {
							onStart: updatePicker,
							onUpdate: updatePicker,
							onKeyDown: ({ event }) => handleKeyDown(event),
							onExit: closePicker,
						};
					},
				},
			}),
			Placeholder.configure({ placeholder }),
		],
		content: getPromptDocument(prompt, mentions),
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		onCreate: ({ editor }) => {
			editorRef.current = editor;
		},
		onDestroy: () => {
			editorRef.current = null;
		},
		editorProps: {
			attributes: {
				id,
				class:
					"chat-composer-tiptap min-h-28 w-full flex-1 overflow-y-auto bg-transparent pt-3 pr-3 pb-0 pl-3.5 text-left text-[14px] leading-[1.6] font-normal outline-none",
				"data-slot": "input-group-control",
			},
			handleKeyDown: (_view, event) => {
				if (popoverOpenRef.current) {
					return handleKeyDown(event);
				}
				return false;
			},
		},
		onUpdate: ({ editor }) => {
			onPromptChange(
				editor.getText({ blockSeparator: "\n" }),
				getPromptMentionsFromContent(editor.getJSON()),
			);
		},
	});

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
		const currentText = editor.getText({ blockSeparator: "\n" });
		if (
			currentText === prompt &&
			// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
			getPromptMentionsFromContent(editor.getJSON()).length === mentions.length
		) {
			return;
		}

		if (editor.isFocused) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		editor.commands.setContent(getPromptDocument(prompt, mentions), {
			emitUpdate: false,
		});
	}, [editor, prompt, mentions]);

	return (
		<>
			<div className="flex w-full flex-1 cursor-text">
				{editor ? (
					<Tiptap editor={editor}>
						<Tiptap.Content />
					</Tiptap>
				) : null}
			</div>
			<AutomationMentionPicker
				open={popoverOpen}
				position={position}
				appSources={visibleToolSources}
				noteSources={visibleNoteSources}
				items={visibleItems}
				selectedIndex={selectedIndex}
				onSelectedIndexChange={selectIndex}
				isNotesLoading={isNotesLoading}
				shouldSearchNotes={shouldSearchNotes}
				onSelectItem={insertMention}
			/>
		</>
	);
}

function handleAutomationMentionPickerKeyDown({
	event,
	itemsRef,
	selectedIndexRef,
	selectIndex,
	onSelectItem,
}: {
	event: KeyboardEvent;
	itemsRef: React.RefObject<AutomationMentionPickerItem[]>;
	selectedIndexRef: React.RefObject<number>;
	selectIndex: (index: number) => void;
	onSelectItem: (item: AutomationMentionPickerItem) => void;
}) {
	if (
		event.key !== "ArrowDown" &&
		event.key !== "ArrowUp" &&
		event.key !== "Enter"
	) {
		return false;
	}

	const items = itemsRef.current;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectIndex(
			items.length === 0 ? 0 : (selectedIndexRef.current + 1) % items.length,
		);
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectIndex(
			items.length === 0
				? 0
				: (selectedIndexRef.current - 1 + items.length) % items.length,
		);
		return true;
	}

	const selectedItem = items[selectedIndexRef.current] ?? items[0];
	if (!selectedItem) {
		return false;
	}

	event.preventDefault();
	onSelectItem(selectedItem);
	return true;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp
function AutomationMentionPicker({
	open,
	position,
	appSources,
	noteSources,
	items,
	selectedIndex,
	onSelectedIndexChange,
	isNotesLoading,
	shouldSearchNotes,
	onSelectItem,
}: {
	open: boolean;
	position: MentionPickerPosition | null;
	appSources: AppSource[];
	noteSources: AutomationNoteSource[];
	items: AutomationMentionPickerItem[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	isNotesLoading: boolean;
	shouldSearchNotes: boolean;
	onSelectItem: (item: AutomationMentionPickerItem) => void;
}) {
	if (!open || !position) {
		return null;
	}

	const listboxProps = {
		role: "listbox" as const,
		"aria-label": "Mention suggestions",
	};

	return createPortal(
		<div
			{...listboxProps}
			className="fixed z-[70] flex w-56 flex-col rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 pointer-events-auto"
			style={{ top: position.top, left: position.left }}
			onPointerDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<div className="max-h-72 overflow-y-auto p-1">
				{!shouldSearchNotes && appSources.length > 0 ? (
					<div>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Tools
						</div>
						<div>
							{appSources.map((source, index) => {
								const selected = index === selectedIndex;

								return (
									<button
										key={source.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(index)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectItem({ type: "tool", source });
										}}
										className={cn(
											"flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center">
											<AppSourceIcon
												provider={source.provider}
												className="size-4"
											/>
										</div>
										<div className="min-w-0 flex-1 truncate">
											{getAppSourceLabel(source.provider)}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
				{shouldSearchNotes && appSources.length > 0 ? (
					<div>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Tools
						</div>
						<div>
							{appSources.map((source, index) => {
								const selected = index === selectedIndex;

								return (
									<button
										key={source.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(index)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectItem({ type: "tool", source });
										}}
										className={cn(
											"flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center">
											<AppSourceIcon
												provider={source.provider}
												className="size-4"
											/>
										</div>
										<div className="min-w-0 flex-1 truncate">
											{getAppSourceLabel(source.provider)}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
				{!shouldSearchNotes ? (
					<div className={appSources.length > 0 ? "mt-1" : undefined}>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Notes
						</div>
						<div className="px-2 pt-0.5 pb-2 text-xs text-muted-foreground">
							Type to search for notes
						</div>
					</div>
				) : null}
				{shouldSearchNotes && isNotesLoading ? (
					<div className="px-2 py-6 text-center text-sm text-muted-foreground">
						Loading notes…
					</div>
				) : null}
				{shouldSearchNotes && !isNotesLoading && items.length === 0 ? (
					<div>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Notes
						</div>
						<div className="px-2 py-6 text-center text-sm text-muted-foreground">
							No results found.
						</div>
					</div>
				) : null}
				{shouldSearchNotes && noteSources.length > 0 ? (
					<div className={appSources.length > 0 ? "mt-1" : undefined}>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Notes
						</div>
						<div>
							{noteSources.map((source, index) => {
								const itemIndex = appSources.length + index;
								const selected = itemIndex === selectedIndex;

								return (
									<button
										key={source.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(itemIndex)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectItem({ type: "note", source });
										}}
										className={cn(
											"flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
											<FileText className="size-4" />
										</div>
										<div className="min-w-0 flex-1 truncate">
											{source.title}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
			</div>
		</div>,
		document.body,
	);
}

// react-doctor-disable-next-line react-doctor/no-multi-comp
function AppSourcesPicker({
	open,
	onOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	onOpenConnectionsSettings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	onOpenConnectionsSettings: () => void;
}) {
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
							aria-label="Select scope"
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

// react-doctor-disable-next-line react-doctor/no-multi-comp
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
