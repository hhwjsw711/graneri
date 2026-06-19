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
	options: { body: PreparedQueuedMessage["body"] },
) => Promise<unknown>;

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
		const preparedQueuedMessage = await fromQueuedUserMessage({
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
