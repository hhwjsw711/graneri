import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET } from "../src/components/layout/composer-dock";
import { NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS } from "../src/components/note/note-layout";

const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const noteCommentsSheetMock = vi.fn();

const chainRunMock = vi.fn();
const editorChain = {
	focus: () => editorChain,
	undo: () => editorChain,
	redo: () => editorChain,
	insertContent: () => editorChain,
	run: chainRunMock,
};

const mockEditor = {
	setEditable: vi.fn(),
	on: vi.fn(),
	off: vi.fn(),
	state: {
		schema: {},
	},
	commands: {
		setContent: vi.fn(),
	},
	getJSON: vi.fn(() => ({
		type: "doc",
		content: [{ type: "paragraph" }],
	})),
	getText: vi.fn(() => ""),
	getMarkdown: vi.fn(() => ""),
	getHTML: vi.fn(() => "<p></p>"),
	can: () => ({
		undo: () => false,
		redo: () => false,
	}),
	chain: () => editorChain,
};
let latestEditorOptions:
	| {
			autofocus?: boolean | "start" | "end" | "all";
			onUpdate?: ({ editor }: { editor: typeof mockEditor }) => void;
	  }
	| undefined;
const saveNoteMutationMock = vi.fn().mockResolvedValue(undefined);
const setNoteTemplateMutationMock = vi.fn().mockResolvedValue(undefined);
let mutationHookCallCount = 0;

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
}));

vi.mock("@workspace/platform/desktop", () => ({
	isDesktopRuntime: () => true,
	saveDesktopTextFile: vi.fn(),
}));

vi.mock("@tiptap/react", () => ({
	Tiptap: Object.assign(
		({ children }: React.PropsWithChildren) => <>{children}</>,
		{
			Content: ({ className }: { className?: string }) => (
				<div data-testid="editor-content" className={className} />
			),
		},
	),
	EditorContent: ({ className }: { className?: string }) => (
		<div data-testid="editor-content" className={className} />
	),
	useEditor: (options: typeof latestEditorOptions) => {
		latestEditorOptions = options;
		return mockEditor;
	},
}));

vi.mock("../src/hooks/use-active-workspace", () => ({
	useActiveWorkspaceId: () => "workspace-1",
}));

vi.mock("../src/lib/note-editor", () => ({
	EMPTY_DOCUMENT: {
		type: "doc",
		content: [{ type: "paragraph" }],
	},
	EMPTY_DOCUMENT_STRING: JSON.stringify({
		type: "doc",
		content: [{ type: "paragraph" }],
	}),
	createNoteEditorExtensions: () => [],
	handleMarkdownPaste: () => false,
	looksLikeMarkdown: () => false,
	normalizePastedPlainText: (text: string) => text,
	normalizePastedSlice: (slice: unknown) => slice,
	parseMarkdownToDocument: () => ({
		toJSON: () => ({
			content: [],
		}),
	}),
	parseStoredNoteContent: () => ({
		type: "doc",
		content: [{ type: "paragraph" }],
	}),
}));

vi.mock("../src/components/note/note-composer", () => ({
	NoteComposer: (_props: unknown) => <div data-testid="note-composer" />,
}));

vi.mock("../src/components/note/note-comments-sheet", () => ({
	NoteCommentsSheet: (props: unknown) => {
		noteCommentsSheetMock(props);
		return <div data-testid="note-comments-sheet" />;
	},
}));

vi.mock("../src/components/note/note-selection-menu", () => ({
	NoteSelectionMenu: (_props: unknown) => (
		<div data-testid="note-selection-menu" />
	),
}));

vi.mock("../src/components/note/share-note", () => ({
	writeRichTextToClipboard: vi.fn(),
}));

