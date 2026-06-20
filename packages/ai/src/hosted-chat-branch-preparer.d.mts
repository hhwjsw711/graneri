import type { UIMessage } from "ai";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type StoredHostedChatMessage = {
	id: string;
	role: string;
	partsJson?: string | null;
};

type AssistantRunEvent = {
	event: {
		assistantMessageId?: string;
		type: string;
	};
};

type PreparedHostedChatTurnBranch = {
	editedMessageIndex: number;
	incomingMessages: UIMessage[];
	shouldTruncateChatBranch: boolean;
	truncateMessageId?: string;
};

export declare const getHostedInterruptedAssistantMessageIds: (
	runEvents: AssistantRunEvent[],
) => string[];

export declare const prepareHostedChatTurnBranch: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
>(args: {
	attachableRunId?: RunId | null;
	chatId: ChatId;
	continueRunId?: RunId | null;
	getMessagesSnapshot: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
	}) => Promise<StoredHostedChatMessage[]>;
	listRunEventsAfter: (args: {
		runId: RunId;
		limit: 500;
	}) => Promise<AssistantRunEvent[]>;
	logLatency?: (stage: string, details?: LogLatencyDetails) => void;
	message?: UIMessage | null;
	messageId?: string | null;
	messages?: UIMessage[];
	onTruncateError?: (args: {
		error: unknown;
		messageId: string;
	}) => Promise<boolean> | boolean;
	pendingMessages?: UIMessage[];
	shouldLoadStoredMessages?: boolean;
	storedMessagesForStatelessBranch?: StoredHostedChatMessage[];
	trigger?: "submit-message" | "regenerate-message";
	truncateFromMessage: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		messageId: string;
	}) => Promise<unknown>;
	workspaceId: WorkspaceId;
}) => Promise<
	| {
			ok: true;
			preparedBranch: PreparedHostedChatTurnBranch;
			shouldTruncateChatBranch: boolean;
			storedMessages: StoredHostedChatMessage[];
	  }
	| {
			ok: false;
			reason: "truncate_error_handled";
	  }
>;
