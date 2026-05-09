import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET } from "../src/components/layout/composer-dock";
import { ActiveWorkspaceProvider } from "../src/hooks/use-active-workspace";

const convexTokenMock = vi.fn();
const sendMessageMock = vi.fn();
const regenerateMock = vi.fn();
const stopMock = vi.fn();
const toastSuccessMock = vi.fn();
const truncateFromMessageMock = vi.fn();
const moveChatToTrashMock = vi.fn();
const useChatMock = vi.fn();
const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const scrollToBottomMock = vi.fn();
const useStickyScrollToBottomMock = vi.fn();
const dropdownMenuModalValues: Array<boolean | undefined> = [];
const chatPageSurfaceMinHeightClass =
	"min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-4rem)]";

const getChatPageQueryFixture = (query: unknown, args: unknown) => {
	if (args === "skip") {
		return undefined;
	}

	const functionName = getFunctionName(query);

	if (functionName === "chats:getMessages") {
		return [];
	}

	if (functionName === "automations:getRunningRunForChat") {
		return null;
	}

	if (functionName === "appConnections:listSources") {
		return [];
	}

	if (
		functionName === "notes:list" &&
		args &&
		typeof args === "object" &&
		"workspaceId" in args &&
		args.workspaceId === "workspace-1"
	) {
		return [
			{
				_id: "meeting-notes",
				title: "Meeting notes",
				searchableText: "Team sync",
			},
			{
				_id: "guidelines",
				title: "Brand guidelines",
				searchableText: "Voice and tone",
			},
		];
	}

	return [];
};

const mockChatPageMutations = () => {
	useMutationMock.mockImplementation((mutation) => {
		const functionName = getFunctionName(mutation);

		if (functionName === "chats:truncateFromMessage") {
			return truncateFromMessageMock;
		}

		if (functionName === "chats:setModel") {
			return vi.fn().mockResolvedValue(null);
		}

		if (functionName === "chats:moveToTrash") {
			return {
				withOptimisticUpdate: vi.fn(() => moveChatToTrashMock),
			};
		}

		return {
			withOptimisticUpdate: vi.fn(() => vi.fn()),
		};
	});
};

vi.mock("@ai-sdk/react", () => ({
	useChat: useChatMock,
}));

vi.mock("@workspace/platform/desktop", () => ({
	isDesktopRuntime: () => true,
}));

vi.mock("convex/react", () => ({
	useQuery: useQueryMock,
	useAction: useActionMock,
	useMutation: useMutationMock,
}));

vi.mock("ai", () => ({
	DefaultChatTransport: class DefaultChatTransport {
		constructor(readonly options: unknown) {}
	},
}));

vi.mock("../src/hooks/use-sticky-scroll-to-bottom", () => ({
	useStickyScrollToBottom: () => useStickyScrollToBottomMock(),
}));

vi.mock("../src/components/chat/messages", () => ({
	ChatMessages: ({
		isLoading,
		messages,
		onDeleteMessage,
		onEditMessage,
		onPlusAction,
		onRegenerateMessage,
	}: {
		isLoading?: boolean;
		messages?: Array<{
			id: string;
			role: string;
			parts: Array<{ text?: string }>;
		}>;
		onDeleteMessage?: (messageId: string) => void;
		onEditMessage?: (messageId: string, text: string) => void;
		onPlusAction?: (content: string) => undefined | Promise<unknown>;
		onRegenerateMessage?: (messageId: string) => void;
	}) => (
		<div>
			<div>chat messages</div>
			{isLoading ? <div>Thinking</div> : null}
			{messages?.map((message) => {
				const text = message.parts
					.map((part) => part.text ?? "")
					.join("\n\n")
					.trim();

				return (
					<div key={message.id}>
						<span>{text}</span>
						{message.role === "user" ? (
							<>
								<button
									type="button"
									aria-label="Edit"
									onClick={() => onEditMessage?.(message.id, text)}
								>
									Edit
								</button>
								<button
									type="button"
									aria-label="Delete"
									onClick={() => onDeleteMessage?.(message.id)}
								>
									Delete
								</button>
							</>
						) : null}
						{message.role === "assistant" ? (
							<>
								<button
									type="button"
									aria-label="Create note"
									onClick={() => onPlusAction?.(text)}
								>
									Create note
								</button>
								<button
									type="button"
									aria-label="Regenerate"
									onClick={() => onRegenerateMessage?.(message.id)}
								>
									Regenerate
								</button>
							</>
						) : null}
					</div>
				);
			})}
		</div>
	),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		convex: {
			token: convexTokenMock,
		},
		useSession: () => ({
			data: null,
		}),
	},
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
	},
}));

