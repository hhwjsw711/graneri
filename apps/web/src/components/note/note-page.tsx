import type { JSONContent } from "@tiptap/core";
import type {
	TableOfContentData,
	TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";
import { Tiptap, useEditor } from "@tiptap/react";
import {
	isDesktopRuntime,
	saveDesktopTextFile,
} from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { isPanelLayoutActive } from "@workspace/ui/lib/panel-layout-activity";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation } from "convex/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ShimmerText } from "@/components/ai-elements/shimmer";
import { MarkdownStream } from "@/components/chat/markdown-stream";
import { COMPOSER_DOCK_WRAPPER_CLASS } from "@/components/layout/composer-dock";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { ensureCssHighlightStyles } from "@/lib/css-highlight-styles";
import {
	loadNoteDraft,
	removeNoteDraft,
	saveNoteDraft,
} from "@/lib/note-draft";
import {
	createNoteEditorExtensions,
	EMPTY_DOCUMENT,
	EMPTY_DOCUMENT_STRING,
	handleMarkdownPaste,
	looksLikeMarkdown,
	normalizePastedPlainText,
	normalizePastedSlice,
	parseMarkdownToDocument,
	parseStoredNoteContent,
} from "@/lib/note-editor";
import {
	canFlushQueuedNoteSave,
	createNoteSnapshot,
	isLatestNoteSaveRequest,
} from "@/lib/note-snapshot";
import {
	isEnhancedNoteTemplate,
	type NoteTemplate,
} from "@/lib/note-templates";
import {
	type StructuredNote,
	type StructuredNoteBody,
	structuredNoteToDocument,
	structuredNoteToSearchableText,
} from "@/lib/structured-note";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { readDesktopCommentsPanelPinnedState } from "./note-comments-panel-state";
import {
	NoteCommentsSheet,
	type PendingNoteCommentSelection,
} from "./note-comments-sheet";
import { NoteComposer } from "./note-composer";
import { NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS } from "./note-layout";
import { OPEN_NOTE_COMMENTS_EVENT } from "./note-page-events";
import { NoteSelectionMenu } from "./note-selection-menu";
import { NoteTableOfContents } from "./note-table-of-contents";
import { optimisticPatchNote } from "./optimistic-patch-note";
import { writeRichTextToClipboard } from "./share-note";

const getPlainTextContent = ({
	editor,
	title,
	searchableText,
}: {
	editor: NonNullable<ReturnType<typeof useEditor>>;
	title: string;
	searchableText: string;
}) => {
	const editorText = editor.getText({ blockSeparator: "\n\n" }).trim();
	return [title.trim(), editorText || searchableText.trim()]
		.filter(Boolean)
		.join("\n\n");
};

const getMarkdownContent = ({
	editor,
	title,
	searchableText,
}: {
	editor: NonNullable<ReturnType<typeof useEditor>>;
	title: string;
	searchableText: string;
}) => {
	const editorMarkdown = editor.getMarkdown().trim();
	const titleText = title.trim();

	return [
		titleText ? `# ${titleText}` : "",
		editorMarkdown || searchableText.trim(),
	]
		.filter(Boolean)
		.join("\n\n");
};

const getExportFileName = (title: string) =>
	`${
		title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "note"
	}.md`;

type CssHighlightRegistry = {
	set: (name: string, highlight: Highlight) => void;
	delete: (name: string) => void;
};

type CssWithHighlights = typeof CSS & {
	highlights?: CssHighlightRegistry;
};

declare const Highlight: (new (...ranges: Range[]) => Highlight) | undefined;
type Highlight = object;

const NOTE_SEARCH_MATCH_HIGHLIGHT = "note-search-match";
const NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT = "note-search-active-match";
const NOTE_SAVE_DEBOUNCE_MS = 2000;
const NOTE_SAVE_MAX_DEBOUNCE_MS = 10_000;

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createTextMatchRanges = ({
	element,
	query,
}: {
	element: HTMLElement;
	query: string;
}) => {
	const ranges: Range[] = [];
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return ranges;
	}

	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let currentNode = walker.nextNode();
	const matcher = new RegExp(escapeRegExp(normalizedQuery), "gu");

	while (currentNode) {
		const textNode = currentNode as Text;
		const normalizedText = textNode.data.toLocaleLowerCase();
		let match = matcher.exec(normalizedText);

		while (match) {
			const searchIndex = match.index;
			const range = document.createRange();
			range.setStart(textNode, searchIndex);
			range.setEnd(textNode, searchIndex + normalizedQuery.length);
			ranges.push(range);
			match = matcher.exec(normalizedText);
		}

		matcher.lastIndex = 0;
		currentNode = walker.nextNode();
	}

	return ranges;
};

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const getRichTextContent = ({
	editor,
	title,
	searchableText,
}: {
	editor: NonNullable<ReturnType<typeof useEditor>>;
	title: string;
	searchableText: string;
}) => {
	const plainText = getPlainTextContent({
		editor,
		title,
		searchableText,
	});
	const titleText = title.trim();
	const editorHtml = editor.getHTML().trim();
	const titleHtml = titleText ? `<h1>${escapeHtml(titleText)}</h1>` : "";
	const bodyHtml =
		editorHtml && editorHtml !== "<p></p>"
			? editorHtml
			: searchableText
					.trim()
					.split(/\n{2,}/)
					.flatMap((paragraph) => {
						const trimmedParagraph = paragraph.trim();
						return trimmedParagraph
							? [`<p>${escapeHtml(trimmedParagraph)}</p>`]
							: [];
					})
					.join("");

	return {
		text: plainText,
		html: `<article>${titleHtml}${bodyHtml}</article>`,
	};
};

const plainTextToDocumentNodes = (text: string): JSONContent[] =>
	text.split(/\n{2,}/).flatMap((chunk) => {
		const trimmedChunk = chunk.trim();
		return trimmedChunk
			? [
					{
						type: "paragraph",
						content: [{ type: "text", text: trimmedChunk }],
					} satisfies JSONContent,
				]
			: [];
	});

const exportTextFile = async ({
	fileName,
	content,
}: {
	fileName: string;
	content: string;
}) => {
	const desktopResult = await saveDesktopTextFile(fileName, content);

	if (desktopResult) {
		return desktopResult;
	}

	const blob = new Blob([content], {
		type: "text/plain;charset=utf-8",
	});
	const downloadUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = downloadUrl;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(downloadUrl);

	return {
		ok: true,
		canceled: false,
		filePath: fileName,
	};
};

const showActionError = (message: string, error: unknown) => {
	console.error(message, error);
	toast.error(message);
};

const areTableOfContentsEqual = (
	currentAnchors: TableOfContentData,
	nextAnchors: TableOfContentData,
) => {
	return (
		currentAnchors.length === nextAnchors.length &&
		currentAnchors.every((anchor, index) => {
			const nextAnchor = nextAnchors[index];
			return (
				nextAnchor !== undefined &&
				anchor.id === nextAnchor.id &&
				anchor.textContent === nextAnchor.textContent &&
				anchor.originalLevel === nextAnchor.originalLevel &&
				anchor.isActive === nextAnchor.isActive
			);
		})
	);
};

export type NoteEditorActions = {
	canCopyMarkdown: boolean;
	canUndo: boolean;
	canRedo: boolean;
	canShowTemplateSelect: boolean;
	copyMarkdown: () => Promise<void>;
	undo: () => void;
	redo: () => void;
	exportMarkdown: () => Promise<void>;
	applyTemplate: (template: NoteTemplate) => Promise<boolean>;
	openComments: () => void;
};

type NotePageCurrentUser = {
	name: string;
	email: string;
	avatar: string;
};

