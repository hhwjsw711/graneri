import type { UIMessage } from "ai";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";

type AttachableRun<RunId extends string> =
	| {
			_id: RunId;
			status?: "running" | "waiting_for_user" | string;
	  }
	| null;

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

type TurnInputValidationResult =
	| {
			ok: true;
	  }
	| {
			error: string;
			errorCode?: string;
			ok: false;
	  };

type TurnControllerError = {
	cause?: unknown;
	cleanupError?: unknown;
	error: string;
	errorCode?: string;
	logMessage?: string;
	ok: false;
	phase:
		| "active_run_interrupt_failed"
		| "active_run_mismatch"
		| "input_invalid"
		| "message_missing"
		| "queued_message_unavailable"
		| "steer_queue_cleanup_failed";
	statusCode: 400 | 409 | 500;
};

type CleanupClaimedResult<QueuedMessageId extends string> =
	| {
			ok: true;
	  }
	| {
			error: unknown;
			ok: false;
			queuedMessageIds?: QueuedMessageId[];
	  };

type PreparedTurnInput<QueuedMessageId extends string> = {
	cleanupClaimedSteerQueuedMessage: (args?: {
		tolerateMissing?: boolean;
	}) => Promise<CleanupClaimedResult<QueuedMessageId>>;
	effectiveMessage: UIMessage;
	interruptedPendingInput: unknown[];
	ok: true;
	pendingSteerMessages: UIMessage[];
	replayedUserMessage: UIMessage | null;
	steeredUserMessage: UIMessage | null;
	steeredUserMessages: UIMessage[];
};

export declare const isPendingHostedUserMessage: (
	input: unknown,
) => input is UIMessage;

export declare const createHostedChatTurnController: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	attachableRun: AttachableRun<RunId>;
	chatId: ChatId;
	interruptActiveRun: (args: {
		chatId: ChatId;
		pendingInput: UIMessage[];
		runId: RunId;
		workspaceId: WorkspaceId;
	}) => Promise<unknown[]>;
	queuedInput: QueuedInput<WorkspaceId, ChatId, RunId, QueuedMessageId>;
	validateInput: (message: UIMessage) => TurnInputValidationResult;
	workspaceId: WorkspaceId;
}) => {
	cleanupClaimedSteerQueuedMessage: (args?: {
		tolerateMissing?: boolean;
	}) => Promise<CleanupClaimedResult<QueuedMessageId>>;
	prepareInput: (args: {
		continueRunId?: RunId | null;
		message?: UIMessage | null;
		replayQueuedMessageId?: QueuedMessageId | null;
		steerQueuedMessageId?: QueuedMessageId | null;
	}) => Promise<PreparedTurnInput<QueuedMessageId> | TurnControllerError>;
	requireSameActiveRun: (args: {
		continueRunId?: RunId | null;
	}) => Promise<
		| {
				ok: true;
		  }
		| TurnControllerError
	>;
};