vi.mock("streamdown", () => ({
	Streamdown: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("../src/components/ai-elements/shimmer", () => ({
	ShimmerText: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe("NotePage", () => {
	beforeEach(() => {
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(performance.now()), 0),
		);
		vi.stubGlobal("cancelAnimationFrame", (id: number) =>
			window.clearTimeout(id),
		);

		useQueryMock.mockReturnValue({
			_id: "note-1",
			title: "",
			content: JSON.stringify({
				type: "doc",
				content: [{ type: "paragraph" }],
			}),
			searchableText: "",
			templateSlug: null,
			calendarEventKey: undefined,
		});

		latestEditorOptions = undefined;
		mutationHookCallCount = 0;
		saveNoteMutationMock.mockClear();
		setNoteTemplateMutationMock.mockClear();
		mockEditor.setEditable.mockClear();
		mockEditor.on.mockClear();
		mockEditor.off.mockClear();
		mockEditor.commands.setContent.mockClear();
		mockEditor.getJSON.mockReturnValue({
			type: "doc",
			content: [{ type: "paragraph" }],
		});
		mockEditor.getText.mockReturnValue("");
		mockEditor.getMarkdown.mockReturnValue("");
		mockEditor.getHTML.mockReturnValue("<p></p>");

		useMutationMock.mockImplementation(() => {
			mutationHookCallCount += 1;

			if (mutationHookCallCount % 2 === 1) {
				return saveNoteMutationMock;
			}

			return Object.assign(setNoteTemplateMutationMock, {
				withOptimisticUpdate: () => setNoteTemplateMutationMock,
			});
		});
		noteCommentsSheetMock.mockClear();
		window.localStorage.clear();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("hides the body placeholder for a new empty note", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "",
						content: JSON.stringify({
							type: "doc",
							content: [{ type: "paragraph" }],
						}),
						searchableText: "",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		expect(screen.getByTestId("editor-content").className).toContain(
			"note-editor--hide-placeholder",
		);
	});

	it("moves focus into the body when pressing enter in the title", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "",
						content: JSON.stringify({
							type: "doc",
							content: [{ type: "paragraph" }],
						}),
						searchableText: "",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		const titleInput = screen.getByLabelText("Note title");
		chainRunMock.mockClear();
		titleInput.focus();

		titleInput.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				key: "Enter",
			}),
		);

		expect(chainRunMock).toHaveBeenCalled();
	});

	it("does not autofocus the editor to the end when opening a note", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "Long note",
						content: JSON.stringify({
							type: "doc",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "First paragraph" }],
								},
							],
						}),
						searchableText: "First paragraph",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		expect(latestEditorOptions?.autofocus).toBeUndefined();
	});

	it("keeps the closed note composer dock aligned with the chat baseline", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "",
						content: JSON.stringify({
							type: "doc",
							content: [{ type: "paragraph" }],
						}),
						searchableText: "",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		const composer = screen.getByTestId("note-composer");
		const dockContainer = composer.parentElement?.parentElement;
		const contentWrapper =
			screen.getByTestId("editor-content").parentElement?.parentElement;

		expect(dockContainer).not.toBeNull();
		expect(dockContainer?.className).toContain(
			`pb-[${COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET}px]`,
		);
		expect(contentWrapper?.className).toContain("pb-36");
		expect(contentWrapper?.className).toContain("md:pb-40");
	});

	it("uses the desktop viewport min-height contract for short notes", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "Ok",
						content: JSON.stringify({
							type: "doc",
							content: [{ type: "paragraph" }],
						}),
						searchableText: "",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		const viewportColumns = Array.from(document.querySelectorAll("div")).filter(
			(element) => element.className.includes("max-w-xl"),
		);

		expect(
			viewportColumns.some((element) =>
				element.className.includes(NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS),
			),
		).toBe(true);
	});

	it("clears the previous note title while the next note is still loading", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		const { rerender } = render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "First note",
						content: JSON.stringify({
							type: "doc",
							content: [{ type: "paragraph" }],
						}),
						searchableText: "",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		await waitFor(() =>
			expect(
				(screen.getByLabelText("Note title") as HTMLTextAreaElement).value,
			).toBe("First note"),
		);

		rerender(<NotePage noteId={"note-2" as never} note={undefined} />);

		await waitFor(() =>
			expect(
				(screen.getByLabelText("Note title") as HTMLTextAreaElement).value,
			).toBe(""),
		);
	});

	it("passes hydrated note content to the comments sheet", async () => {
		const { NotePage } = await import("../src/components/note/note-page");
		const noteContent = JSON.stringify({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Anchored comment text" }],
				},
			],
		});

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "Commented note",
						content: noteContent,
						searchableText: "Anchored comment text",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		await waitFor(() => {
			const latestCall =
				noteCommentsSheetMock.mock.calls[
					noteCommentsSheetMock.mock.calls.length - 1
				];
			expect(latestCall?.[0]).toMatchObject({ noteContent });
		});
	});

	it("saves an empty title after clearing it", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "Draft title",
						content: JSON.stringify({
							type: "doc",
							content: [{ type: "paragraph" }],
						}),
						searchableText: "",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		const titleInput = screen.getByLabelText("Note title");
		await waitFor(() =>
			expect((titleInput as HTMLTextAreaElement).value).toBe("Draft title"),
		);

		saveNoteMutationMock.mockClear();
		fireEvent.change(titleInput, {
			target: { value: "" },
		});

		await waitFor(() =>
			expect(saveNoteMutationMock).toHaveBeenCalledWith({
				workspaceId: "workspace-1",
				id: "note-1",
				title: "",
				content: JSON.stringify({
					type: "doc",
					content: [{ type: "paragraph" }],
				}),
				searchableText: "",
			}),
		);
	});

	it("saves an empty body after clearing the editor", async () => {
		const { NotePage } = await import("../src/components/note/note-page");

		render(
			<NotePage
				noteId={"note-1" as never}
				note={
					{
						_id: "note-1",
						title: "",
						content: JSON.stringify({
							type: "doc",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Body text" }],
								},
							],
						}),
						searchableText: "Body text",
						templateSlug: null,
						calendarEventKey: undefined,
					} as never
				}
			/>,
		);

		await waitFor(() =>
			expect(latestEditorOptions?.onUpdate).toBeTypeOf("function"),
		);

		saveNoteMutationMock.mockClear();
		mockEditor.getJSON.mockReturnValue({
			type: "doc",
			content: [{ type: "paragraph" }],
		});
		mockEditor.getText.mockReturnValue("");

		act(() => {
			latestEditorOptions?.onUpdate?.({ editor: mockEditor });
		});

		await waitFor(() =>
			expect(saveNoteMutationMock).toHaveBeenCalledWith({
				workspaceId: "workspace-1",
				id: "note-1",
				title: "",
				content: JSON.stringify({
					type: "doc",
					content: [{ type: "paragraph" }],
				}),
				searchableText: "",
			}),
		);
	});

	it("keeps pinned comments note-scoped when switching notes", async () => {
		window.localStorage.setItem(
			"opengran.note-comments-panel-pinned.desktop.note:note-1",
			"true",
		);

		const { NotePage } = await import("../src/components/note/note-page");
		const firstNote = {
			_id: "note-1",
			title: "",
			content: JSON.stringify({
				type: "doc",
				content: [{ type: "paragraph" }],
			}),
			searchableText: "",
			templateSlug: null,
			calendarEventKey: undefined,
		} as never;
		const secondNote = {
			...firstNote,
			_id: "note-2",
		} as never;

		const { rerender } = render(
			<NotePage noteId={"note-1" as never} note={firstNote} />,
		);

		await waitFor(() => {
			const latestCall =
				noteCommentsSheetMock.mock.calls[
					noteCommentsSheetMock.mock.calls.length - 1
				];
			expect(latestCall?.[0]).toMatchObject({ open: true });
		});

		rerender(<NotePage noteId={"note-2" as never} note={secondNote} />);

		await waitFor(() => {
			const latestCall =
				noteCommentsSheetMock.mock.calls[
					noteCommentsSheetMock.mock.calls.length - 1
				];
			expect(latestCall?.[0]).toMatchObject({ open: false });
		});

		rerender(<NotePage noteId={"note-1" as never} note={firstNote} />);

		await waitFor(() => {
			const latestCall =
				noteCommentsSheetMock.mock.calls[
					noteCommentsSheetMock.mock.calls.length - 1
				];
			expect(latestCall?.[0]).toMatchObject({ open: true });
		});
	});
});