const useNotePageController = ({
	noteId,
	note,
	externalTitle,
	onTitleChange,
	onEditorActionsChange,
	scrollParentRef,
	onCommentThreadClick,
	onOpenComments,
}: {
	noteId: Id<"notes"> | null;
	note?: Doc<"notes"> | null;
	externalTitle?: string;
	onTitleChange?: (title: string) => void;
	onEditorActionsChange?: (actions: NoteEditorActions | null) => void;
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
	onCommentThreadClick?: (threadId: string) => void;
	onOpenComments?: () => void;
}) => {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [title, setTitle] = React.useState("");
	const [content, setContent] = React.useState(EMPTY_DOCUMENT_STRING);
	const [searchableText, setSearchableText] = React.useState("");
	const [tableOfContents, setTableOfContents] =
		React.useState<TableOfContentData>([]);
	const pendingTableOfContentsRef = React.useRef<TableOfContentData | null>(
		null,
	);
	const tableOfContentsAnimationFrameRef = React.useRef<number | null>(null);
	const [templateApplyState, setTemplateApplyState] = React.useState<{
		isRunning: boolean;
		templateName: string | null;
		streamedMarkdown: string;
	}>(() => ({
		isRunning: false,
		templateName: null,
		streamedMarkdown: "",
	}));
	const nextNoteIdRef = React.useRef<Id<"notes"> | null>(null);
	const titleTextareaRef = React.useRef<HTMLTextAreaElement>(null);
	const latestEditorStateRef = React.useRef<{
		title: string;
		searchableText: string;
		templateSlug: string | null;
		isApplyingTemplate: boolean;
		canShowTemplateSelect: boolean;
	}>({
		title: "",
		searchableText: "",
		templateSlug: null,
		isApplyingTemplate: false,
		canShowTemplateSelect: false,
	});
	const applyDraftState = React.useCallback(
		(nextDraft: { title: string; content: string; searchableText: string }) => {
			setTitle(nextDraft.title);
			onTitleChange?.(nextDraft.title);
			setContent(nextDraft.content);
			setSearchableText(nextDraft.searchableText);
		},
		[onTitleChange],
	);
	const hasHydratedRef = React.useRef(false);
	const hydratedNoteIdRef = React.useRef<Id<"notes"> | null>(null);
	const suppressNextTitleChangeRef = React.useRef(false);
	const saveInFlightRef = React.useRef(false);
	const lastSavedSnapshotRef = React.useRef<string | null>(null);
	const latestSaveRequestIdRef = React.useRef(0);
	const firstUnsavedChangeAtRef = React.useRef<number | null>(null);
	const publishedEditorActionsRef = React.useRef<{
		noteId: Id<"notes">;
		canCopyMarkdown: boolean;
		canUndo: boolean;
		canRedo: boolean;
		canShowTemplateSelect: boolean;
	} | null>(null);
	const publishEditorActionsRef = React.useRef<(() => void) | null>(null);
	const queuedSaveRef = React.useRef<{
		requestId: number;
		snapshot: string;
		payload: {
			title: string;
			content: string;
			searchableText: string;
		};
	} | null>(null);
	const pendingSaveRef = React.useRef<{
		noteId: Id<"notes">;
		requestId: number;
		snapshot: string;
		payload: {
			title: string;
			content: string;
			searchableText: string;
		};
	} | null>(null);
	const shouldPreserveStructuredNoteTitle = Boolean(note?.calendarEventKey);
	const saveNote = useMutation(api.notes.save);
	const setNoteTemplate = useMutation(
		api.notes.setTemplate,
	).withOptimisticUpdate((localStore, args) => {
		const nextTemplateSlug = args.templateSlug ?? undefined;
		const patchNote = <T extends Doc<"notes">>(currentNote: T): T => ({
			...currentNote,
			templateSlug: nextTemplateSlug,
		});
		optimisticPatchNote(localStore, args.workspaceId, args.id, patchNote);
	});

	const flushSave = React.useCallback(
		async (
			nextNoteId: Id<"notes">,
			requestId: number,
			snapshot: string,
			payload: {
				title: string;
				content: string;
				searchableText: string;
			},
		) => {
			if (
				!isLatestNoteSaveRequest({
					requestId,
					latestRequestId: latestSaveRequestIdRef.current,
				})
			) {
				return;
			}

			if (saveInFlightRef.current) {
				queuedSaveRef.current = { requestId, snapshot, payload };
				return;
			}

			saveInFlightRef.current = true;

			try {
				if (!activeWorkspaceId) {
					return;
				}

				await saveNote({
					workspaceId: activeWorkspaceId,
					id: nextNoteId,
					...payload,
				});
				lastSavedSnapshotRef.current = snapshot;
				firstUnsavedChangeAtRef.current = null;
				await removeNoteDraft(nextNoteId);
				if (pendingSaveRef.current?.snapshot === snapshot) {
					pendingSaveRef.current = null;
				}
			} catch (error) {
				console.error("Failed to save note", error);
			} finally {
				saveInFlightRef.current = false;

				const queuedSave = queuedSaveRef.current;
				const shouldFlushQueuedSave = queuedSave
					? canFlushQueuedNoteSave({
							lastSavedSnapshot: lastSavedSnapshotRef.current,
							latestRequestId: latestSaveRequestIdRef.current,
							queuedRequestId: queuedSave.requestId,
							queuedSnapshot: queuedSave.snapshot,
						})
					: false;
				if (!shouldFlushQueuedSave) {
					queuedSaveRef.current = null;
				} else if (queuedSave) {
					queuedSaveRef.current = null;
					void flushSave(
						nextNoteId,
						queuedSave.requestId,
						queuedSave.snapshot,
						queuedSave.payload,
					);
				}
			}
		},
		[activeWorkspaceId, saveNote],
	);
	const flushPendingSave = React.useCallback(
		(noteIdToFlush: Id<"notes"> | null) => {
			const pendingSave = pendingSaveRef.current;

			if (
				!noteIdToFlush ||
				!pendingSave ||
				pendingSave.noteId !== noteIdToFlush
			) {
				return;
			}

			pendingSaveRef.current = null;
			void flushSave(
				pendingSave.noteId,
				pendingSave.requestId,
				pendingSave.snapshot,
				pendingSave.payload,
			);
		},
		[flushSave],
	);

	const getTableOfContentsScrollParent = React.useCallback(
		() => scrollParentRef?.current ?? window,
		[scrollParentRef],
	);
	const flushPendingTableOfContents = React.useCallback(() => {
		tableOfContentsAnimationFrameRef.current = null;

		if (isPanelLayoutActive()) {
			tableOfContentsAnimationFrameRef.current = window.requestAnimationFrame(
				flushPendingTableOfContents,
			);
			return;
		}

		const nextAnchors = pendingTableOfContentsRef.current;
		pendingTableOfContentsRef.current = null;

		if (!nextAnchors) {
			return;
		}

		setTableOfContents((currentAnchors) =>
			areTableOfContentsEqual(currentAnchors, nextAnchors)
				? currentAnchors
				: nextAnchors,
		);
	}, []);
	const handleTableOfContentsUpdate = React.useCallback(
		(nextAnchors: TableOfContentData) => {
			pendingTableOfContentsRef.current = nextAnchors.map((anchor) => ({
				...anchor,
			}));

			if (tableOfContentsAnimationFrameRef.current !== null) {
				return;
			}

			tableOfContentsAnimationFrameRef.current = window.requestAnimationFrame(
				flushPendingTableOfContents,
			);
		},
		[flushPendingTableOfContents],
	);

	const editor = useEditor({
		extensions: createNoteEditorExtensions({
			onTableOfContentsUpdate: handleTableOfContentsUpdate,
			getTableOfContentsScrollParent,
			onCommentThreadClick,
		}),
		immediatelyRender: false,
		editorProps: {
			attributes: {
				class:
					"note-tiptap min-h-[240px] border border-transparent bg-transparent p-0 text-base outline-none",
			},
			handlePaste: (view, event) => handleMarkdownPaste(view, event),
			transformPasted: (slice, view) =>
				normalizePastedSlice(slice, view.state.schema),
		},
		onUpdate: ({ editor }) => {
			setContent(JSON.stringify(editor.getJSON()));
			setSearchableText(editor.getText());
		},
	});

	const syncTableOfContents = React.useCallback(() => {
		if (!editor) {
			return;
		}

		window.requestAnimationFrame(() => {
			const updateTableOfContents = (
				editor.commands as typeof editor.commands & {
					updateTableOfContents?: () => void;
				}
			).updateTableOfContents;

			if (!editor.isDestroyed && typeof updateTableOfContents === "function") {
				updateTableOfContents();
			}
		});
	}, [editor]);

	const setEditorDocument = React.useCallback(
		(nextDocument: JSONContent) => {
			if (!editor) {
				return;
			}

			editor.commands.setContent(nextDocument, { emitUpdate: false });
			syncTableOfContents();
		},
		[editor, syncTableOfContents],
	);
	const syncHydratedNoteState = React.useCallback(async () => {
		if (hydratedNoteIdRef.current !== noteId) {
			hydratedNoteIdRef.current = noteId;
			hasHydratedRef.current = false;
			lastSavedSnapshotRef.current = null;
			latestSaveRequestIdRef.current = 0;
			firstUnsavedChangeAtRef.current = null;
			queuedSaveRef.current = null;
			pendingSaveRef.current = null;
			setTableOfContents([]);
			pendingTableOfContentsRef.current = null;

			if (editor) {
				applyDraftState({
					title: "",
					content: EMPTY_DOCUMENT_STRING,
					searchableText: "",
				});
				setEditorDocument(EMPTY_DOCUMENT);
			}
		}

		if (!editor || !noteId || note === undefined || hasHydratedRef.current) {
			if (editor && note && hasHydratedRef.current) {
				const remoteSnapshot = createNoteSnapshot({
					title: note.title,
					content: note.content,
					searchableText: note.searchableText,
				});
				const localSnapshot = createNoteSnapshot({
					title,
					content,
					searchableText,
				});

				if (
					remoteSnapshot !== lastSavedSnapshotRef.current &&
					localSnapshot === lastSavedSnapshotRef.current &&
					!pendingSaveRef.current &&
					!saveInFlightRef.current
				) {
					const nextContent = parseStoredNoteContent(
						note.content,
						editor.state.schema,
					);

					applyDraftState({
						title: note.title,
						content: note.content,
						searchableText: note.searchableText,
					});
					lastSavedSnapshotRef.current = remoteSnapshot;
					await removeNoteDraft(note._id);
					setEditorDocument(nextContent);
				}
			}
			return;
		}

		if (note) {
			const localDraft =
				activeWorkspaceId && note.updatedAt
					? await loadNoteDraft({
							noteId: note._id,
							workspaceId: activeWorkspaceId,
						})
					: null;
			if (localDraft && localDraft.updatedAt <= note.updatedAt) {
				void removeNoteDraft(note._id);
			}
			const nextDraft =
				localDraft && localDraft.updatedAt > note.updatedAt
					? {
							title: localDraft.title,
							content: localDraft.content,
							searchableText: localDraft.searchableText,
						}
					: {
							title: note.title,
							content: note.content,
							searchableText: note.searchableText,
						};
			const nextContent = parseStoredNoteContent(
				nextDraft.content,
				editor.state.schema,
			);

			applyDraftState(nextDraft);
			lastSavedSnapshotRef.current = createNoteSnapshot({
				title: note.title,
				content: note.content,
				searchableText: note.searchableText,
			});
			setEditorDocument(nextContent);
		} else {
			lastSavedSnapshotRef.current = createNoteSnapshot({
				title: "",
				content: EMPTY_DOCUMENT_STRING,
				searchableText: "",
			});
			setEditorDocument(EMPTY_DOCUMENT);
		}

		hasHydratedRef.current = true;
	}, [
		activeWorkspaceId,
		applyDraftState,
		content,
		editor,
		note,
		noteId,
		searchableText,
		setEditorDocument,
		title,
	]);

	React.useEffect(() => {
		nextNoteIdRef.current = noteId;
	}, [noteId]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		editor.setEditable(!templateApplyState.isRunning);
	}, [editor, templateApplyState.isRunning]);

	React.useEffect(() => {
		latestEditorStateRef.current = {
			title,
			searchableText,
			templateSlug: note?.templateSlug ?? null,
			isApplyingTemplate: templateApplyState.isRunning,
			canShowTemplateSelect: searchableText.trim().length > 0,
		};
		publishEditorActionsRef.current?.();
	}, [note?.templateSlug, searchableText, templateApplyState.isRunning, title]);

	React.useEffect(() => {
		void syncHydratedNoteState();
	}, [syncHydratedNoteState]);

	React.useEffect(() => {
		return () => {
			if (tableOfContentsAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(tableOfContentsAnimationFrameRef.current);
			}
		};
	}, []);

	React.useEffect(() => {
		if (!noteId || !hasHydratedRef.current) {
			return;
		}

		if (templateApplyState.isRunning) {
			return;
		}

		const snapshot = createNoteSnapshot({
			title,
			content,
			searchableText,
		});

		if (snapshot === lastSavedSnapshotRef.current) {
			firstUnsavedChangeAtRef.current = null;
			return;
		}

		const now = Date.now();
		firstUnsavedChangeAtRef.current ??= now;
		const elapsedSinceFirstUnsavedChange =
			now - firstUnsavedChangeAtRef.current;
		const remainingMaxDebounceMs = Math.max(
			0,
			NOTE_SAVE_MAX_DEBOUNCE_MS - elapsedSinceFirstUnsavedChange,
		);
		const requestId = latestSaveRequestIdRef.current + 1;
		latestSaveRequestIdRef.current = requestId;
		const payload = {
			title,
			content,
			searchableText,
		};
		if (activeWorkspaceId) {
			void saveNoteDraft({
				noteId,
				workspaceId: activeWorkspaceId,
				payload,
			});
		}
		pendingSaveRef.current = {
			noteId,
			requestId,
			snapshot,
			payload,
		};

		const timeout = window.setTimeout(
			() => {
				void flushSave(noteId, requestId, snapshot, payload);
			},
			Math.min(NOTE_SAVE_DEBOUNCE_MS, remainingMaxDebounceMs),
		);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [
		content,
		activeWorkspaceId,
		flushSave,
		noteId,
		searchableText,
		templateApplyState.isRunning,
		title,
	]);

	React.useEffect(() => {
		const noteIdToFlush = noteId;

		return () => {
			flushPendingSave(noteIdToFlush);
		};
	}, [flushPendingSave, noteId]);

	React.useEffect(() => {
		if (suppressNextTitleChangeRef.current) {
			suppressNextTitleChangeRef.current = false;
			return;
		}

		const timeout = window.setTimeout(() => {
			onTitleChange?.(title);
		}, 150);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [onTitleChange, title]);

	React.useEffect(() => {
		if (!noteId || !hasHydratedRef.current || externalTitle === undefined) {
			return;
		}

		const nextTitle = externalTitle;
		setTitle((currentTitle) => {
			if (nextTitle === currentTitle) {
				return currentTitle;
			}

			suppressNextTitleChangeRef.current = true;
			return nextTitle;
		});
	}, [externalTitle, noteId]);

	React.useEffect(() => {
		void title;
		const element = titleTextareaRef.current;
		if (!element) {
			return;
		}

		element.style.cssText += "height: auto;";
		const nextHeight = element.scrollHeight;
		element.style.height = `${nextHeight}px`;
	}, [title]);

	const copyText = React.useCallback(async () => {
		if (!editor) {
			return;
		}

		const { title, searchableText } = latestEditorStateRef.current;
		const richText = getRichTextContent({
			editor,
			title,
			searchableText,
		});

		if (!richText.text) {
			toast("Nothing to copy yet");
			return;
		}

		try {
			await writeRichTextToClipboard(richText);
			toast.success("Note content copied");
		} catch (error) {
			showActionError("Failed to copy note content", error);
		}
	}, [editor]);

	const undo = React.useCallback(() => {
		if (!editor) {
			return;
		}

		if (!editor.can().undo()) {
			toast("Nothing to undo");
			return;
		}

		editor.chain().focus().undo().run();
		toast.success("Undid last change");
	}, [editor]);

	const redo = React.useCallback(() => {
		if (!editor) {
			return;
		}

		if (!editor.can().redo()) {
			toast("Nothing to redo");
			return;
		}

		editor.chain().focus().redo().run();
		toast.success("Redid last change");
	}, [editor]);

	const exportNote = React.useCallback(async () => {
		if (!editor) {
			return;
		}

		const { title, searchableText } = latestEditorStateRef.current;
		const serializedMarkdown = getMarkdownContent({
			editor,
			title,
			searchableText,
		});

		if (!serializedMarkdown) {
			toast("Nothing to export yet");
			return;
		}

		try {
			const result = await exportTextFile({
				fileName: getExportFileName(title),
				content: serializedMarkdown,
			});

			if (result.canceled) {
				toast("Export canceled");
				return;
			}

			toast.success("Note exported");
		} catch (error) {
			showActionError("Failed to export note", error);
		}
	}, [editor]);

	const appendChatResponseToNote = React.useCallback(
		async (text: string) => {
			if (!editor) {
				return;
			}

			const nextText = text.trim();

			if (!nextText) {
				return;
			}

			const normalizedText = normalizePastedPlainText(nextText);
			const nextContent = looksLikeMarkdown(normalizedText)
				? ((parseMarkdownToDocument(
						normalizedText,
						editor.state.schema,
					).toJSON().content as JSONContent[] | undefined) ??
					plainTextToDocumentNodes(nextText))
				: plainTextToDocumentNodes(nextText);

			editor.chain().focus().insertContent(nextContent).run();
			toast.success("Added to note");
		},
		[editor],
	);

	const focusEditor = React.useCallback(() => {
		if (!editor) {
			return;
		}

		editor.chain().focus("start").run();
	}, [editor]);

	const requestStructuredNote = React.useCallback(
		async (body: {
			title: string;
			rawNotes?: string;
			transcript?: string;
			noteText?: string;
		}) => {
			const response = await fetch("/api/enhance-note", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			const payload = (await response.json().catch(() => ({}))) as {
				error?: string;
				note?: StructuredNote;
			};

			if (!response.ok || !payload.note) {
				throw new Error(payload.error || "Failed to enhance note.");
			}

			return payload.note;
		},
		[],
	);

	const applyTemplate = React.useCallback(
		async (template: NoteTemplate) => {
			if (!editor || !noteId) {
				return false;
			}

			const {
				title,
				searchableText,
				templateSlug: previousTemplateSlug,
				isApplyingTemplate,
			} = latestEditorStateRef.current;
			const serializedText = getPlainTextContent({
				editor,
				title,
				searchableText,
			});
			const previousContent = content;
			const previousSearchableText = searchableText;
			const previousTitle = title;
			const previousDocument = editor.getJSON();

			if (isApplyingTemplate) {
				return false;
			}

			if (!serializedText.trim()) {
				toast("Nothing to rewrite yet");
				return false;
			}

			setTemplateApplyState({
				isRunning: true,
				templateName: template.name,
				streamedMarkdown: "",
			});

			try {
				if (!activeWorkspaceId) {
					return false;
				}

				await setNoteTemplate({
					workspaceId: activeWorkspaceId,
					id: nextNoteIdRef.current ?? noteId,
					templateSlug: template.slug,
				});

				if (isEnhancedNoteTemplate(template)) {
					const enhancedNote = await requestStructuredNote({
						title,
						noteText: serializedText,
					});
					const nextDocument = structuredNoteToDocument(enhancedNote);
					const nextContent = JSON.stringify(nextDocument);
					const nextSearchableText =
						structuredNoteToSearchableText(enhancedNote);
					const nextTitle = shouldPreserveStructuredNoteTitle
						? title
						: enhancedNote.title.trim() || title;

					setEditorDocument(nextDocument);
					setTitle(nextTitle);
					setContent(nextContent);
					setSearchableText(nextSearchableText);
					toast.success(`Rewrote note with ${template.name}`);

					return true;
				}

				setEditorDocument(EMPTY_DOCUMENT);
				setContent(EMPTY_DOCUMENT_STRING);
				setSearchableText("");

				const response = await fetch("/api/apply-template", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/x-ndjson",
					},
					body: JSON.stringify({
						title,
						noteText: serializedText,
						template,
					}),
				});

				if (!response.ok) {
					const errorText = await response.text().catch(() => "");
					throw new Error(errorText || "Failed to apply template.");
				}

				const stream = response.body;
				if (!stream) {
					throw new Error("Template rewrite stream is not available.");
				}

				const reader = stream.getReader();
				const decoder = new TextDecoder();
				let finalNote: StructuredNoteBody | null = null;
				let responseError: string | null = null;
				let bufferedResponse = "";
				let streamedText = "";

				const handleEvent = (rawLine: string) => {
					const line = rawLine.trim();
					if (!line) {
						return;
					}

					const payload = JSON.parse(line) as
						| {
								type: "text-delta";
								delta?: string;
						  }
						| {
								type: "final-note";
								note?: StructuredNoteBody;
						  }
						| {
								type: "error";
								error?: string;
						  };

					if (payload.type === "text-delta") {
						const delta = payload.delta ?? "";
						streamedText += delta;
						setTemplateApplyState({
							isRunning: true,
							templateName: template.name,
							streamedMarkdown: streamedText,
						});
						return;
					}

					if (payload.type === "final-note") {
						finalNote = payload.note ?? null;
						return;
					}

					responseError = payload.error ?? "Failed to apply template.";
				};

				const readResponseChunk = async (): Promise<void> => {
					const { done, value } = await reader.read();
					bufferedResponse += decoder.decode(value ?? new Uint8Array(), {
						stream: !done,
					});

					const lines = bufferedResponse.split("\n");
					bufferedResponse = lines.pop() ?? "";
					for (const nextLine of lines) {
						handleEvent(nextLine);
					}

					if (done) {
						return;
					}

					await readResponseChunk();
				};

				await readResponseChunk();

				if (bufferedResponse.trim()) {
					handleEvent(bufferedResponse);
				}

				if (responseError) {
					throw new Error(responseError);
				}

				if (!finalNote) {
					throw new Error(
						"Template rewrite finished without a validated structured note.",
					);
				}

				const nextDocument = structuredNoteToDocument(finalNote);
				const nextContent = JSON.stringify(nextDocument);
				const nextSearchableText = structuredNoteToSearchableText(finalNote);

				setEditorDocument(nextDocument);
				setContent(nextContent);
				setSearchableText(nextSearchableText);
				toast.success(`Rewrote note with ${template.name}`);

				return true;
			} catch (error) {
				try {
					const workspaceId = activeWorkspaceId;
					if (workspaceId) {
						await setNoteTemplate({
							workspaceId,
							id: nextNoteIdRef.current ?? noteId,
							templateSlug: previousTemplateSlug,
						});
					}
				} catch (revertError) {
					console.error("Failed to revert note template", revertError);
				}
				setEditorDocument(previousDocument);
				setTitle(previousTitle);
				setContent(previousContent);
				setSearchableText(previousSearchableText);
				showActionError("Failed to rewrite note with template", error);
				return false;
			} finally {
				setTemplateApplyState({
					isRunning: false,
					templateName: null,
					streamedMarkdown: "",
				});
			}
		},
		[
			activeWorkspaceId,
			content,
			editor,
			noteId,
			requestStructuredNote,
			setEditorDocument,
			setNoteTemplate,
			shouldPreserveStructuredNoteTitle,
		],
	);

	React.useEffect(() => {
		if (!noteId || !editor) {
			publishedEditorActionsRef.current = null;
			publishEditorActionsRef.current = null;
			onEditorActionsChange?.(null);
			return;
		}

		const publishEditorActions = () => {
			const { title, searchableText, canShowTemplateSelect } =
				latestEditorStateRef.current;
			const nextActions = {
				noteId,
				canCopyMarkdown: Boolean(
					title.trim().length > 0 || searchableText.trim().length > 0,
				),
				canUndo: editor.can().undo(),
				canRedo: editor.can().redo(),
				canShowTemplateSelect,
			};
			const previousActions = publishedEditorActionsRef.current;

			if (
				previousActions &&
				previousActions.noteId === nextActions.noteId &&
				previousActions.canCopyMarkdown === nextActions.canCopyMarkdown &&
				previousActions.canUndo === nextActions.canUndo &&
				previousActions.canRedo === nextActions.canRedo &&
				previousActions.canShowTemplateSelect ===
					nextActions.canShowTemplateSelect
			) {
				return;
			}

			publishedEditorActionsRef.current = nextActions;
			onEditorActionsChange?.({
				...nextActions,
				copyMarkdown: copyText,
				undo,
				redo,
				exportMarkdown: exportNote,
				applyTemplate,
				openComments: onOpenComments ?? (() => {}),
			});
		};

		publishEditorActionsRef.current = publishEditorActions;
		publishEditorActions();
		editor.on("update", publishEditorActions);

		return () => {
			publishEditorActionsRef.current = null;
			editor.off("update", publishEditorActions);
		};
	}, [
		applyTemplate,
		copyText,
		editor,
		exportNote,
		noteId,
		onEditorActionsChange,
		onOpenComments,
		redo,
		undo,
	]);

	const handleEnhanceTranscript = React.useCallback(
		async (transcript: string) => {
			if (!editor || !transcript.trim()) {
				return;
			}

			try {
				if (!activeWorkspaceId) {
					return;
				}

				const enhancedNote = await requestStructuredNote({
					title,
					rawNotes: searchableText,
					transcript,
				});
				const nextDocument = structuredNoteToDocument(enhancedNote);
				const nextContent = JSON.stringify(nextDocument);
				const nextSearchableText = structuredNoteToSearchableText(enhancedNote);
				const nextTitle = shouldPreserveStructuredNoteTitle
					? title
					: enhancedNote.title.trim() || title;
				const nextNoteId = nextNoteIdRef.current ?? noteId;
				if (!nextNoteId) {
					return;
				}
				const saveSnapshot = createNoteSnapshot({
					title: nextTitle,
					content: nextContent,
					searchableText: nextSearchableText,
				});
				const requestId = latestSaveRequestIdRef.current + 1;
				latestSaveRequestIdRef.current = requestId;

				setEditorDocument(nextDocument);
				setTitle(nextTitle);
				setContent(nextContent);
				setSearchableText(nextSearchableText);
				await flushSave(nextNoteId, requestId, saveSnapshot, {
					title: nextTitle,
					content: nextContent,
					searchableText: nextSearchableText,
				});
				await setNoteTemplate({
					workspaceId: activeWorkspaceId,
					id: nextNoteId,
					templateSlug: "enhanced",
				});
				toast.success("Structured notes ready");
			} catch (error) {
				showActionError("Failed to enhance transcript", error);
				throw error;
			}
		},
		[
			activeWorkspaceId,
			noteId,
			editor,
			flushSave,
			requestStructuredNote,
			searchableText,
			setEditorDocument,
			setNoteTemplate,
			shouldPreserveStructuredNoteTitle,
			title,
		],
	);

	return {
		appendChatResponseToNote,
		content,
		editor,
		focusEditor,
		handleEnhanceTranscript,
		getNoteContext: React.useCallback(
			() => ({
				noteId: nextNoteIdRef.current ?? noteId,
				templateSlug: latestEditorStateRef.current.templateSlug,
				title: latestEditorStateRef.current.title,
				text: latestEditorStateRef.current.searchableText,
			}),
			[noteId],
		),
		noteId,
		searchableText,
		setTitle,
		templateSlug: note?.templateSlug ?? null,
		templateApplyState,
		title,
		titleTextareaRef,
		tableOfContents,
	};
};

