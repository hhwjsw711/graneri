import type { Editor, JSONContent, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Tiptap, useEditor } from "@tiptap/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
} from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import { Switch } from "@workspace/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import {
	ArrowUp,
	Globe,
	type LucideIcon,
	Plus,
	Settings2,
	Square,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import {
	type ChatAttachment,
	FileAttachmentButton,
	FileAttachmentChips,
	useFileAttachmentDropzone,
} from "@/components/ai-elements/file-attachment-controls";
import { hasUploadingAttachments } from "@/components/ai-elements/file-attachment-utils";
import { AppSourceIcon } from "@/components/app-source-icon";
import {
	ChatQueuedFollowUpBar,
	type QueuedFollowUpBarItem,
} from "@/components/chat/chat-queued-follow-up-bar";
import {
	type ChatModel,
	ChatModelPicker,
	type ReasoningEffort,
} from "@/components/chat/model-picker";
import {
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
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

type ContextPage = {
	id: string;
	title: string;
	icon: LucideIcon;
	preview: string;
};

type AppSource = {
	id: string;
	title: string;
	preview: string;
	provider: ChatAppSourceProvider;
};

type NoteMentionRange = {
	from: number;
	to: number;
};

type MentionPickerItem =
	| {
			type: "tool";
			source: AppSource;
	  }
	| {
			type: "note";
			document: ContextPage;
	  };

export type ChatComposerMention = {
	id: string;
	label: string;
	from: number;
	to: number;
	type?: "note" | "tool";
	provider?: ChatAppSourceProvider;
};

const getMentionsFromComposerContent = (
	content: JSONContent,
): ChatComposerMention[] => {
	const mentions: ChatComposerMention[] = [];
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

const areChatComposerMentionsEqual = (
	left: ChatComposerMention[],
	right: ChatComposerMention[],
) =>
	left.length === right.length &&
	left.every((mention, index) => {
		const otherMention = right[index];
		return (
			mention.id === otherMention?.id &&
			mention.label === otherMention.label &&
			mention.from === otherMention.from &&
			mention.to === otherMention.to &&
			mention.type === otherMention.type &&
			mention.provider === otherMention.provider
		);
	});

const getDraftDocument = (
	draft: string,
	mentions: ChatComposerMention[] = [],
): JSONContent => {
	if (!draft) {
		return {
			type: "doc",
			content: [{ type: "paragraph" }],
		};
	}

	const sortedMentions = [...mentions]
		.filter(
			(mention) =>
				Number.isInteger(mention.from) &&
				Number.isInteger(mention.to) &&
				mention.from >= 0 &&
				mention.to > mention.from &&
				mention.to <= draft.length &&
				draft.slice(mention.from, mention.to) === `@${mention.label}`,
		)
		.sort((a, b) => a.from - b.from);
	const content: JSONContent[] = [];
	let cursor = 0;

	for (const mention of sortedMentions) {
		if (mention.from < cursor) {
			continue;
		}

		if (mention.from > cursor) {
			content.push({ type: "text", text: draft.slice(cursor, mention.from) });
		}

		content.push({
			type: "mention",
			attrs: {
				id: mention.id,
				label: mention.label,
				type: mention.type ?? "note",
				provider: mention.provider,
			},
		});
		cursor = mention.to;
	}

	if (cursor < draft.length) {
		content.push({ type: "text", text: draft.slice(cursor) });
	}

	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: content.length > 0 ? content : [{ type: "text", text: draft }],
			},
		],
	};
};

