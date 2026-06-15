import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { fromQueuedUserMessage } from "@/lib/chat-queue";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type PreparedQueuedMessage = Awaited<ReturnType<typeof fromQueuedUserMessage>>;

type QueuedChatSendMessage = (
	message: PreparedQueuedMessage["message"],
	options: { body: PreparedQueuedMessage["body"] },
) => Promise<unknown>;

export const useQueuedChatDrain = ({
	activeRun,
	chatId,
	contextLabel,
	isBlocked,
	latestRequestBodyRef,
	sendMessage,
	workspaceId,
}: {
	activeRun: unknown;
	chatId: string;
	contextLabel: string;
	isBlocked: boolean;
	latestRequestBodyRef: React.MutableRefObject<Record<string, unknown> | null>;
	sendMessage: QueuedChatSendMessage;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const claimQueuedMessage = useMutation(
		api.assistantQueuedMessages.claimNextForChat,
	);
	const requeueClaimedMessage = useMutation(
		api.assistantQueuedMessages.requeueClaimed,
	);
	const isDrainingQueuedMessageRef = React.useRef(false);

	React.useEffect(() => {
		if (
			!workspaceId ||
			activeRun ||
			isBlocked ||
			isDrainingQueuedMessageRef.current
		) {
			return;
		}

		isDrainingQueuedMessageRef.current = true;
		void (async () => {
			let claimedQueuedMessageId: Id<"assistantQueuedMessages"> | null = null;
			try {
				const queuedMessage = await claimQueuedMessage({
					workspaceId,
					chatId,
				});

				if (!queuedMessage) {
					return;
				}
				claimedQueuedMessageId = queuedMessage._id;

				const preparedQueuedMessage = await fromQueuedUserMessage({
					queuedMessage,
					resolveConvexToken: getCachedConvexToken,
				});
				latestRequestBodyRef.current = preparedQueuedMessage.body;
				await sendMessage(preparedQueuedMessage.message, {
					body: preparedQueuedMessage.body,
				});
				claimedQueuedMessageId = null;
			} catch (error) {
				if (claimedQueuedMessageId) {
					await requeueClaimedMessage({
						queuedMessageId: claimedQueuedMessageId,
					}).catch((requeueError) => {
						logError({
							event: "client.error",
							error: requeueError,
							message: `Failed to requeue ${contextLabel} message`,
						});
					});
				}
				logError({
					event: "client.error",
					error: error,
					message: `Failed to drain queued ${contextLabel} message`,
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to send queued follow-up",
				);
			} finally {
				isDrainingQueuedMessageRef.current = false;
			}
		})();
	}, [
		activeRun,
		chatId,
		claimQueuedMessage,
		contextLabel,
		isBlocked,
		latestRequestBodyRef,
		requeueClaimedMessage,
		sendMessage,
		workspaceId,
	]);
};