type NotePageEditorPaneProps = {
	titleTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
	title: string;
	setTitle: (title: string) => void;
	focusEditor: () => void;
	editor: ReturnType<typeof useNotePageController>["editor"];
	templateApplyState: ReturnType<
		typeof useNotePageController
	>["templateApplyState"];
	getNoteContext: ReturnType<typeof useNotePageController>["getNoteContext"];
	appendChatResponseToNote: ReturnType<
		typeof useNotePageController
	>["appendChatResponseToNote"];
	handleEnhanceTranscript: ReturnType<
		typeof useNotePageController
	>["handleEnhanceTranscript"];
	tableOfContents: ReturnType<typeof useNotePageController>["tableOfContents"];
	autoStartTranscription: boolean;
	composerNoteContext: {
		noteId: Id<"notes"> | null;
		templateSlug: string | null;
	};
	onAutoStartTranscriptionHandled?: () => void;
	stopTranscriptionWhenMeetingEnds: boolean;
	shouldHideEmptyBodyPlaceholder: boolean;
	onOpenCommentComposer: () => void;
	isDesktopMac: boolean;
	handleTableOfContentsSelect: (anchor: TableOfContentDataItem) => void;
};

type NotePageCommentPanelState = {
	commentsOpen: boolean;
	activeCommentThreadId: Id<"noteCommentThreads"> | null;
	pendingCommentSelection: PendingNoteCommentSelection | null;
};