const filterMentionableDocuments = (
	documents: ContextPage[],
	query: string,
): ContextPage[] => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	return documents.filter((document) =>
		[document.title, document.preview]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

const filterMentionableTools = (
	sources: AppSource[],
	query: string,
): AppSource[] => {
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

type ChatComposerProps = {
	useCompactLayout: boolean;
	draft: string;
	editingMessageId?: string | null;
	placeholder: string;
	topAccessory?: React.ReactNode;
	queuedFollowUps?: Array<QueuedFollowUpBarItem>;
	onQueuedFollowUpsReorder?: (ids: Array<string>) => void;
	onDraftChange: (value: string) => void;
	onDraftKeyDown: (event: KeyboardEvent) => void;
	onCancelEdit?: () => void;
	mentions: ChatComposerMention[];
	onSubmit: () => void | Promise<void>;
	onStop: () => void;
	attachedFiles: ChatAttachment[];
	onAttachedFilesChange: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
	canStop: boolean;
	selectedModel: ChatModel | null;
	reasoningEffort: ReasoningEffort;
	modelPopoverOpen: boolean;
	onModelPopoverOpenChange: (open: boolean) => void;
	onSelectedModelChange: (model: ChatModel) => void;
	onReasoningEffortChange: (value: ReasoningEffort) => void;
	mentionableDocuments: ContextPage[];
	isNotesLoading: boolean;
	onMentionsChange: (mentions: ChatComposerMention[]) => void;
	sourcesOpen: boolean;
	onSourcesOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	appSources: AppSource[];
	onOpenConnectionsSettings: () => void;
};

const EMPTY_QUEUED_FOLLOW_UPS: NonNullable<
	ChatComposerProps["queuedFollowUps"]
> = [];

export function ChatComposer({
	useCompactLayout,
	draft,
	editingMessageId,
	placeholder,
	topAccessory,
	queuedFollowUps = EMPTY_QUEUED_FOLLOW_UPS,
	onQueuedFollowUpsReorder,
	onDraftChange,
	onDraftKeyDown,
	onCancelEdit,
	mentions,
	onSubmit,
	onStop,
	attachedFiles,
	onAttachedFilesChange,
	canStop,
	selectedModel,
	reasoningEffort,
	modelPopoverOpen,
	onModelPopoverOpenChange,
	onSelectedModelChange,
	onReasoningEffortChange,
	mentionableDocuments,
	isNotesLoading,
	onMentionsChange,
	sourcesOpen,
	onSourcesOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	appSources,
	onOpenConnectionsSettings,
}: ChatComposerProps) {
	const handleAttachmentUploadFailed = React.useCallback(
		(id: string) => {
			onAttachedFilesChange((files) => files.filter((file) => file.id !== id));
		},
		[onAttachedFilesChange],
	);
	const handleAttachmentUploaded = React.useCallback(
		(id: string, uploadedFile: FileUIPart) => {
			onAttachedFilesChange((files) =>
				files.map((file) =>
					file.id === id
						? {
								...file,
								localUrl: undefined,
								uploadStatus: "ready",
								url: uploadedFile.url,
							}
						: file,
				),
			);
		},
		[onAttachedFilesChange],
	);
	const handleAttachmentsAdded = React.useCallback(
		(files: ChatAttachment[]) => {
			onAttachedFilesChange((currentFiles) => [...currentFiles, ...files]);
		},
		[onAttachedFilesChange],
	);
	const attachmentDropzone = useFileAttachmentDropzone({
		onFileUploadFailed: handleAttachmentUploadFailed,
		onFileUploaded: handleAttachmentUploaded,
		onFilesAdded: handleAttachmentsAdded,
	});
	const showTopAddon = attachedFiles.length > 0;
	return (
		<div
			className={`relative mx-auto w-full max-w-full min-w-0 md:max-w-xl ${useCompactLayout ? "mt-auto" : ""}`}
		>
			<label htmlFor="chat-prompt" className="sr-only">
				Prompt
			</label>
			<ChatComposerTopAccessory
				editingMessageId={editingMessageId}
				onCancelEdit={onCancelEdit}
				topAccessory={topAccessory}
			/>
			{queuedFollowUps.length > 0 ? (
				<ChatQueuedFollowUpBar
					queuedFollowUps={queuedFollowUps}
					onReorder={onQueuedFollowUpsReorder}
				/>
			) : null}
			<InputGroup
				data-drag-over={attachmentDropzone.isDragOver ? "true" : undefined}
				className={cn(
					"min-h-[132px] max-h-[32rem] max-w-full overflow-hidden border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 data-[drag-over=true]:border-ring data-[drag-over=true]:ring-3 data-[drag-over=true]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/30",
					queuedFollowUps.length > 0 ? "-mt-px rounded-lg" : "rounded-lg",
				)}
				{...attachmentDropzone.dropzoneProps}
			>
				{showTopAddon ? (
					<ChatComposerTopAddon
						useCompactLayout={useCompactLayout}
						attachedFiles={attachedFiles}
						onRemoveAttachedFile={(index) =>
							onAttachedFilesChange(
								attachedFiles.filter((_, fileIndex) => fileIndex !== index),
							)
						}
					/>
				) : null}

				<ChatComposerTextEditor
					draft={draft}
					editingMessageId={editingMessageId}
					placeholder={placeholder}
					onCancelEdit={onCancelEdit}
					onDraftChange={onDraftChange}
					onDraftKeyDown={onDraftKeyDown}
					mentions={mentions}
					mentionableDocuments={mentionableDocuments}
					isNotesLoading={isNotesLoading}
					onMentionsChange={onMentionsChange}
					appSources={appSources}
				/>

				<ChatComposerFooter
					draft={draft}
					attachedFiles={attachedFiles}
					canStop={canStop}
					onAttachmentUploadFailed={handleAttachmentUploadFailed}
					onAttachmentUploaded={handleAttachmentUploaded}
					onAttachmentsAdded={handleAttachmentsAdded}
					onSubmit={onSubmit}
					onStop={onStop}
					modelPicker={
						selectedModel ? (
							<ChatModelPicker
								open={modelPopoverOpen}
								onOpenChange={onModelPopoverOpenChange}
								selectedModel={selectedModel}
								onSelectedModelChange={onSelectedModelChange}
								reasoningEffort={reasoningEffort}
								onReasoningEffortChange={onReasoningEffortChange}
							/>
						) : null
					}
					scopePicker={
						<ScopePicker
							open={sourcesOpen}
							onOpenChange={onSourcesOpenChange}
							webSearchEnabled={webSearchEnabled}
							onWebSearchEnabledChange={onWebSearchEnabledChange}
							onOpenConnectionsSettings={onOpenConnectionsSettings}
						/>
					}
				/>
			</InputGroup>
		</div>
	);
}

// oxlint-disable-next-line react-doctor/no-giant-component -- Tiptap composer shell keeps editor lifecycle and mention picker state colocated.
function ChatComposerTextEditor({
	draft,
	editingMessageId,
	placeholder,
	onCancelEdit,
	onDraftChange,
	onDraftKeyDown,
	mentions,
	mentionableDocuments,
	isNotesLoading,
	onMentionsChange,
	appSources,
}: {
	draft: string;
	editingMessageId?: string | null;
	placeholder: string;
	onCancelEdit?: () => void;
	onDraftChange: (value: string) => void;
	onDraftKeyDown: (event: KeyboardEvent) => void;
	mentions: ChatComposerMention[];
	mentionableDocuments: ContextPage[];
	isNotesLoading: boolean;
	onMentionsChange: (mentions: ChatComposerMention[]) => void;
	appSources: AppSource[];
}) {
	const promptRef = React.useRef<HTMLDivElement | null>(null);
	const noteMentionRangeRef = React.useRef<NoteMentionRange | null>(null);
	const composerEditorRef = React.useRef<Editor | null>(null);
	const placeholderRef = React.useRef(placeholder);
	const previousPlaceholderRef = React.useRef(placeholder);
	const mentionPopoverOpenRef = React.useRef(false);
	const allMentionDocumentsRef = React.useRef(mentionableDocuments);
	const allAppSourcesRef = React.useRef(appSources);
	const visibleMentionDocumentsRef = React.useRef(mentionableDocuments);
	const visibleMentionItemsRef = React.useRef<MentionPickerItem[]>([]);
	const mentionsRef = React.useRef(mentions);
	const selectedMentionIndexRef = React.useRef(0);
	const [mentionPopoverOpen, setMentionPopoverOpen] = React.useState(false);
	const [documentSearchTerm, setDocumentSearchTerm] = React.useState("");
	const [mentionPickerPosition, setMentionPickerPosition] =
		React.useState<MentionPickerPosition | null>(null);
	const [selectedMentionIndex, setSelectedMentionIndex] = React.useState(0);
	const visibleMentionDocuments = React.useMemo(
		() => filterMentionableDocuments(mentionableDocuments, documentSearchTerm),
		[documentSearchTerm, mentionableDocuments],
	);
	const visibleMentionTools = React.useMemo(
		() => filterMentionableTools(appSources, documentSearchTerm),
		[appSources, documentSearchTerm],
	);
	const shouldSearchDocuments = documentSearchTerm.trim().length > 0;
	const visibleMentionItems = React.useMemo<MentionPickerItem[]>(
		() => [
			...visibleMentionTools.map<MentionPickerItem>((source) => ({
				type: "tool",
				source,
			})),
			...visibleMentionDocuments.map<MentionPickerItem>((document) => ({
				type: "note",
				document,
			})),
		],
		[visibleMentionDocuments, visibleMentionTools],
	);
	const emptyStateMessage = shouldSearchDocuments
		? "No results found."
		: "Type to search for notes";

	mentionPopoverOpenRef.current = mentionPopoverOpen;
	allMentionDocumentsRef.current = mentionableDocuments;
	allAppSourcesRef.current = appSources;
	visibleMentionDocumentsRef.current = visibleMentionDocuments;
	visibleMentionItemsRef.current = visibleMentionItems;
	mentionsRef.current = mentions;
	placeholderRef.current = placeholder;
	selectedMentionIndexRef.current = selectedMentionIndex;

	const selectMentionIndex = React.useCallback((index: number) => {
		selectedMentionIndexRef.current = index;
		setSelectedMentionIndex(index);
	}, []);
	const closeMentionPicker = React.useCallback(() => {
		noteMentionRangeRef.current = null;
		mentionPopoverOpenRef.current = false;
		setMentionPopoverOpen(false);
		setDocumentSearchTerm("");
		setMentionPickerPosition(null);
	}, []);
	const handleAddMention = React.useCallback(
		(pageId: string) => {
			const noteMentionRange = noteMentionRangeRef.current;
			const editor = composerEditorRef.current;
			const document = visibleMentionDocumentsRef.current.find(
				(page) => page.id === pageId,
			);
			if (!editor || !document || !noteMentionRange) {
				return;
			}

			editor
				.chain()
				.focus()
				.insertContentAt(noteMentionRange, [
					{
						type: "mention",
						attrs: {
							id: document.id,
							label: document.title,
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			closeMentionPicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closeMentionPicker],
	);
	const handleAddTool = React.useCallback(
		(sourceId: string) => {
			const noteMentionRange = noteMentionRangeRef.current;
			const editor = composerEditorRef.current;
			const source = allAppSourcesRef.current.find(
				(item) => item.id === sourceId,
			);
			if (!editor || !source || !noteMentionRange) {
				return;
			}

			editor
				.chain()
				.focus()
				.insertContentAt(noteMentionRange, [
					{
						type: "mention",
						attrs: {
							id: source.id,
							label: getAppSourceLabel(source.provider),
							type: "tool",
							provider: source.provider,
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			closeMentionPicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closeMentionPicker],
	);
	const handleSelectMentionPickerItem = React.useCallback(
		(item: MentionPickerItem) => {
			if (item.type === "tool") {
				handleAddTool(item.source.id);
				return;
			}

			handleAddMention(item.document.id);
		},
		[handleAddMention, handleAddTool],
	);

	useChatComposerPromptFocus({
		promptRef,
		editingMessageId,
		onCancelEdit,
	});

	const composerEditor = useEditor({
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
					items: ({ query }) => {
						return filterMentionableDocuments(
							allMentionDocumentsRef.current,
							query,
						)
							.slice(0, 8)
							.map((document) => ({
								id: document.id,
								label: document.title,
							}));
					},
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
							const nextDocuments = filterMentionableDocuments(
								allMentionDocumentsRef.current,
								query,
							);
							const nextTools = filterMentionableTools(
								allAppSourcesRef.current,
								query,
							);
							const nextItems = [
								...nextTools.map<MentionPickerItem>((source) => ({
									type: "tool",
									source,
								})),
								...nextDocuments.map<MentionPickerItem>((document) => ({
									type: "note",
									document,
								})),
							];
							noteMentionRangeRef.current = range;
							visibleMentionDocumentsRef.current = nextDocuments;
							visibleMentionItemsRef.current = nextItems;
							// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
							setDocumentSearchTerm(query);
							// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
							selectMentionIndex(0);
							requestAnimationFrame(() => {
								const rect = getMentionAnchorRect(editor, range);
								// react-doctor-disable-next-line react-doctor/no-derived-state
								setMentionPickerPosition(
									getMentionPickerPosition({
										rect,
										itemCount: nextItems.length,
										minSectionedHeight: true,
									}),
								);
							});
							mentionPopoverOpenRef.current = true;
							// react-doctor-disable-next-line react-doctor/no-derived-state
							setMentionPopoverOpen(true);
						};

						return {
							onStart: updatePicker,
							onUpdate: updatePicker,
							onKeyDown: ({ event }) =>
								handleMentionPickerKeyDown({
									event,
									handleSelectMentionPickerItem,
									selectMentionIndex,
									selectedMentionIndexRef,
									visibleMentionItemsRef,
								}),
							onExit: closeMentionPicker,
						};
					},
				},
			}),
			Placeholder.configure({
				placeholder: () => placeholderRef.current,
			}),
		],
		content: getDraftDocument(draft, mentions),
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		onCreate: ({ editor }) => {
			composerEditorRef.current = editor;
		},
		onDestroy: () => {
			composerEditorRef.current = null;
		},
		editorProps: {
			attributes: {
				class:
					"chat-composer-tiptap min-h-[44px] max-h-[24rem] w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent pt-3 pr-3 pb-0 pl-3.5 text-left text-[14px] leading-[1.6] font-normal shadow-none ring-0 outline-none focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
				"data-chat-prompt": "true",
				"data-slot": "input-group-control",
			},
			handleKeyDown: (_view, event) => {
				if (editingMessageId && onCancelEdit && event.key === "Escape") {
					event.preventDefault();
					onCancelEdit();
					return true;
				}

				if (mentionPopoverOpenRef.current) {
					return handleMentionPickerKeyDown({
						event,
						handleSelectMentionPickerItem,
						selectMentionIndex,
						selectedMentionIndexRef,
						visibleMentionItemsRef,
					});
				}

				onDraftKeyDown(event);
				return event.defaultPrevented;
			},
		},
		onUpdate: ({ editor }) => {
			onDraftChange(editor.getText({ blockSeparator: "\n" }));
			const nextMentions = getMentionsFromComposerContent(editor.getJSON());
			if (!areChatComposerMentionsEqual(mentionsRef.current, nextMentions)) {
				mentionsRef.current = nextMentions;
				onMentionsChange(nextMentions);
			}
		},
	});

	// react-doctor-disable-next-line react-doctor/no-derived-state
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		if (previousPlaceholderRef.current === placeholder) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		previousPlaceholderRef.current = placeholder;
		// react-doctor-disable-next-line react-doctor/no-derived-state
		composerEditor.view.dispatch(
			// react-doctor-disable-next-line react-doctor/no-derived-state
			composerEditor.state.tr.setMeta("addToHistory", false),
		);
	}, [composerEditor, placeholder]);

	// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
		const currentText = composerEditor.getText({ blockSeparator: "\n" });
		if (
			currentText === draft &&
			// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
			getMentionsFromComposerContent(composerEditor.getJSON()).length ===
				mentions.length
		) {
			return;
		}

		if (composerEditor.isFocused && draft && !editingMessageId) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		composerEditor.commands.setContent(getDraftDocument(draft, mentions), {
			emitUpdate: false,
		});
	}, [composerEditor, draft, editingMessageId, mentions]);
	// react-doctor-disable-next-line react-doctor/no-derived-state
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		const activeElement = document.activeElement;
		const isEditableElement =
			activeElement instanceof HTMLElement &&
			(activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement ||
				activeElement instanceof HTMLSelectElement ||
				activeElement.isContentEditable);

		if (isEditableElement) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		composerEditor.commands.focus("end", { scrollIntoView: false });
	}, [composerEditor]);

	return (
		<>
			<div
				ref={promptRef}
				id="chat-prompt"
				className="chat-composer-editor flex w-full flex-1 cursor-text"
			>
				{composerEditor ? (
					<Tiptap editor={composerEditor}>
						<Tiptap.Content />
					</Tiptap>
				) : null}
			</div>
			<MentionPicker
				open={mentionPopoverOpen}
				position={mentionPickerPosition}
				mentionableDocuments={visibleMentionDocuments}
				appSources={visibleMentionTools}
				items={visibleMentionItems}
				selectedIndex={selectedMentionIndex}
				onSelectedIndexChange={selectMentionIndex}
				isNotesLoading={isNotesLoading}
				emptyStateMessage={emptyStateMessage}
				shouldSearchDocuments={shouldSearchDocuments}
				onAddMention={handleAddMention}
				onAddTool={handleAddTool}
			/>
		</>
	);
}

