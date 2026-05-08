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
import { COMPOSER_OVERLAY_FOOTER_PADDING } from "../src/components/layout/composer-dock";
import { ActiveWorkspaceProvider } from "../src/hooks/use-active-workspace";

const useChatMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const useConvexMock = vi.fn();
const convexQueryMock = vi.fn();
const useNoteTranscriptSessionMock = vi.fn();
const useTranscriptionSessionMock = vi.fn();
const useSidebarShellMock = vi.fn();
const useSidebarRightMock = vi.fn();
const useDockedPanelWidthsMock = vi.fn();
const convexTokenMock = vi.fn();
const configureTranscriptionSessionMock = vi.fn();
const regenerateMock = vi.fn();
const scrollToBottomMock = vi.fn();
const useStickyScrollToBottomMock = vi.fn();
const functionNameSymbol = Symbol.for("functionName");

const getFunctionName = (query: unknown) =>
	typeof query === "object" && query !== null
		? (query as Record<symbol, string | undefined>)[functionNameSymbol]
		: undefined;

const createNoteChats = (title = "New chat") => [
	{
		_id: "chat-doc-1",
		_creationTime: 1,
		chatId: "chat-1",
		createdAt: 1,
		title,
		updatedAt: 1,
	},
];

const createNoteComposerQueryMock = ({
	noteChats = createNoteChats(),
	currentChatSession = {
		title: "New chat",
	},
	recipes = [],
	userPreferences = {
		transcriptionLanguage: null,
	},
}: {
	noteChats?: unknown;
	currentChatSession?: unknown;
	recipes?: unknown;
	userPreferences?: unknown;
} = {}) => {
	return (query: unknown) => {
		const functionName = getFunctionName(query);

		if (functionName === "chats:listForNote") {
			return noteChats;
		}

		if (functionName === "chats:getSession") {
			return currentChatSession;
		}

		if (functionName === "recipes:list") {
			return recipes;
		}

		if (functionName === "userPreferences:get") {
			return userPreferences;
		}

		return undefined;
	};
};

const originalUseQueryMockImplementation =
	useQueryMock.mockImplementation.bind(useQueryMock);

useQueryMock.mockImplementation = ((implementation) =>
	originalUseQueryMockImplementation((query: unknown, ...args: unknown[]) => {
		if (implementation.length === 0) {
			const legacyResults = [
				implementation(),
				implementation(),
				implementation(),
				implementation(),
				implementation(),
			];
			const functionName = getFunctionName(query);

			if (functionName === "chats:listForNote") {
				return legacyResults[0];
			}

			if (functionName === "chats:getSession") {
				return legacyResults[2];
			}

			if (functionName === "recipes:list") {
				return legacyResults[3];
			}

			if (functionName === "userPreferences:get") {
				return legacyResults[4];
			}
		}

		return implementation(query, ...args);
	})) as typeof useQueryMock.mockImplementation;

vi.mock("@ai-sdk/react", () => ({
	useChat: useChatMock,
}));

vi.mock("ai", () => ({
	DefaultChatTransport: class DefaultChatTransport {},
}));

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
	useConvex: useConvexMock,
}));