function useNotePageCommentPanel({
	isMobile,
	noteId,
	onCommentsOpenChange,
}: {
	isMobile: boolean;
	noteId: Id<"notes"> | null;
	onCommentsOpenChange?: (opener: (() => void) | null) => void;
}) {
	const [commentsPinned, setCommentsPinned] = React.useState(() =>
		readDesktopCommentsPanelPinnedState(noteId),
	);
	const [commentPanelState, setCommentPanelState] =
		React.useState<NotePageCommentPanelState>({
			commentsOpen: false,
			activeCommentThreadId: null,
			pendingCommentSelection: null,
		});
	const { commentsOpen, activeCommentThreadId, pendingCommentSelection } =
		commentPanelState;

	const handleOpenComments = React.useCallback(() => {
		setCommentPanelState((current) => {
			const shouldTogglePinnedDesktopComments = !isMobile && commentsPinned;

			if (shouldTogglePinnedDesktopComments) {
				return current.commentsOpen
					? {
							commentsOpen: false,
							activeCommentThreadId: null,
							pendingCommentSelection: null,
						}
					: {
							...current,
							commentsOpen: true,
						};
			}

			return {
				...current,
				commentsOpen: true,
			};
		});
	}, [commentsPinned, isMobile]);

	const handleCommentsOpenChange = React.useCallback((nextOpen: boolean) => {
		setCommentPanelState((current) =>
			nextOpen
				? {
						...current,
						commentsOpen: true,
					}
				: {
						commentsOpen: false,
						activeCommentThreadId: null,
						pendingCommentSelection: null,
					},
		);
	}, []);

	const handleCommentThreadClick = React.useCallback((threadId: string) => {
		setCommentPanelState({
			commentsOpen: true,
			activeCommentThreadId: threadId as Id<"noteCommentThreads">,
			pendingCommentSelection: null,
		});
	}, []);

	const handleActiveThreadIdChange = React.useCallback(
		(threadId: Id<"noteCommentThreads"> | null) => {
			setCommentPanelState((current) => ({
				...current,
				activeCommentThreadId: threadId,
			}));
		},
		[],
	);

	const handlePendingSelectionChange = React.useCallback(
		(selection: PendingNoteCommentSelection | null) => {
			setCommentPanelState((current) => ({
				...current,
				pendingCommentSelection: selection,
			}));
		},
		[],
	);

	const handleOpenCommentComposer = React.useCallback(
		(selection: PendingNoteCommentSelection) => {
			setCommentPanelState({
				commentsOpen: true,
				activeCommentThreadId: null,
				pendingCommentSelection: selection,
			});
		},
		[],
	);

	React.useEffect(() => {
		if (!noteId) {
			return;
		}

		const handleOpenCommentsRequest = () => {
			handleOpenComments();
		};

		window.addEventListener(
			OPEN_NOTE_COMMENTS_EVENT,
			handleOpenCommentsRequest,
		);

		return () => {
			window.removeEventListener(
				OPEN_NOTE_COMMENTS_EVENT,
				handleOpenCommentsRequest,
			);
		};
	}, [handleOpenComments, noteId]);

	React.useEffect(() => {
		if (!noteId) {
			onCommentsOpenChange?.(null);
			return;
		}

		onCommentsOpenChange?.(handleOpenComments);

		return () => {
			onCommentsOpenChange?.(null);
		};
	}, [handleOpenComments, noteId, onCommentsOpenChange]);

	React.useEffect(() => {
		const nextCommentsPinned = readDesktopCommentsPanelPinnedState(noteId);
		setCommentsPinned(nextCommentsPinned);
		setCommentPanelState({
			commentsOpen: !isMobile && nextCommentsPinned,
			activeCommentThreadId: null,
			pendingCommentSelection: null,
		});
	}, [isMobile, noteId]);

	const syncCommentThreadSelectionFromLocation = React.useCallback(() => {
		if (!noteId) {
			return;
		}

		const url = new URL(window.location.href);
		const threadId = url.searchParams.get("commentThreadId")?.trim();
		const targetNoteId = url.searchParams.get("noteId")?.trim();

		if (!threadId || targetNoteId !== String(noteId)) {
			return;
		}

		setCommentPanelState({
			commentsOpen: true,
			activeCommentThreadId: threadId as Id<"noteCommentThreads">,
			pendingCommentSelection: null,
		});
	}, [noteId]);
	const syncCommentThreadSelectionFromLocationRef = React.useRef(
		syncCommentThreadSelectionFromLocation,
	);

	React.useEffect(() => {
		syncCommentThreadSelectionFromLocationRef.current =
			syncCommentThreadSelectionFromLocation;
	}, [syncCommentThreadSelectionFromLocation]);

	React.useEffect(() => {
		syncCommentThreadSelectionFromLocation();
	}, [syncCommentThreadSelectionFromLocation]);

	React.useEffect(() => {
		const handlePopState = () => {
			syncCommentThreadSelectionFromLocationRef.current();
		};

		window.addEventListener("popstate", handlePopState);

		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, []);

	return {
		activeCommentThreadId,
		commentsOpen,
		handleActiveThreadIdChange,
		handleCommentThreadClick,
		handleCommentsOpenChange,
		handleOpenCommentComposer,
		handleOpenComments,
		handlePendingSelectionChange,
		pendingCommentSelection,
		setCommentsPinned,
	};
}

function useActiveCommentThreadMarkers({
	activeCommentThreadId,
	editor,
}: {
	activeCommentThreadId: Id<"noteCommentThreads"> | null;
	editor: ReturnType<typeof useNotePageController>["editor"];
}) {
	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const syncActiveThreadMarkers = () => {
			if (!editor.view?.dom) {
				return;
			}

			const container = editor.view.dom;
			const anchors = container.querySelectorAll<HTMLElement>(
				"[data-note-comment-thread-id]",
			);

			for (const anchor of anchors) {
				const isActive =
					!!activeCommentThreadId &&
					anchor.dataset.noteCommentThreadId === String(activeCommentThreadId);
				anchor.dataset.activeThread = isActive ? "true" : "false";
			}
		};

		syncActiveThreadMarkers();
		editor.on("update", syncActiveThreadMarkers);

		return () => {
			editor.off("update", syncActiveThreadMarkers);
		};
	}, [activeCommentThreadId, editor]);
}

