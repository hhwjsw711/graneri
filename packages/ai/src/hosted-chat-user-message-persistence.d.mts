import type { UIMessage } from "ai";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import type { toHostedStoredMessage } from "./hosted-chat-runtime.mjs";

type QueuedInput<
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
> = ReturnType<
	typeof createHostedChatQueuedInput<
		WorkspaceId,
		ChatId,
		RunId,
		QueuedMessageId
	>
>;

type SaveMessageArgs<
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
> = {
	chatId: ChatId;
	message: UIMessage;
	model: string;
	noteId: NoteId | null;
	reasoningEffort: ReasoningEffort;
	workspaceId: WorkspaceId;
};

type BuiltSaveMessageArgs<
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
> = SaveMessageArgs<WorkspaceId, ChatId, NoteId, ReasoningEffort> & {
	message: ReturnType<typeof toHostedStoredMessage>;
	noteId: NoteId | undefined;
	preview: string;
	title?: string;
};

export declare const isHostedQueuedUserMessageAccept: <
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	continueRunId?: RunId | null;
	queuedInput: { readonly hasClaimed: boolean };
	replayQueuedMessageId?: QueuedMessageId | null;
}) => boolean;

export declare const persistHostedChatUserMessage: <
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: SaveMessageArgs<WorkspaceId, ChatId, NoteId, ReasoningEffort> & {
	acceptQueuedUserMessage: (
		args: BuiltSaveMessageArgs<
			WorkspaceId,
			ChatId,
			NoteId,
			ReasoningEffort
		> & {
			queuedMessageId: QueuedMessageId;
		},
	) => Promise<unknown>;
	acceptSteeredUserMessages: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		noteId: NoteId | undefined;
		title?: string;
		preview: string;
		model: string;
		reasoningEffort: ReasoningEffort;
		runId: RunId;
		messages: Array<{
			queuedMessageId: QueuedMessageId;
			message: ReturnType<typeof toHostedStoredMessage>;
		}>;
	}) => Promise<unknown>;
	appendUserMessageToRun: (args: {
		runId: RunId;
		messageId: string;
	}) => Promise<unknown>;
	continueRunId?: RunId | null;
	queuedInput: QueuedInput<WorkspaceId, ChatId, RunId, QueuedMessageId>;
	replayQueuedMessageId?: QueuedMessageId | null;
	saveMessage: (
		args: BuiltSaveMessageArgs<
			WorkspaceId,
			ChatId,
			NoteId,
			ReasoningEffort
		>,
	) => Promise<unknown>;
	steeredUserMessages: UIMessage[];
}) => Promise<{
	acceptedSteerTurnId: RunId | null;
	pendingQueuedAcceptanceHeaders: Record<string, string> | null;
}>;