function handleMentionPickerKeyDown({
	event,
	handleSelectMentionPickerItem,
	selectMentionIndex,
	selectedMentionIndexRef,
	visibleMentionItemsRef,
}: {
	event: KeyboardEvent;
	handleSelectMentionPickerItem: (item: MentionPickerItem) => void;
	selectMentionIndex: (index: number) => void;
	selectedMentionIndexRef: React.RefObject<number>;
	visibleMentionItemsRef: React.RefObject<MentionPickerItem[]>;
}) {
	if (
		event.key !== "ArrowDown" &&
		event.key !== "ArrowUp" &&
		event.key !== "Enter"
	) {
		return false;
	}

	const items = visibleMentionItemsRef.current;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectMentionIndex(
			items.length === 0
				? 0
				: (selectedMentionIndexRef.current + 1) % items.length,
		);
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectMentionIndex(
			items.length === 0
				? 0
				: (selectedMentionIndexRef.current - 1 + items.length) % items.length,
		);
		return true;
	}

	const selectedItem = items[selectedMentionIndexRef.current] ?? items[0];
	if (!selectedItem) {
		return false;
	}

	event.preventDefault();
	handleSelectMentionPickerItem(selectedItem);
	return true;
}

function useChatComposerPromptFocus({
	promptRef,
	editingMessageId,
	onCancelEdit,
}: {
	promptRef: React.RefObject<HTMLDivElement | null>;
	editingMessageId: string | null | undefined;
	onCancelEdit?: () => void;
}) {
	const focusPrompt = React.useCallback(() => {
		const prompt = promptRef.current;
		if (!prompt) {
			return;
		}

		const activeElement = document.activeElement;
		const isEditableElement =
			activeElement instanceof HTMLElement &&
			(activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement ||
				activeElement instanceof HTMLSelectElement ||
				activeElement.isContentEditable);

		if (isEditableElement && activeElement !== prompt) {
			return;
		}

		prompt.querySelector<HTMLElement>(".ProseMirror")?.focus({
			preventScroll: true,
		});
	}, [promptRef]);

	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
		focusPrompt();
	}, [focusPrompt]);

	React.useEffect(() => {
		if (!editingMessageId) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
		focusPrompt();
	}, [editingMessageId, focusPrompt]);

	React.useEffect(() => {
		if (!editingMessageId || !onCancelEdit) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			onCancelEdit();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [editingMessageId, onCancelEdit]);
}