const NotePageEditorPane = React.memo(function NotePageEditorPane({
	titleTextareaRef,
	title,
	setTitle,
	focusEditor,
	editor,
	templateApplyState,
	getNoteContext,
	appendChatResponseToNote,
	handleEnhanceTranscript,
	tableOfContents,
	autoStartTranscription,
	composerNoteContext,
	onAutoStartTranscriptionHandled,
	stopTranscriptionWhenMeetingEnds,
	shouldHideEmptyBodyPlaceholder,
	onOpenCommentComposer,
	isDesktopMac,
	handleTableOfContentsSelect,
}: NotePageEditorPaneProps) {
	return (
		<div className="relative flex min-h-0 w-full max-w-5xl flex-1 flex-col pt-2 md:pt-4">
			<div
				className={cn(
					NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS,
					"mx-auto flex w-full max-w-5xl flex-1",
				)}
			>
				<div className="min-w-0 flex-1">
					<div
						className={cn(
							NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS,
							"mx-auto flex w-full max-w-xl flex-1 flex-col",
						)}
					>
						<div className="flex-1 pt-4 pb-36 md:pt-8 md:pb-40">
							<div className="flex flex-col gap-6">
								<div>
									<Textarea
										ref={titleTextareaRef}
										value={title}
										onChange={(event) => setTitle(event.target.value)}
										onKeyDown={(event) => {
											if (event.key !== "Enter" || event.shiftKey) {
												return;
											}

											event.preventDefault();
											focusEditor();
										}}
										placeholder="New note"
										aria-label="Note title"
										rows={1}
										className="note-title min-h-0 flex-1 resize-none overflow-hidden rounded-none border-0 !bg-transparent p-0 text-2xl font-medium leading-tight tracking-tight shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-0 dark:!bg-transparent md:text-3xl"
									/>
								</div>

								{editor ? (
									<Tiptap editor={editor}>
										<Tiptap.Content
											className={cn(
												"min-h-[320px] text-base text-foreground",
												"[&_.ProseMirror]:min-h-[320px]",
												shouldHideEmptyBodyPlaceholder &&
													"note-editor--hide-placeholder",
												templateApplyState.isRunning && "hidden",
											)}
										/>

										<NoteSelectionMenu onComment={onOpenCommentComposer} />
									</Tiptap>
								) : null}
								{templateApplyState.isRunning ? (
									templateApplyState.streamedMarkdown.trim().length > 0 ? (
										<MarkdownStream
											className="note-streamdown min-h-[320px] text-base text-foreground"
											isAnimating
											mode="streaming"
										>
											{templateApplyState.streamedMarkdown}
										</MarkdownStream>
									) : (
										<div className="min-h-[320px] text-base text-muted-foreground">
											<ShimmerText>Thinking</ShimmerText>
										</div>
									)
								) : null}
							</div>
						</div>

						<div className="sticky bottom-0 z-10 mt-auto h-0">
							<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
								<div className="pointer-events-auto relative mx-auto w-full max-w-xl">
									<NoteComposer
										autoStartTranscription={autoStartTranscription}
										desktopSafeTop={isDesktopMac}
										getNoteContext={getNoteContext}
										noteContext={composerNoteContext}
										onAutoStartTranscriptionHandled={
											onAutoStartTranscriptionHandled
										}
										onAddMessageToNote={appendChatResponseToNote}
										onEnhanceTranscript={handleEnhanceTranscript}
										stopTranscriptionWhenMeetingEnds={
											stopTranscriptionWhenMeetingEnds
										}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="pointer-events-none absolute top-0 right-0 hidden h-full lg:block">
				<div className="pointer-events-auto sticky top-1/2 -translate-y-1/2">
					<NoteTableOfContents
						anchors={tableOfContents}
						onSelect={handleTableOfContentsSelect}
					/>
				</div>
			</div>
		</div>
	);
});