vi.mock("@workspace/ui/components/button", () => ({
	Button: ({
		children,
		...props
	}: React.PropsWithChildren<
		React.ButtonHTMLAttributes<HTMLButtonElement>
	>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@workspace/ui/components/card", () => ({
	Card: ({
		children,
		...props
	}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
		<div {...props}>{children}</div>
	),
	CardContent: ({
		children,
		...props
	}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
		<div {...props}>{children}</div>
	),
	CardHeader: ({
		children,
		...props
	}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
		<div {...props}>{children}</div>
	),
}));

vi.mock("@workspace/ui/components/dropdown-menu", () => {
	const Div = ({
		asChild: _asChild,
		children,
		...props
	}: React.PropsWithChildren<
		React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
	>) => <div {...props}>{children}</div>;
	const Item = ({
		asChild: _asChild,
		onClick,
		onSelect,
		children,
		...props
	}: React.PropsWithChildren<
		React.ButtonHTMLAttributes<HTMLButtonElement> & {
			asChild?: boolean;
			onSelect?: (event: Event) => void;
		}
	>) => (
		<button
			type="button"
			{...props}
			onClick={(event) => {
				onClick?.(event);
				onSelect?.(event.nativeEvent);
			}}
		>
			{children}
		</button>
	);
	const CheckboxItem = ({
		checked: _checked,
		onCheckedChange,
		onClick,
		children,
		...props
	}: React.PropsWithChildren<
		React.ButtonHTMLAttributes<HTMLButtonElement> & {
			checked?: boolean;
			onCheckedChange?: (checked: boolean) => void;
		}
	>) => (
		<button
			type="button"
			{...props}
			onClick={(event) => {
				onClick?.(event);
				onCheckedChange?.(true);
			}}
		>
			{children}
		</button>
	);

	return {
		DropdownMenu: Div,
		DropdownMenuCheckboxItem: CheckboxItem,
		DropdownMenuContent: Div,
		DropdownMenuGroup: Div,
		DropdownMenuItem: Item,
		DropdownMenuLabel: Div,
		DropdownMenuTrigger: Div,
	};
});

vi.mock("@workspace/ui/components/sidebar", () => ({
	Sidebar: ({
		children,
		...props
	}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
		<div {...props}>{children}</div>
	),
	useDockedPanelWidths: useDockedPanelWidthsMock,
	useSidebarRight: useSidebarRightMock,
	useSidebarShell: useSidebarShellMock,
}));

vi.mock("@workspace/ui/components/textarea", () => ({
	Textarea: ({
		children,
		ref,
		...props
	}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
		ref?: React.Ref<HTMLTextAreaElement>;
	}) => (
		<textarea ref={ref} {...props}>
			{children}
		</textarea>
	),
}));

vi.mock("@workspace/ui/components/tooltip", () => {
	const Div = ({
		asChild: _asChild,
		children,
		...props
	}: React.PropsWithChildren<
		React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
	>) => <div {...props}>{children}</div>;

	return {
		Tooltip: Div,
		TooltipContent: Div,
		TooltipTrigger: Div,
	};
});

