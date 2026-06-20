import type { FunctionReturnType } from "convex/server";
import { fromQueuedUserMessage } from "@/lib/chat-queue";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type ClaimedQueuedMessage = NonNullable<
	FunctionReturnType<typeof api.assistantQueuedMessages.claimNextForChat>
>;
type PreparedQueuedMessage = Awaited<ReturnType<typeof fromQueuedUserMessage>>;

export type QueuedChatSendMessage = (
	message: PreparedQueuedMessage["message"],
	options: { body: Record<string, unknown> },
) => Promise<unknown>;

type PrepareQueuedIntentArgs = {
	hasMessageId: (messageId: string) => boolean;
	queuedMessage: ClaimedQueuedMessage;
	resolveConvexToken: () => Promise<string | null>;
};

export const QUEUED_SEND_NOW_PENDING_ID = "__queued_send_now_pending__";

export const prepareQueuedReplayIntent = async ({
	hasMessageId,
	queuedMessage,
	resolveConvexToken,
}: PrepareQueuedIntentArgs) =>
	await fromQueuedUserMessage({
		hasMessageId,
		queuedMessage,
		resolveConvexToken,
	});

export const prepareQueuedSteerIntent = async ({
	activeRunId,
	hasMessageId,
	queuedMessage,
	resolveConvexToken,
}: PrepareQueuedIntentArgs & {
	activeRunId: Id<"assistantRuns"> | string;
}) => {
	const preparedQueuedMessage = await prepareQueuedReplayIntent({
		hasMessageId,
		queuedMessage,
		resolveConvexToken,
	});
	const { replayQueuedMessageId: _replayQueuedMessageId, ...queuedBody } =
		preparedQueuedMessage.body;

	return {
		body: {
			...queuedBody,
			continueRunId: activeRunId,
			steerQueuedMessageId: queuedMessage._id,
		},
		message: preparedQueuedMessage.message,
	};
};

type DrainQueuedChatMessageArgs = {
	chatId: string;
	claimQueuedMessage: (args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
	}) => Promise<ClaimedQueuedMessage | null>;
	discardClaimedMessage: (args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		queuedMessageId: Id<"assistantQueuedMessages">;
	}) => Promise<unknown>;
	hasMessageId: (messageId: string) => boolean;
	pendingDiscardClaimedMessageId: Id<"assistantQueuedMessages"> | null;
	queuedMessageCount: number;
	resolveConvexToken: () => Promise<string | null>;
	sendMessage: QueuedChatSendMessage;
	setLatestRequestBody: (body: Record<string, unknown>) => void;
	workspaceId: Id<"workspaces">;
};

type DrainQueuedChatMessageResult =
	| {
			pendingDiscardClaimedMessageId: Id<"assistantQueuedMessages"> | null;
			status: "idle" | "retry" | "sent";
	  }
	| {
			error: unknown;
			pendingDiscardClaimedMessageId: Id<"assistantQueuedMessages">;
			status: "cleanup_failed";
	  }
	| {
			error: unknown;
			pendingDiscardClaimedMessageId: null;
			status: "send_failed";
	  };

export const drainQueuedChatMessage = async ({
	chatId,
	claimQueuedMessage,
	discardClaimedMessage,
	hasMessageId,
	pendingDiscardClaimedMessageId,
	queuedMessageCount,
	resolveConvexToken,
	sendMessage,
	setLatestRequestBody,
	workspaceId,
}: DrainQueuedChatMessageArgs): Promise<DrainQueuedChatMessageResult> => {
	const convexToken = await resolveConvexToken();
	if (!convexToken) {
		return {
			pendingDiscardClaimedMessageId,
			status: "retry",
		};
	}

	if (pendingDiscardClaimedMessageId) {
		try {
			await discardClaimedMessage({
				workspaceId,
				chatId,
				queuedMessageId: pendingDiscardClaimedMessageId,
			});
		} catch (error) {
			return {
				error,
				pendingDiscardClaimedMessageId,
				status: "cleanup_failed",
			};
		}

		if (queuedMessageCount === 0) {
			return {
				pendingDiscardClaimedMessageId: null,
				status: "idle",
			};
		}
	}

	const queuedMessage = await claimQueuedMessage({
		workspaceId,
		chatId,
	});
	if (!queuedMessage) {
		return {
			pendingDiscardClaimedMessageId: null,
			status: "retry",
		};
	}

	try {
		const preparedQueuedMessage = await prepareQueuedReplayIntent({
			hasMessageId,
			queuedMessage,
			resolveConvexToken: async () => convexToken,
		});
		setLatestRequestBody(preparedQueuedMessage.body);
		await sendMessage(preparedQueuedMessage.message, {
			body: preparedQueuedMessage.body,
		});
		return {
			pendingDiscardClaimedMessageId: null,
			status: "sent",
		};
	} catch (error) {
		try {
			await discardClaimedMessage({
				workspaceId,
				chatId,
				queuedMessageId: queuedMessage._id,
			});
		} catch (discardError) {
			return {
				error: discardError,
				pendingDiscardClaimedMessageId: queuedMessage._id,
				status: "cleanup_failed",
			};
		}

		return {
			error,
			pendingDiscardClaimedMessageId: null,
			status: "send_failed",
		};
	}
};