function NotePageContent({
	controller,
	autoStartTranscription,
	composerNoteContext,
	onAutoStartTranscriptionHandled,
	stopTranscriptionWhenMeetingEnds,
	scrollParentRef,
	shouldHideEmptyBodyPlaceholder,
	onOpenCommentComposer,
	commentsOpen,
	activeCommentThreadId,
	currentUser,
	isDesktopMac,
	handleCommentsOpenChange,
	setCommentsPinned,
	onActiveThreadIdChange,
	pendingCommentSelection,
	onPendingSelectionChange,
	handleTableOfContentsSelect,
}: {
	controller: ReturnType<typeof useNotePageController>;
	autoStartTranscription: boolean;
	composerNoteContext: {
		noteId: Id<"notes"> | null;
		templateSlug: string | null;
	};
	onAutoStartTranscriptionHandled?: () => void;
	stopTranscriptionWhenMeetingEnds: boolean;
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
	shouldHideEmptyBodyPlaceholder: boolean;
	onOpenCommentComposer: () => void;
	commentsOpen: boolean;
	activeCommentThreadId: Id<"noteCommentThreads"> | null;
	currentUser: NotePageCurrentUser;
	isDesktopMac: boolean;
	handleCommentsOpenChange: (nextOpen: boolean) => void;
	setCommentsPinned: (isPinned: boolean) => void;
	onActiveThreadIdChange: (threadId: Id<"noteCommentThreads"> | null) => void;
	pendingCommentSelection: PendingNoteCommentSelection | null;
	onPendingSelectionChange: (
		selection: PendingNoteCommentSelection | null,
	) => void;
	handleTableOfContentsSelect: (anchor: TableOfContentDataItem) => void;
}) {
	void scrollParentRef;

	return (
		<div className="flex min-h-0 flex-1 justify-center px-4 md:px-6">
			<NotePageEditorPane
				titleTextareaRef={controller.titleTextareaRef}
				title={controller.title}
				setTitle={controller.setTitle}
				focusEditor={controller.focusEditor}
				editor={controller.editor}
				templateApplyState={controller.templateApplyState}
				getNoteContext={controller.getNoteContext}
				appendChatResponseToNote={controller.appendChatResponseToNote}
				handleEnhanceTranscript={controller.handleEnhanceTranscript}
				tableOfContents={controller.tableOfContents}
				autoStartTranscription={autoStartTranscription}
				composerNoteContext={composerNoteContext}
				onAutoStartTranscriptionHandled={onAutoStartTranscriptionHandled}
				stopTranscriptionWhenMeetingEnds={stopTranscriptionWhenMeetingEnds}
				shouldHideEmptyBodyPlaceholder={shouldHideEmptyBodyPlaceholder}
				onOpenCommentComposer={onOpenCommentComposer}
				isDesktopMac={isDesktopMac}
				handleTableOfContentsSelect={handleTableOfContentsSelect}
			/>

			<NoteCommentsSheet
				noteId={controller.noteId}
				noteContent={controller.content}
				editor={controller.editor}
				currentUser={currentUser}
				open={commentsOpen}
				desktopSafeTop={isDesktopMac}
				onOpenChange={handleCommentsOpenChange}
				onPinnedChange={setCommentsPinned}
				activeThreadId={activeCommentThreadId}
				onActiveThreadIdChange={onActiveThreadIdChange}
				pendingSelection={pendingCommentSelection}
				onPendingSelectionChange={onPendingSelectionChange}
			/>
		</div>
	);
}