vi.mock("@workspace/ui/components/avatar", () => ({
	Avatar: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
	AvatarFallback: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
}));

vi.mock("@workspace/ui/components/command", () => ({
	Command: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
	CommandEmpty: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	CommandGroup: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	CommandInput: ({
		onValueChange,
		value,
		placeholder,
	}: {
		onValueChange?: (value: string) => void;
		value?: string;
		placeholder?: string;
	}) => (
		<input
			placeholder={placeholder}
			value={value}
			onChange={(event) => onValueChange?.(event.target.value)}
		/>
	),
	CommandItem: ({
		children,
		onSelect,
	}: React.PropsWithChildren<{ onSelect?: () => void }>) => (
		<button type="button" onClick={() => onSelect?.()}>
			{children}
		</button>
	),
	CommandList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
	CommandShortcut: ({ children }: React.PropsWithChildren) => (
		<span>{children}</span>
	),
}));

vi.mock("@workspace/ui/components/dropdown-menu", () => ({
	DropdownMenu: ({
		children,
		modal,
	}: React.PropsWithChildren<{ modal?: boolean }>) => {
		dropdownMenuModalValues.push(modal);
		return <div>{children}</div>;
	},
	DropdownMenuCheckboxItem: ({
		children,
		checked,
		onCheckedChange,
	}: React.PropsWithChildren<{
		checked?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	}>) => (
		<button type="button" onClick={() => onCheckedChange?.(!checked)}>
			{children}
		</button>
	),
	DropdownMenuContent: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	DropdownMenuGroup: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({
		children,
		onClick,
		onSelect,
	}: React.PropsWithChildren<{
		onClick?: () => void;
		onSelect?: (event: { preventDefault: () => void }) => void;
	}>) => (
		<button
			type="button"
			onClick={() => {
				onClick?.();
				onSelect?.({ preventDefault: () => {} });
			}}
		>
			{children}
		</button>
	),
	DropdownMenuLabel: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	DropdownMenuSubContent: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	DropdownMenuSubTrigger: ({ children }: React.PropsWithChildren) => (
		<button type="button">{children}</button>
	),
	DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => (
		<>{children}</>
	),
}));

vi.mock("@workspace/ui/components/input-group", () => ({
	InputGroup: ({
		children,
		className,
	}: React.PropsWithChildren<{ className?: string }>) => (
		<div className={className}>{children}</div>
	),
	InputGroupAddon: ({
		children,
		className,
	}: React.PropsWithChildren<{ className?: string }>) => (
		<div className={className}>{children}</div>
	),
	InputGroupButton: ({
		children,
		...props
	}: React.PropsWithChildren<
		React.ButtonHTMLAttributes<HTMLButtonElement> & {
			variant?: string;
			size?: string;
		}
	>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	InputGroupTextarea: ({
		ref,
		...props
	}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
		ref?: React.Ref<HTMLTextAreaElement>;
	}) => <textarea ref={ref} {...props} />,
}));

