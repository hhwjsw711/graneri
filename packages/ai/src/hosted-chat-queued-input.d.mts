import type { UIMessage } from "ai";

type QueuedUserMessage<QueuedMessageId extends string> = {
	_id: QueuedMessageId;
	messageId: string;
	metadataJson?: string;
	partsJson: string;
};

export declare const createHostedChatQueuedInput: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	chatId: ChatId;
	claimReadyForRun: (args: {
		runId: RunId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<QueuedUserMessage<QueuedMessageId>[]>;
	discardClaimed: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<unknown>;
	getClaimedForChat: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<QueuedUserMessage<QueuedMessageId> | null>;
	workspaceId: WorkspaceId;
}) => {
	readonly claimedQueuedMessageId: QueuedMessageId | null;
	readonly claimedQueuedMessageIds: QueuedMessageId[];
	readonly hasClaimed: boolean;
	clearClaimed: () => void;
	claimSteer: (args: {
		queuedMessageId: QueuedMessageId;
		runId: RunId;
	}) => Promise<{
		claimedMessages: QueuedUserMessage<QueuedMessageId>[];
		userMessage: UIMessage | null;
		userMessages: UIMessage[];
	}>;
	loadClaimedReplay: (args: {
		queuedMessageId: QueuedMessageId;
	}) => Promise<UIMessage | null>;
	cleanupClaimed: (args?: { tolerateMissing?: boolean }) => Promise<
		| {
				cleaned: boolean;
				ok: true;
		  }
		| {
				error: unknown;
				ok: false;
				queuedMessageIds: QueuedMessageId[];
		  }
	>;
};