function NoteSearchBar({
	inputRef,
	query,
	onQueryChange,
	matchCount,
	matchIndex,
	onPrevious,
	onNext,
	onClose,
	onKeyDown,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
	matchIndex: number;
	onPrevious: () => void;
	onNext: () => void;
	onClose: () => void;
	onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}) {
	const matchLabel =
		query.trim().length === 0
			? ""
			: matchCount > 0
				? `${matchIndex + 1}/${matchCount}`
				: "No results";

	return (
		<div className="fixed top-20 right-4 left-4 z-50 mx-auto flex max-w-md items-center gap-1 rounded-lg border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur md:right-8 md:left-auto md:w-80">
			<Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
			<Input
				ref={inputRef}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Search note"
				aria-label="Search note"
				className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
			/>
			<span
				className={cn(
					"min-w-14 shrink-0 text-right text-xs tabular-nums",
					matchCount === 0 && query.trim().length > 0
						? "text-muted-foreground"
						: "text-foreground/70",
				)}
			>
				{matchLabel}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Previous note match"
				onClick={onPrevious}
			>
				<ChevronUp className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Next note match"
				onClick={onNext}
			>
				<ChevronDown className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				aria-label="Close note search"
				onClick={onClose}
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}

// oxlint-disable-next-line react-doctor/no-giant-component -- Page-level orchestrator coordinates editor, comments, search, and transcription.
export function NotePage({
	autoStartTranscription = false,
	currentUser = {
		name: "Unknown user",
		email: "",
		avatar: "",
	},
	noteId,
	note,
	externalTitle,
	onAutoStartTranscriptionHandled,
	onCommentsOpenChange,
	isDesktopMac = false,
	onTitleChange,
	onEditorActionsChange,
	scrollParentRef,
	stopTranscriptionWhenMeetingEnds = false,
}: {
	autoStartTranscription?: boolean;
	currentUser?: NotePageCurrentUser;
	noteId: Id<"notes"> | null;
	note?: Doc<"notes"> | null;
	externalTitle?: string;
	onAutoStartTranscriptionHandled?: () => void;
	onCommentsOpenChange?: (opener: (() => void) | null) => void;
	isDesktopMac?: boolean;
	onTitleChange?: (title: string) => void;
	onEditorActionsChange?: (actions: NoteEditorActions | null) => void;
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
	stopTranscriptionWhenMeetingEnds?: boolean;
}) {
	const isMobile = useIsMobile();
	const commentPanel = useNotePageCommentPanel({
		isMobile,
		noteId,
		onCommentsOpenChange,
	});
	const controller = useNotePageController({
		noteId,
		note,
		externalTitle,
		onTitleChange,
		onEditorActionsChange,
		scrollParentRef,
		onCommentThreadClick: commentPanel.handleCommentThreadClick,
		onOpenComments: commentPanel.handleOpenComments,
	});
	const composerNoteContext = React.useMemo(
		() => ({
			noteId: controller.noteId,
			templateSlug: controller.templateSlug,
		}),
		[controller.noteId, controller.templateSlug],
	);
	const shouldHideEmptyBodyPlaceholder =
		!controller.title.trim() && !controller.searchableText.trim();
	const noteSearchInputRef = React.useRef<HTMLInputElement | null>(null);
	const [noteSearchOpen, setNoteSearchOpen] = React.useState(false);
	const [noteSearchQuery, setNoteSearchQuery] = React.useState("");
	const [noteSearchIndex, setNoteSearchIndex] = React.useState(0);
	const noteSearchRoot = React.useCallback(
		() => document.querySelector<HTMLElement>(".note-tiptap"),
		[],
	);
	const noteSearchRanges = React.useMemo(() => {
		void controller.searchableText;
		const root = noteSearchRoot();

		if (!root) {
			return [];
		}

		return createTextMatchRanges({
			element: root,
			query: noteSearchQuery,
		});
	}, [controller.searchableText, noteSearchQuery, noteSearchRoot]);
	const activeNoteSearchRange =
		noteSearchRanges.length > 0
			? noteSearchRanges[Math.min(noteSearchIndex, noteSearchRanges.length - 1)]
			: null;
	const handleTableOfContentsSelect = React.useCallback(
		(anchor: TableOfContentDataItem) => {
			const topOffset = 72;
			const scrollParent = scrollParentRef?.current ?? window;

			if (scrollParent instanceof HTMLElement) {
				const nextTop =
					anchor.dom.getBoundingClientRect().top -
					scrollParent.getBoundingClientRect().top +
					scrollParent.scrollTop -
					topOffset;

				scrollParent.scrollTo({
					top: Math.max(0, nextTop),
					behavior: "smooth",
				});
				return;
			}

			window.scrollTo({
				top: Math.max(
					0,
					anchor.dom.getBoundingClientRect().top + window.scrollY - topOffset,
				),
				behavior: "smooth",
			});
		},
		[scrollParentRef],
	);
	const handleOpenCommentComposer = React.useCallback(() => {
		if (!controller.editor) {
			return;
		}

		const { from, to, empty } = controller.editor.state.selection;

		if (empty || from === to) {
			return;
		}

		const text = controller.editor.state.doc.textBetween(from, to, "\n").trim();

		if (!text) {
			return;
		}

		commentPanel.handleOpenCommentComposer({
			from,
			to,
			text,
		});
	}, [commentPanel, controller.editor]);

	useActiveCommentThreadMarkers({
		activeCommentThreadId: commentPanel.activeCommentThreadId,
		editor: controller.editor,
	});
	React.useEffect(() => {
		if (!noteSearchOpen) {
			return;
		}

		requestAnimationFrame(() => {
			noteSearchInputRef.current?.focus();
			noteSearchInputRef.current?.select();
		});
	}, [noteSearchOpen]);
	React.useEffect(() => {
		if (noteSearchIndex < noteSearchRanges.length) {
			return;
		}

		setNoteSearchIndex(0);
	}, [noteSearchIndex, noteSearchRanges.length]);
	React.useEffect(() => {
		if (!activeNoteSearchRange || !noteSearchOpen) {
			return;
		}

		activeNoteSearchRange.startContainer.parentElement?.scrollIntoView?.({
			block: "center",
			behavior: "smooth",
		});
	}, [activeNoteSearchRange, noteSearchOpen]);
	React.useEffect(() => {
		const highlightRegistry =
			typeof CSS === "undefined"
				? undefined
				: (CSS as CssWithHighlights).highlights;

		if (
			!noteSearchOpen ||
			!noteSearchQuery.trim() ||
			!highlightRegistry ||
			typeof Highlight === "undefined"
		) {
			highlightRegistry?.delete(NOTE_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry?.delete(NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
			return;
		}

		ensureCssHighlightStyles();

		const activeRangeIndex = Math.min(
			noteSearchIndex,
			Math.max(0, noteSearchRanges.length - 1),
		);
		const matchRanges = noteSearchRanges.filter(
			(_range, index) => index !== activeRangeIndex,
		);
		const activeRanges = noteSearchRanges[activeRangeIndex]
			? [noteSearchRanges[activeRangeIndex]]
			: [];

		highlightRegistry.set(
			NOTE_SEARCH_MATCH_HIGHLIGHT,
			new Highlight(...matchRanges),
		);
		highlightRegistry.set(
			NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT,
			new Highlight(...activeRanges),
		);

		return () => {
			highlightRegistry.delete(NOTE_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry.delete(NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
		};
	}, [noteSearchIndex, noteSearchOpen, noteSearchQuery, noteSearchRanges]);
	React.useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key.toLowerCase() !== "f" && event.code !== "KeyF")
			) {
				return;
			}

			event.preventDefault();
			if (noteSearchOpen) {
				requestAnimationFrame(() => {
					noteSearchInputRef.current?.focus();
					noteSearchInputRef.current?.select();
				});
			}
			setNoteSearchOpen(true);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [noteSearchOpen]);
	const handleNoteSearchPrevious = React.useCallback(() => {
		setNoteSearchIndex((current) =>
			noteSearchRanges.length === 0
				? 0
				: (current - 1 + noteSearchRanges.length) % noteSearchRanges.length,
		);
	}, [noteSearchRanges.length]);
	const handleNoteSearchNext = React.useCallback(() => {
		setNoteSearchIndex((current) =>
			noteSearchRanges.length === 0
				? 0
				: (current + 1) % noteSearchRanges.length,
		);
	}, [noteSearchRanges.length]);
	const handleNoteSearchKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setNoteSearchOpen(false);
				return;
			}

			if (event.key !== "Enter") {
				return;
			}

			event.preventDefault();
			if (event.shiftKey) {
				handleNoteSearchPrevious();
				return;
			}

			handleNoteSearchNext();
		},
		[handleNoteSearchNext, handleNoteSearchPrevious],
	);

	return (
		<>
			{noteSearchOpen ? (
				<NoteSearchBar
					inputRef={noteSearchInputRef}
					query={noteSearchQuery}
					onQueryChange={(value) => {
						setNoteSearchQuery(value);
						setNoteSearchIndex(0);
					}}
					matchCount={noteSearchRanges.length}
					matchIndex={noteSearchRanges.length > 0 ? noteSearchIndex : -1}
					onPrevious={handleNoteSearchPrevious}
					onNext={handleNoteSearchNext}
					onClose={() => setNoteSearchOpen(false)}
					onKeyDown={handleNoteSearchKeyDown}
				/>
			) : null}
			<NotePageContent
				controller={controller}
				autoStartTranscription={autoStartTranscription}
				composerNoteContext={composerNoteContext}
				onAutoStartTranscriptionHandled={onAutoStartTranscriptionHandled}
				stopTranscriptionWhenMeetingEnds={stopTranscriptionWhenMeetingEnds}
				scrollParentRef={scrollParentRef}
				shouldHideEmptyBodyPlaceholder={shouldHideEmptyBodyPlaceholder}
				onOpenCommentComposer={handleOpenCommentComposer}
				commentsOpen={commentPanel.commentsOpen}
				activeCommentThreadId={commentPanel.activeCommentThreadId}
				currentUser={currentUser}
				isDesktopMac={isDesktopMac}
				handleCommentsOpenChange={commentPanel.handleCommentsOpenChange}
				setCommentsPinned={commentPanel.setCommentsPinned}
				onActiveThreadIdChange={commentPanel.handleActiveThreadIdChange}
				pendingCommentSelection={commentPanel.pendingCommentSelection}
				onPendingSelectionChange={commentPanel.handlePendingSelectionChange}
				handleTableOfContentsSelect={handleTableOfContentsSelect}
			/>
		</>
	);
}