vi.mock("@workspace/ui/components/popover", () => ({
	Popover: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
	PopoverContent: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("@workspace/ui/components/switch", () => ({
	Switch: ({
		checked,
		id,
		onCheckedChange,
	}: {
		checked?: boolean;
		id?: string;
		onCheckedChange?: (checked: boolean) => void;
	}) => (
		<input
			id={id}
			type="checkbox"
			checked={checked}
			onChange={(event) => onCheckedChange?.(event.target.checked)}
		/>
	),
}));

vi.mock("@workspace/ui/components/tooltip", () => ({
	Tooltip: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
	TooltipContent: ({ children }: React.PropsWithChildren) => (
		<div>{children}</div>
	),
	TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe("ChatPage", () => {
	beforeEach(async () => {
		dropdownMenuModalValues.length = 0;
		const { clearCachedConvexToken } = await import("../src/lib/convex-token");
		clearCachedConvexToken();
		convexTokenMock.mockReset();
		sendMessageMock.mockReset();
		stopMock.mockReset();
		regenerateMock.mockReset();
		toastSuccessMock.mockReset();
		truncateFromMessageMock.mockReset();
		moveChatToTrashMock.mockReset();
		scrollToBottomMock.mockReset();
		truncateFromMessageMock.mockResolvedValue(undefined);
		moveChatToTrashMock.mockResolvedValue(null);
		useQueryMock.mockReset();
		useActionMock.mockReset();
		useMutationMock.mockReset();
		useStickyScrollToBottomMock.mockReturnValue({
			containerRef: vi.fn(),
			isAtBottom: true,
			scrollToBottom: scrollToBottomMock,
		});
		convexTokenMock.mockResolvedValue({ data: { token: "convex-token" } });
		mockChatPageMutations();
		useChatMock.mockReturnValue({
			messages: [],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});
		useQueryMock.mockImplementation(getChatPageQueryFixture);
		useActionMock.mockReturnValue(vi.fn().mockResolvedValue([]));
	});

	afterEach(() => {
		cleanup();
	});

	it("focuses the chat prompt on open", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");
		const priorFocus = document.createElement("button");
		priorFocus.type = "button";
		document.body.appendChild(priorFocus);
		priorFocus.focus();

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		expect(document.activeElement).toBe(
			screen.getByPlaceholderText("Ask, search, or make anything..."),
		);
		priorFocus.remove();
	}, 10_000);

	it("does not reopen trash confirmation after moving a history chat to trash", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");
		const onChatRemoved = vi.fn();
		const chatTimestamp = new Date("2026-01-01T00:00:00.000Z").getTime();

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="composer-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[
						{
							_id: "chat-1",
							_creationTime: chatTimestamp,
							authorName: "Murad",
							chatId: "chat-1",
							createdAt: chatTimestamp,
							title: "Meeting recap",
							updatedAt: chatTimestamp,
						} as never,
					]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={onChatRemoved}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(
			screen.getByRole("button", { name: "Open actions for Meeting recap" }),
		);
		await user.click(screen.getByRole("button", { name: "Move to trash" }));
		expect(screen.getByText("Move chat to trash?")).toBeTruthy();

		const confirmButtons = screen.getAllByRole("button", {
			name: "Move to trash",
		});
		await user.click(confirmButtons.at(-1) as HTMLElement);

		await waitFor(() => {
			expect(moveChatToTrashMock).toHaveBeenCalledWith({
				workspaceId: "workspace-1",
				chatId: "chat-1",
			});
			expect(onChatRemoved).toHaveBeenCalledWith("chat-1");
			expect(screen.queryByText("Move chat to trash?")).toBeNull();
		});
	});

	it("shows thinking while an automation run is still generating", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useQueryMock.mockImplementation((query, args) => {
			if (getFunctionName(query) === "automations:getRunningRunForChat") {
				return {
					automationId: "automation-1",
					runId: "run-1",
					title: "Meeting recap",
					scheduledFor: Date.now(),
					startedAt: Date.now(),
				};
			}

			return getChatPageQueryFixture(query, args);
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId="chat-1"
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		expect(screen.getByText("chat messages")).toBeTruthy();
		expect(screen.getByText("Thinking")).toBeTruthy();
	});

	it("submits the selected AI context in the chat request body", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.type(
			screen.getByPlaceholderText("Ask, search, or make anything..."),
			"hello",
		);
		await user.click(screen.getByLabelText("Web search"));
		await user.click(screen.getByLabelText("Apps and integrations"));
		const meetingNotesButtons = screen.getAllByRole("button", {
			name: "Meeting notes",
		});
		const brandGuidelinesButtons = screen.getAllByRole("button", {
			name: "Brand guidelines",
		});
		expect(meetingNotesButtons[0]).toBeDefined();
		expect(brandGuidelinesButtons[0]).toBeDefined();
		await user.click(meetingNotesButtons[0]);
		await user.click(brandGuidelinesButtons[0]);
		await user.click(screen.getByRole("button", { name: "Send" }));

		expect(sendMessageMock).toHaveBeenCalledTimes(1);
		expect(sendMessageMock).toHaveBeenCalledWith(
			{ text: "hello" },
			{
				body: {
					model: "gpt-5.4",
					webSearchEnabled: true,
					appsEnabled: false,
					mentions: ["meeting-notes", "guidelines"],
					selectedSourceIds: [],
					workspaceId: "workspace-1",
					convexToken: "convex-token",
				},
			},
		);
	}, 10_000);

	it("does not opt the chat source picker into non-modal dropdown behavior", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		expect(dropdownMenuModalValues).not.toContain(false);
	});

	it("shows a stop button while streaming and stops the response", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "msg-1",
					role: "assistant",
					parts: [{ type: "text", text: "Working..." }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "streaming",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Stop streaming" }));

		expect(stopMock).toHaveBeenCalledTimes(1);
	});

	it("opens connections settings without mutating the chat route directly", async () => {
		const user = userEvent.setup();
		const pushStateSpy = vi.spyOn(window.history, "pushState");
		const onOpenConnectionsSettings = vi.fn();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		vi.mocked(useChatMock).mockReturnValue({
			messages: [],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={onOpenConnectionsSettings}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Connect apps" }));

		expect(onOpenConnectionsSettings).toHaveBeenCalledTimes(1);
		expect(pushStateSpy).not.toHaveBeenCalledWith(
			null,
			"",
			"/settings/connections",
		);
	});

	it("toggles web search without showing a toast", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={null}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByLabelText("Web search"));
		await user.click(screen.getByLabelText("Web search"));

		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("loads a user message into the composer for editing and resubmits with the same id", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
				{
					id: "assistant-1",
					role: "assistant",
					parts: [{ type: "text", text: "Original answer" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[
						{
							_id: "chat-doc-1",
							_creationTime: 1,
							ownerTokenIdentifier: "token-1",
							workspaceId: "workspace-1" as never,
							authorName: "User",
							chatId: "chat-1",
							title: "Chat",
							preview: "Original question",
							model: "gpt-5.4",
							isArchived: false,
							createdAt: 1,
							updatedAt: 1,
							lastMessageAt: 1,
						} as never,
					]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Edit" }));

		const textbox = screen.getByDisplayValue("Original question");
		expect(screen.getByRole("button", { name: "Cancel edit" })).toBeDefined();

		await user.clear(textbox);
		await user.type(textbox, "Updated question");
		await user.click(screen.getByRole("button", { name: "Send" }));

		expect(sendMessageMock).toHaveBeenCalledWith(
			{ messageId: "user-1", text: "Updated question" },
			{
				body: {
					model: "gpt-5.4",
					webSearchEnabled: false,
					appsEnabled: true,
					mentions: [],
					selectedSourceIds: [],
					workspaceId: "workspace-1",
					convexToken: "convex-token",
				},
			},
		);
	});

	it("deletes a user message turn from the chat", async () => {
		const user = userEvent.setup();
		const setMessagesMock = vi.fn();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useMutationMock.mockReset();
		mockChatPageMutations();
		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
				{
					id: "assistant-1",
					role: "assistant",
					parts: [{ type: "text", text: "Original answer" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: setMessagesMock,
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Delete" }));

		expect(setMessagesMock).toHaveBeenCalledWith(expect.any(Function));
		expect(truncateFromMessageMock).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "user-1",
		});
	});

	it("regenerates an assistant response with the ai sdk regenerate flow", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
				{
					id: "assistant-1",
					role: "assistant",
					parts: [{ type: "text", text: "Original answer" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Regenerate" }));

		expect(regenerateMock).toHaveBeenCalledWith({
			messageId: "assistant-1",
			body: {
				model: "gpt-5.4",
				webSearchEnabled: false,
				appsEnabled: true,
				mentions: [],
				selectedSourceIds: [],
				workspaceId: "workspace-1",
				convexToken: "convex-token",
			},
		});
	});

	it("opens chat message search with command f inside an active chat", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Find the deployment note" }],
				},
				{
					id: "assistant-1",
					role: "assistant",
					parts: [{ type: "text", text: "The deployment note is ready" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.keyboard("{Meta>}f{/Meta}");
		const searchInput = screen.getByRole("textbox", { name: "Search chat" });
		await user.type(searchInput, "deployment");

		expect(document.activeElement).toBe(searchInput);
		expect(screen.getByText("1/2")).toBeTruthy();
	});

	it("creates a note from an assistant response using the current chat title", async () => {
		const user = userEvent.setup();
		const onCreateNoteFromResponse = vi.fn().mockResolvedValue("created");
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "hey ho" }],
				},
				{
					id: "assistant-1",
					role: "assistant",
					parts: [{ type: "text", text: "Hey! How can I help?" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[
						{
							_id: "chat-doc-1",
							_creationTime: 1,
							ownerTokenIdentifier: "token-1",
							workspaceId: "workspace-1" as never,
							authorName: "User",
							chatId: "chat-1",
							title: "Greeting and assistance",
							preview: "hey ho",
							model: "gpt-5.4",
							isArchived: false,
							createdAt: 1,
							updatedAt: 1,
							lastMessageAt: 1,
						} as never,
					]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					onCreateNoteFromResponse={onCreateNoteFromResponse}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Create note" }));

		expect(onCreateNoteFromResponse).toHaveBeenCalledWith(
			"Greeting and assistance",
			"Hey! How can I help?",
		);
	});

	it("shows a floating scroll button when the chat is away from the bottom", async () => {
		const user = userEvent.setup();
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useStickyScrollToBottomMock.mockReturnValue({
			containerRef: vi.fn(),
			isAtBottom: false,
			scrollToBottom: scrollToBottomMock,
		});
		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		await user.click(
			screen.getByRole("button", { name: "Scroll to latest messages" }),
		);

		expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the selected chat surface mounted while initial messages are still warming", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					isInitialMessagesLoading
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		expect(screen.queryByText("Loading chat...")).toBeNull();
		expect(screen.queryByText("Ask anything")).toBeNull();
		expect(
			screen.getByPlaceholderText("Ask, search, or make anything..."),
		).toBeTruthy();
	});

	it("uses the compact composer layout for an active chat even before messages load", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		const composerGroup = screen
			.getByPlaceholderText("Ask, search, or make anything...")
			.closest("div");

		expect(composerGroup?.className).toContain("min-h-[96px]");
		expect(composerGroup?.className).not.toContain("min-h-[148px]");
		expect(
			screen
				.getByPlaceholderText("Ask, search, or make anything...")
				.getAttribute("rows"),
		).toBe("1");
	});

	it("keeps the Ask AI composer dock aligned with the note chat baseline", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		const dockContainer = Array.from(document.querySelectorAll("div")).find(
			(element) =>
				element.className.includes(
					"pointer-events-none absolute inset-x-0 bottom-0",
				),
		);

		expect(dockContainer).not.toBeUndefined();
		expect(dockContainer?.className).toContain(
			`pb-[${COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET}px]`,
		);
	});

	it("uses the full dynamic viewport height for active chat surfaces", async () => {
		const { ChatPage } = await import("../src/components/chat/chat-page");

		useChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Original question" }],
				},
			],
			sendMessage: sendMessageMock,
			regenerate: regenerateMock,
			setMessages: vi.fn(),
			error: undefined,
			status: "ready",
			stop: stopMock,
		});

		render(
			<ActiveWorkspaceProvider workspaceId={"workspace-1" as never}>
				<ChatPage
					chatId="chat-1"
					initialMessages={[]}
					onChatPersisted={vi.fn()}
					chats={[]}
					isChatsLoading={false}
					activeChatId={"chat-1"}
					onOpenChat={vi.fn()}
					onPrefetchChat={vi.fn()}
					onChatRemoved={vi.fn()}
					onOpenConnectionsSettings={vi.fn()}
					activeWorkspace={null}
				/>
			</ActiveWorkspaceProvider>,
		);

		const surface = Array.from(document.querySelectorAll("div")).find(
			(element) => element.className.includes(chatPageSurfaceMinHeightClass),
		);

		expect(surface).not.toBeUndefined();
		expect(surface?.className).toContain(chatPageSurfaceMinHeightClass);
	});
});