function MentionPicker({
	open,
	position,
	mentionableDocuments,
	appSources,
	items,
	selectedIndex,
	onSelectedIndexChange,
	isNotesLoading,
	emptyStateMessage,
	shouldSearchDocuments,
	onAddMention,
	onAddTool,
}: {
	open: boolean;
	position: MentionPickerPosition | null;
	mentionableDocuments: ContextPage[];
	appSources: AppSource[];
	items: MentionPickerItem[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	isNotesLoading: boolean;
	emptyStateMessage: string;
	shouldSearchDocuments: boolean;
	onAddMention: (pageId: string) => void;
	onAddTool: (sourceId: string) => void;
}) {
	if (!open || !position) {
		return null;
	}

	return createPortal(
		// react-doctor-disable-next-line react-doctor/prefer-tag-over-role
		<div
			role="listbox"
			aria-label="Mention suggestions"
			className="fixed z-[70] flex w-56 flex-col rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 pointer-events-auto"
			style={{
				top: position.top,
				left: position.left,
			}}
			onPointerDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<div className="max-h-72 overflow-y-auto p-1">
				{!shouldSearchDocuments && appSources.length > 0 ? (
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
											onAddTool(source.id);
										}}
										className={`flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground ${selected ? "bg-accent text-accent-foreground" : "text-popover-foreground"}`}
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
				{shouldSearchDocuments && appSources.length > 0 ? (
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
											onAddTool(source.id);
										}}
										className={`flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground ${selected ? "bg-accent text-accent-foreground" : "text-popover-foreground"}`}
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
				{!shouldSearchDocuments ? (
					<div className={appSources.length > 0 ? "mt-1" : undefined}>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Notes
						</div>
						<div className="px-2 pt-0.5 pb-2 text-xs text-muted-foreground">
							Type to search for notes
						</div>
					</div>
				) : null}
				{shouldSearchDocuments && isNotesLoading ? (
					<div className="px-1">
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Notes
						</div>
						<div className="h-20" aria-hidden="true" />
					</div>
				) : null}
				{!isNotesLoading && items.length === 0 && shouldSearchDocuments ? (
					<div className="py-6 text-center text-sm text-muted-foreground">
						{emptyStateMessage}
					</div>
				) : null}
				{shouldSearchDocuments && mentionableDocuments.length > 0 ? (
					<div className={appSources.length > 0 ? "mt-1" : undefined}>
						<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
							Notes
						</div>
						<div>
							{mentionableDocuments.map((document, index) => {
								const itemIndex = appSources.length + index;
								const selected = itemIndex === selectedIndex;
								return (
									<button
										key={document.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(itemIndex)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onAddMention(document.id);
										}}
										className={`flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground ${selected ? "bg-accent text-accent-foreground" : "text-popover-foreground"}`}
									>
										<div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
											<document.icon className="size-4" />
										</div>
										<div
											className="min-w-0 flex-1 truncate"
											title={document.title}
										>
											{document.title}
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

function ChatComposerTopAccessory({
	editingMessageId,
	onCancelEdit,
	topAccessory,
}: {
	editingMessageId: string | null | undefined;
	onCancelEdit?: () => void;
	topAccessory?: React.ReactNode;
}) {
	if (editingMessageId && onCancelEdit) {
		return (
			<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
				<button
					type="button"
					onClick={onCancelEdit}
					className="pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/60 bg-secondary/80 px-4 py-1.5 text-sm text-secondary-foreground shadow-sm hover:bg-secondary"
					aria-label="Cancel edit"
				>
					<span>Cancel edit</span>
					<Kbd className="rounded-full border border-border/60 bg-muted px-2">
						Esc
					</Kbd>
				</button>
			</div>
		);
	}

	if (!topAccessory) {
		return null;
	}

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
			<div className="pointer-events-auto">{topAccessory}</div>
		</div>
	);
}

function ChatComposerTopAddon({
	useCompactLayout,
	attachedFiles,
	onRemoveAttachedFile,
}: {
	useCompactLayout: boolean;
	attachedFiles: ChatAttachment[];
	onRemoveAttachedFile: (index: number) => void;
}) {
	return (
		<InputGroupAddon
			align="block-start"
			className={`px-3.5 pb-0 ${useCompactLayout ? "pt-2.5" : "pt-3"}`}
		>
			<FileAttachmentChips
				files={attachedFiles}
				onRemove={onRemoveAttachedFile}
			/>
		</InputGroupAddon>
	);
}

function ChatComposerFooter({
	draft,
	attachedFiles,
	canStop,
	onAttachmentUploadFailed,
	onAttachmentUploaded,
	onAttachmentsAdded,
	onSubmit,
	onStop,
	modelPicker,
	scopePicker,
}: {
	draft: string;
	attachedFiles: ChatAttachment[];
	canStop: boolean;
	onAttachmentUploadFailed: (id: string) => void;
	onAttachmentUploaded: (id: string, file: FileUIPart) => void;
	onAttachmentsAdded: (files: ChatAttachment[]) => void;
	onSubmit: () => void | Promise<void>;
	onStop: () => void;
	modelPicker: React.ReactNode;
	scopePicker: React.ReactNode;
}) {
	const hasDraftText = draft.trim().length > 0;
	const hasSendableInput =
		(canStop ? hasDraftText : hasDraftText || attachedFiles.length > 0) &&
		!hasUploadingAttachments(attachedFiles);
	const shouldShowStop = canStop && !hasSendableInput;
	const isSendDisabled = !shouldShowStop && !hasSendableInput;

	return (
		<InputGroupAddon
			align="block-end"
			className="min-w-0 flex-wrap gap-1 px-2 pt-1 pb-2"
		>
			<FileAttachmentButton
				onFileUploadFailed={onAttachmentUploadFailed}
				onFileUploaded={onAttachmentUploaded}
				onFilesAdded={onAttachmentsAdded}
			/>
			{scopePicker}
			<div className="ml-auto flex min-w-0 items-center gap-1">
				{modelPicker}
			</div>
			<InputGroupButton
				aria-label={shouldShowStop ? "Stop streaming" : "Send"}
				className="rounded-full"
				variant="default"
				size="icon-sm"
				disabled={isSendDisabled}
				onClick={() => {
					if (shouldShowStop) {
						onStop();
						return;
					}

					void onSubmit();
				}}
			>
				{shouldShowStop ? (
					<Square className="size-3.5 fill-current" />
				) : (
					<ArrowUp className="size-4" />
				)}
			</InputGroupButton>
		</InputGroupAddon>
	);
}

function ScopePicker({
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
							aria-label="Chat options"
							size="icon-sm"
							className="group rounded-full"
						>
							<Settings2 className="text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground" />
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Chat options</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				side="bottom"
				align="start"
				sideOffset={4}
				className="w-56"
			>
				<DropdownMenuGroup>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="web-search">
							<Globe className="text-foreground" /> Web search
							<Switch
								id="web-search"
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
						aria-label="Connect tools"
						onClick={onOpenConnectionsSettings}
					>
						<Plus aria-hidden="true" />
						<span>Connect tools</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