vi.mock("@workspace/ui/lib/utils", () => ({
	cn: (...values: Array<string | false | null | undefined>) =>
		values.filter(Boolean).join(" "),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("streamdown", () => ({
	Streamdown: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("../src/components/ai-elements/shimmer", () => ({
	ShimmerText: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("../src/components/ai-elements/speech-input", () => ({
	SpeechInput: () => <button data-testid="speech-input" type="button" />,
}));

vi.mock("../src/hooks/use-note-transcript-session", () => ({
	useNoteTranscriptSession: useNoteTranscriptSessionMock,
}));

vi.mock("../src/hooks/use-transcription-session", () => ({
	useTranscriptionSession: useTranscriptionSessionMock,
}));

vi.mock("../src/hooks/use-sticky-scroll-to-bottom", () => ({
	useStickyScrollToBottom: () => useStickyScrollToBottomMock(),
}));

vi.mock("../src/lib/auth-client", () => ({
	authClient: {
		convex: {
			token: convexTokenMock,
		},
	},
}));

vi.mock("../src/lib/transcription-session-manager", () => ({
	transcriptionSessionManager: {
		controller: {
			configure: configureTranscriptionSessionMock,
		},
	},
}));

describe("NoteComposer", () => {
	beforeEach(async () => {
		const { clearCachedConvexToken } = await import("../src/lib/convex-token");
		clearCachedConvexToken();
		window.localStorage.clear();

		useSidebarShellMock.mockReturnValue({
			isMobile: false,
			state: "expanded",
		});
		useSidebarRightMock.mockReturnValue({
			rightMode: "sidebar",
			rightOpen: false,
			rightOpenMobile: false,
			setHasRightSidebar: vi.fn(),
			setRightMode: vi.fn(),
			setRightOpen: vi.fn(),
			setRightOpenMobile: vi.fn(),
			setRightSidebarWidthMobileOverride: vi.fn(),
			setRightSidebarWidthOverride: vi.fn(),
		});
		useDockedPanelWidthsMock.mockReturnValue({
			rightInsetPanelWidth: null,
		});

		useQueryMock.mockImplementation(createNoteComposerQueryMock());
		useConvexMock.mockReturnValue({
			query: convexQueryMock,
		});
		convexQueryMock.mockResolvedValue([]);
		configureTranscriptionSessionMock.mockReset();
		configureTranscriptionSessionMock.mockImplementation(() => {});
		useTranscriptionSessionMock.mockReset();
		useTranscriptionSessionMock.mockReturnValue({
			isConnecting: false,
			isListening: false,
			scopeKey: null,
		});
		useMutationMock.mockReturnValue(vi.fn().mockResolvedValue(undefined));
		regenerateMock.mockReset();
		scrollToBottomMock.mockReset();
		useStickyScrollToBottomMock.mockReturnValue({
			containerRef: {
				current: null,
			},
			isAtBottom: true,
			scrollToBottom: scrollToBottomMock,
		});
		convexTokenMock.mockResolvedValue({
			data: {
				token: null,
			},
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [],
			exportTranscript: "",
			fullTranscript: "",
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "idle",
			},
			transcriptStartedAt: null,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});
	});

	afterEach(() => {
		window.localStorage.clear();
		cleanup();
	});

	it("shows only the send button in the composer actions when empty", async () => {
		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(
			screen.queryByRole("button", { name: "Add attachments" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Audio visualization" }),
		).toBeNull();
	});

	it("shows a stop button while streaming and stops the response", async () => {
		const stop = vi.fn();
		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "msg-1",
					role: "assistant",
					parts: [{ type: "text", text: "Working..." }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "streaming",
			stop,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Stop streaming" }));

		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("shows a floating scroll button when the note chat is away from the bottom", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useStickyScrollToBottomMock.mockReturnValue({
			containerRef: {
				current: null,
			},
			isAtBottom: false,
			scrollToBottom: scrollToBottomMock,
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Scroll to latest messages",
			}),
		);

		expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
	});

	it("keeps streaming assistant thinking aligned to the left", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "assistant-streaming",
					role: "assistant",
					parts: [],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "streaming",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		await waitFor(() => {
			expect(screen.getByText("Thinking")).toBeDefined();
		});

		expect(
			screen.getByText("Thinking").closest(".flex.w-full")?.className,
		).toContain("justify-start");
	});

	it("keeps the full chat title accessible from the selector trigger", async () => {
		const fullTitle = "New chat for the quarterly planning table follow-up";
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: fullTitle,
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: fullTitle,
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		const selector = await screen.findByRole("combobox", {
			name: "Select note chat",
		});

		expect(selector.getAttribute("title")).toBe(fullTitle);
	});

	it("keeps rendering the desktop sidebar chat header", async () => {
		const { NoteChatHeader } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteChatHeader
				chatTitle="New chat"
				currentChatId="chat-1"
				groupedNoteChats={{ previous: [], today: [] }}
				handlePrefetchNoteChat={vi.fn()}
				noteChats={[]}
				onHideChat={vi.fn()}
				onNewChat={vi.fn()}
				onSelectChat={vi.fn()}
				onSelectInlinePresentation={vi.fn()}
				onSelectRightPresentation={vi.fn()}
				presentationMode="sidebar"
				isMobile={false}
				desktopSafeTop
				sidebarCompact
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Switch chat mode" }),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Hide chat" })).toBeDefined();
		expect(screen.getByRole("button", { name: "New chat" })).toBeDefined();
	});

	it("preconfigures live transcription for the active note scope", async () => {
		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: "note-1:capture",
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [],
			exportTranscript: "",
			fullTranscript: "",
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onUtterance: vi.fn(),
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			scrollToBottom: vi.fn(),
			systemAudioStatus: { sourceMode: "display-media", state: "ready" },
			transcriptViewportRef: { current: null },
			visibleTranscriptEntries: [],
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
				autoStartTranscription
			/>,
		);

		await waitFor(() => {
			expect(configureTranscriptionSessionMock).toHaveBeenCalledWith({
				autoStartKey: "note-1:capture",
				lang: undefined,
				scopeKey: "note:note-1",
			});
		});
	});

	it("closes the inline transcript panel on outside press without changing listening state", async () => {
		const onTranscriptListeningChange = vi.fn();

		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: true,
			isRefiningTranscript: false,
			isSpeechListening: true,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange,
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		const expandButtons = screen.getAllByRole("button", {
			name: "Expand speech controls",
		});

		fireEvent.click(expandButtons[0]);

		await waitFor(() => {
			expect(screen.getByText("Live transcript")).toBeDefined();
		});

		expect(screen.getByTestId("speech-input")).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Expand speech controls" }),
		).toBeDefined();

		fireEvent.pointerDown(document.body);

		await waitFor(() => {
			expect(screen.queryByText("Live transcript")).toBeNull();
		});

		expect(onTranscriptListeningChange).not.toHaveBeenCalled();
		expect(screen.getAllByTestId("speech-input").length).toBeGreaterThan(0);
	});

	it("shows only speech controls in the inline transcript panel", async () => {
		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: true,
			isRefiningTranscript: false,
			isSpeechListening: true,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Expand speech controls",
			})[0],
		);

		await waitFor(() => {
			expect(screen.getByText("Live transcript")).toBeDefined();
		});

		expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
		expect(screen.queryByPlaceholderText("Continue chat")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Expand speech controls" }),
		).toBeDefined();
	});

	it("renders the transcript snapshot returned by the note transcript hook", async () => {
		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-2",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-2",
					text: "",
					title: "Second note",
				}}
			/>,
		);

		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Expand speech controls",
			})[0],
		);

		await waitFor(() => {
			expect(screen.getByText("Live transcript")).toBeDefined();
		});

		expect(screen.getByText("hello")).toBeDefined();
	});

	it("progressively renders earlier transcript entries after opening the transcript panel", async () => {
		vi.useFakeTimers();

		const transcriptEntries = Array.from({ length: 40 }, (_, index) => ({
			endedAt: index + 2,
			id: `utt-${index + 1}`,
			isLive: false,
			speaker: "you" as const,
			startedAt: index + 1,
			text: `line ${index + 1}`,
		}));

		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: transcriptEntries,
			exportTranscript: transcriptEntries.map((entry) => entry.text).join("\n"),
			fullTranscript: transcriptEntries.map((entry) => entry.text).join("\n"),
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: transcriptEntries,
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		try {
			act(() => {
				fireEvent.click(
					screen.getAllByRole("button", {
						name: "Expand speech controls",
					})[0],
				);
			});

			expect(screen.getByText("Live transcript")).toBeDefined();
			expect(screen.queryByText("line 1")).toBeNull();
			expect(screen.getByText("line 40")).toBeDefined();
			expect(screen.getByText("Loading earlier transcript…")).toBeDefined();

			act(() => {
				vi.advanceTimersByTime(40);
			});

			expect(screen.getByText("line 1")).toBeDefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows inline chat without speech controls", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Select note chat" }),
			).toBeDefined();
		});

		expect(screen.getByPlaceholderText("Continue chat")).toBeDefined();
		expect(
			screen.queryByRole("button", { name: "Expand speech controls" }),
		).toBeNull();
	});

	it("opens inline chat when clicking the composer surface outside the textarea", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		expect(
			screen.queryByRole("combobox", { name: "Select note chat" }),
		).toBeNull();

		const composerShell = screen
			.getByRole("textbox")
			.closest('[data-slot="input-group"]');

		expect(composerShell).not.toBeNull();
		if (!composerShell) {
			throw new Error("Composer shell not found");
		}

		fireEvent.pointerDown(composerShell);

		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Select note chat" }),
			).toBeDefined();
		});
	});

	it("loads a user message into the composer for editing and resubmits with the same id", async () => {
		let queryCall = 0;
		const sendMessageMock = vi.fn();

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-message-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
				{
					id: "assistant-message-1",
					role: "assistant",
					parts: [{ type: "text", text: "Original answer" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

		const editingTextbox = await screen.findByDisplayValue("Original question");

		expect((editingTextbox as HTMLTextAreaElement).value).toBe(
			"Original question",
		);
		expect(screen.getByRole("button", { name: "Cancel edit" })).toBeDefined();

		fireEvent.change(editingTextbox, {
			target: { value: "Updated question" },
		});
		fireEvent.submit(editingTextbox.closest("form") as HTMLFormElement);

		await waitFor(() => {
			expect(sendMessageMock).toHaveBeenCalledWith(
				{
					messageId: "user-message-1",
					text: "Updated question",
				},
				expect.objectContaining({
					body: expect.objectContaining({
						recipeSlug: null,
					}),
				}),
			);
		});

		expect(screen.queryByRole("button", { name: "Cancel edit" })).toBeNull();
	});

	it("deletes a user note chat message turn", async () => {
		let queryCall = 0;
		const truncateFromMessageMock = vi.fn().mockResolvedValue(undefined);
		const setMessagesMock = vi.fn();

		useMutationMock.mockReturnValue(truncateFromMessageMock);
		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-message-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
				{
					id: "assistant-message-1",
					role: "assistant",
					parts: [{ type: "text", text: "Original answer" }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: setMessagesMock,
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

		expect(setMessagesMock).toHaveBeenCalledWith(expect.any(Function));
		expect(truncateFromMessageMock).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "user-message-1",
		});
	});

	it("copies a user note chat message", async () => {
		let queryCall = 0;
		const writeTextMock = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: {
				writeText: writeTextMock,
			},
		});

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-message-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

		expect(writeTextMock).toHaveBeenCalledWith("Original question");
	});

	it("regenerates a note chat response with the ai sdk regenerate flow", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-message-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
				{
					id: "assistant-message-1",
					role: "assistant",
					parts: [{ type: "text", text: "Original answer" }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));

		await waitFor(() => {
			expect(regenerateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					messageId: "assistant-message-1",
					body: expect.objectContaining({
						recipeSlug: null,
					}),
				}),
			);
		});
	});

	it("keeps note chat message actions hover-only on desktop layouts", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-message-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		expect(
			(await screen.findByRole("button", { name: "Edit" })).parentElement
				?.parentElement?.parentElement?.className,
		).toContain("md:opacity-0");
	});

	it("collapses long user note chat messages behind a show more toggle", async () => {
		let queryCall = 0;
		const longMessage = Array.from(
			{ length: 16 },
			(_, index) => `Line ${index + 1} of a very long note chat prompt`,
		).join("\n");

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "user-message-long",
					role: "user",
					parts: [{ type: "text", text: longMessage }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		const toggle = await screen.findByRole("button", { name: "Show more" });
		const contentWrapper = toggle.parentElement
			?.previousElementSibling as HTMLDivElement | null;

		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(contentWrapper?.className).toContain("max-h-80");

		fireEvent.click(toggle);

		expect(
			screen
				.getByRole("button", { name: "Show less" })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(contentWrapper?.className).toContain("max-h-[999rem]");
	});

	it("does not collapse long assistant note chat messages", async () => {
		let queryCall = 0;
		const longMessage = Array.from(
			{ length: 16 },
			(_, index) => `Line ${index + 1} of a very long note chat response`,
		).join("\n");

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});
		useChatMock.mockReturnValue({
			error: undefined,
			messages: [
				{
					id: "assistant-message-long",
					role: "assistant",
					parts: [{ type: "text", text: longMessage }],
				},
			],
			sendMessage: vi.fn(),
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<NoteComposer
					noteContext={{
						noteId: "note-1",
						text: "",
						title: "New note",
					}}
				/>
			</ActiveWorkspaceProvider>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
		expect(
			screen.getByText(/Line 16 of a very long note chat response/),
		).toBeDefined();
	});

	it("shows only the selected chat presentation after switching modes", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		await waitFor(() => {
			expect(screen.getAllByPlaceholderText("Continue chat")).toHaveLength(1);
		});

		fireEvent(
			screen.getByText("Floating"),
			new Event("select", { bubbles: true }),
		);

		await waitFor(() => {
			expect(screen.getAllByPlaceholderText("Continue chat")).toHaveLength(1);
		});
	});

	it("moves the inline chat composer text to the left when speech controls are hidden", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		const composerInput = await screen.findByPlaceholderText("Continue chat");
		const composerFooter = composerInput.closest("form")?.parentElement;
		const reservedSpeechSpacer = [...(composerFooter?.children ?? [])].find(
			(element) =>
				element instanceof HTMLDivElement &&
				element.className.includes("w-[60px]"),
		);

		expect(composerFooter?.className).toContain("px-6");
		expect(composerFooter?.className).toContain("pb-4");
		expect(reservedSpeechSpacer).toBeUndefined();
	});

	it("uses the measured inline footer height for chat panel padding", async () => {
		class ResizeObserverMock {
			callback: ResizeObserverCallback;

			constructor(callback: ResizeObserverCallback) {
				this.callback = callback;
				resizeObservers.push(this);
			}

			observe() {}

			unobserve() {}

			disconnect() {}

			trigger() {
				this.callback([], this as unknown as ResizeObserver);
			}
		}

		const originalResizeObserver = globalThis.ResizeObserver;
		const resizeObservers: ResizeObserverMock[] = [];
		globalThis.ResizeObserver =
			ResizeObserverMock as unknown as typeof ResizeObserver;

		useQueryMock.mockImplementation(
			createNoteComposerQueryMock({
				currentChatSession: {
					title: "Support bot prd options",
				},
			}),
		);
		convexQueryMock.mockResolvedValue([
			{
				id: "assistant-1",
				role: "assistant",
				partsJson: JSON.stringify([
					{
						type: "text",
						text: "Reply with one of these, or tell me a different project name.",
					},
				]),
			},
		]);

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));

		await screen.findByPlaceholderText("Continue chat");
		const inlineFooter = document.querySelector(
			'[data-slot="note-composer-inline-footer"]',
		) as HTMLDivElement | null;
		const chatPanelContent =
			inlineFooter?.previousElementSibling as HTMLDivElement | null;

		expect(inlineFooter).not.toBeNull();
		expect(chatPanelContent).not.toBeNull();
		if (!inlineFooter || !chatPanelContent) {
			throw new Error("Inline footer layout not found");
		}
		expect(inlineFooter.className).toContain("bottom-0");

		vi.spyOn(inlineFooter, "getBoundingClientRect").mockImplementation(
			() =>
				({
					bottom: 0,
					height: 156,
					left: 0,
					right: 0,
					top: 0,
					width: 0,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect,
		);

		resizeObservers.at(-1)?.trigger();

		await waitFor(() => {
			expect(chatPanelContent?.style.paddingBottom).toBe("156px");
		});

		globalThis.ResizeObserver = originalResizeObserver;
	});

	it("persists the inline popover height across notes", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "First note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		await screen.findByPlaceholderText("Continue chat");

		const resizeHandle = document.querySelector(
			".cursor-row-resize",
		) as HTMLDivElement | null;
		const inlinePanel = resizeHandle?.parentElement?.parentElement
			?.parentElement?.parentElement as HTMLDivElement | null;
		const inlinePanelCard = resizeHandle?.parentElement
			?.parentElement as HTMLDivElement | null;

		expect(resizeHandle).not.toBeNull();
		expect(inlinePanel).not.toBeNull();
		expect(inlinePanelCard).not.toBeNull();
		if (!resizeHandle || !inlinePanel || !inlinePanelCard) {
			throw new Error("Inline popover resize controls not found");
		}

		vi.spyOn(inlinePanel, "getBoundingClientRect").mockImplementation(
			() =>
				({
					bottom: 0,
					height: 384,
					left: 0,
					right: 0,
					top: 0,
					width: 0,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect,
		);

		fireEvent.pointerDown(resizeHandle, {
			button: 0,
			clientY: 200,
		});
		fireEvent.pointerMove(window, {
			clientY: 120,
		});
		fireEvent.pointerUp(window);

		await waitFor(() => {
			expect(inlinePanelCard.style.height).toBe("464px");
		});

		expect(
			window.localStorage.getItem("opengran.noteComposer.inlinePopoverHeight"),
		).toBe("464");

		cleanup();

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-2",
					text: "",
					title: "Second note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		await screen.findByPlaceholderText("Continue chat");

		const restoredResizeHandle = document.querySelector(
			".cursor-row-resize",
		) as HTMLDivElement | null;
		const restoredInlinePanelCard = restoredResizeHandle?.parentElement
			?.parentElement as HTMLDivElement | null;

		expect(restoredInlinePanelCard).not.toBeNull();
		expect(restoredInlinePanelCard?.style.height).toBe("464px");
	});

	it("keeps the inline chat dock aligned with the floating baseline", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		await screen.findByPlaceholderText("Continue chat");

		const resizeHandle = document.querySelector(
			".cursor-row-resize",
		) as HTMLDivElement | null;
		const inlinePanel = resizeHandle?.parentElement?.parentElement
			?.parentElement?.parentElement as HTMLDivElement | null;

		expect(inlinePanel).not.toBeNull();
		expect(inlinePanel?.style.bottom).toBe(
			`-${COMPOSER_OVERLAY_FOOTER_PADDING}px`,
		);
	});

	it("uses the same max-height clamp for floating chat as inline chat", async () => {
		let queryCall = 0;

		Object.defineProperty(window, "innerHeight", {
			configurable: true,
			value: 500,
			writable: true,
		});

		useSidebarShellMock.mockReturnValue({
			isMobile: false,
			state: "expanded",
		});
		useSidebarRightMock.mockReturnValue({
			rightMode: "floating",
			rightOpen: true,
			rightOpenMobile: false,
			setHasRightSidebar: vi.fn(),
			setRightMode: vi.fn(),
			setRightOpen: vi.fn(),
			setRightOpenMobile: vi.fn(),
			setRightSidebarWidthMobileOverride: vi.fn(),
			setRightSidebarWidthOverride: vi.fn(),
		});
		useDockedPanelWidthsMock.mockReturnValue({
			rightInsetPanelWidth: null,
		});

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		await screen.findByPlaceholderText("Continue chat");

		fireEvent.click(screen.getByRole("button", { name: "Floating" }));

		await waitFor(() => {
			const floatingPanel = Array.from(document.querySelectorAll("div")).find(
				(element) =>
					element.className.includes("group/note-chat-panel") &&
					element.getAttribute("variant") === "floating",
			);

			expect(floatingPanel).toBeDefined();
			expect(floatingPanel?.style.maxHeight).toBe("388px");
			expect(floatingPanel?.style.right).toBe("18px");
		});
	});

	it("reuses the same footer chrome for inline chat and transcript popovers", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.focus(screen.getByRole("textbox"));
		await screen.findByPlaceholderText("Continue chat");

		const inlineChatFooter = document.querySelector(
			'[data-slot="note-composer-inline-footer"]',
		) as HTMLDivElement | null;
		const inlineChatSurface = inlineChatFooter?.querySelector(
			'[data-slot="input-group"]',
		) as HTMLDivElement | null;

		expect(inlineChatFooter).not.toBeNull();
		expect(inlineChatSurface).not.toBeNull();
		expect(inlineChatFooter?.className).toContain("bottom-0");
		expect(inlineChatFooter?.className).toContain("px-[6px]");
		expect(inlineChatFooter?.className).toContain("pb-2");

		const inlineChatSurfaceClassName = inlineChatSurface?.className ?? "";

		cleanup();

		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			hasGeneratedLatestTranscript: false,
			hasPendingGenerateTranscript: true,
			isTranscriptSessionReady: true,
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Expand speech controls",
			})[0],
		);
		await screen.findByText("Live transcript");

		const transcriptFooter = document.querySelector(
			'[data-slot="note-composer-inline-footer"]',
		) as HTMLDivElement | null;
		const transcriptSurface = transcriptFooter?.querySelector(
			'[data-slot="input-group"]',
		) as HTMLDivElement | null;

		expect(transcriptFooter).not.toBeNull();
		expect(transcriptSurface).not.toBeNull();
		expect(transcriptFooter?.className).toContain("bottom-0");
		expect(transcriptFooter?.className).toContain("px-[6px]");
		expect(transcriptFooter?.className).toContain("pb-2");
		expect(transcriptSurface?.className).toBe(inlineChatSurfaceClassName);
	});

	it("hides generate notes while inline chat is open", async () => {
		let queryCall = 0;

		useQueryMock.mockImplementation(() => {
			const index = queryCall % 5;
			queryCall += 1;

			if (index === 0) {
				return [
					{
						_id: "chat-doc-1",
						_creationTime: 1,
						chatId: "chat-1",
						createdAt: 1,
						title: "New chat",
						updatedAt: 1,
					},
				];
			}

			if (index === 1) {
				return [];
			}

			if (index === 2) {
				return {
					title: "New chat",
				};
			}

			if (index === 3) {
				return [];
			}

			if (index === 4) {
				return {
					transcriptionLanguage: null,
				};
			}

			return undefined;
		});

		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			hasGeneratedLatestTranscript: false,
			hasPendingGenerateTranscript: true,
			isTranscriptSessionReady: true,
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Generate notes" }),
		).toBeDefined();

		fireEvent.focus(screen.getByRole("textbox"));

		await screen.findByPlaceholderText("Continue chat");
		expect(screen.queryByRole("button", { name: "Generate notes" })).toBeNull();
	});

	it("hides generate notes when the note is already enhanced", async () => {
		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			hasGeneratedLatestTranscript: false,
			hasPendingGenerateTranscript: true,
			isTranscriptSessionReady: true,
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: false,
			isRefiningTranscript: false,
			isSpeechListening: false,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					templateSlug: "enhanced",
					text: "Already generated",
					title: "Generated note",
				}}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Generate notes" })).toBeNull();
	});

	it("keeps the inline transcript controls pinned to the dock position", async () => {
		useNoteTranscriptSessionMock.mockReturnValue({
			autoStartKey: null,
			captureScopeKey: "note:note-1",
			currentNoteScopeKey: "note:note-1",
			displayTranscriptEntries: [
				{
					endedAt: 2,
					id: "utt-1",
					isLive: false,
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			exportTranscript: "hello",
			fullTranscript: "hello",
			handleGenerateNotes: vi.fn(),
			isGeneratingNotes: false,
			isCurrentNoteSpeechListening: true,
			isRefiningTranscript: false,
			isSpeechListening: true,
			liveTranscriptEntries: [],
			onLiveTranscriptChange: vi.fn(),
			onRecoveryStatusChange: vi.fn(),
			onSystemAudioRecordingReady: vi.fn(),
			onSystemAudioStatusChange: vi.fn(),
			onTranscriptListeningChange: vi.fn(),
			onTranscriptUtterance: vi.fn(),
			orderedTranscriptUtterances: [
				{
					endedAt: 2,
					id: "utt-1",
					speaker: "you",
					startedAt: 1,
					text: "hello",
				},
			],
			recoveryStatus: {
				attempt: 0,
				maxAttempts: 0,
				message: null,
				state: "idle",
			},
			systemAudioStatus: {
				sourceMode: "display-media",
				state: "ready",
			},
			transcriptStartedAt: 1,
			transcriptRefinementError: null,
			transcriptViewportRef: {
				current: null,
			},
		});

		const { NoteComposer } = await import(
			"../src/components/note/note-composer"
		);

		render(
			<NoteComposer
				noteContext={{
					noteId: "note-1",
					text: "",
					title: "New note",
				}}
			/>,
		);

		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Expand speech controls",
			})[0],
		);

		const [inlineExpand, consentText] = await Promise.all([
			screen.findByRole("button", {
				name: "Expand speech controls",
			}),
			screen.findByText("Always get consent when transcribing others."),
		]);
		const controlsGroup = inlineExpand.closest("div");
		const leadingArea = controlsGroup?.parentElement;
		const footerSurface = leadingArea?.parentElement;
		const footerSurfaceWrapper = footerSurface?.parentElement;
		const footerSpacingContainer = footerSurfaceWrapper?.parentElement;

		expect(controlsGroup?.className).toContain("flex");
		expect(controlsGroup?.className).toContain("gap-1");
		expect(leadingArea?.className).toContain("flex");
		expect(leadingArea?.className).toContain("items-center");
		expect(consentText).toBeDefined();
		expect(footerSurface?.className).toContain("w-full");
		expect(footerSurface?.className).toContain("border");
		expect(footerSurface?.className).toContain("bg-background");
		expect(footerSurface?.className).toContain("overflow-hidden");
		expect(footerSpacingContainer).not.toBeNull();
		expect(footerSpacingContainer?.className).toContain("px-6");
		expect(footerSpacingContainer?.className).toContain("pb-4");
	});
});
