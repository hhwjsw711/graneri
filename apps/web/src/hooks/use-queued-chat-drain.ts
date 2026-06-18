import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { toast } from "sonner";
import { fromQueuedUserMessage } from "@/lib/chat-queue";
import {
	getQueuedFollowUpCacheKey,
	QUEUED_FOLLOW_UP_DRAIN_RETRY_MS,
	type QueuedFollowUpMessage,
	readQueuedFollowUpsCache,
	shouldDrainQueuedFollowUp,
	subscribeQueuedFollowUpsCache,
	updateQueuedFollowUpsCache,
	writeQueuedFollowUpsCache,
} from "@/lib/chat-queued-followups";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type PreparedQueuedMessage = Awaited<ReturnType<typeof fromQueuedUserMessage>>;

type QueuedChatSendMessage = (
	message: PreparedQueuedMessage["message"],
	options: { body: PreparedQueuedMessage["body"] },
) => Promise<unknown>;
type AttachableRun =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;

export const useQueuedChatDrain = ({
	activeRun,
	chatId,
	contextLabel,
	isBlocked,
	latestRequestBodyRef,
	localMessageIds,
	sendMessage,
	workspaceId,
}: {
	activeRun: AttachableRun;
	chatId: string;
	contextLabel: string;
	isBlocked: boolean;
	latestRequestBodyRef: React.MutableRefObject<Record<string, unknown> | null>;
	localMessageIds: ReadonlySet<string>;
	sendMessage: QueuedChatSendMessage;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const claimQueuedMessage = useMutation(
		api.assistantQueuedMessages.claimNextForChat,
	);
	const requeueClaimedMessage = useMutation(
		api.assistantQueuedMessages.requeueClaimed,
	);
	const discardClaimedMessage = useMutation(
		api.assistantQueuedMessages.discardClaimed,
	);
	const queuedMessages = useQuery(
		api.assistantQueuedMessages.listQueuedForChat,
		workspaceId ? { workspaceId, chatId } : "skip",
	);
	const queuedMessagesCacheKey = React.useMemo(
		() => getQueuedFollowUpCacheKey({ workspaceId, chatId }),
		[chatId, workspaceId],
	);
	const getVisibleQueuedMessagesSnapshot = React.useCallback(
		() => readQueuedFollowUpsCache(queuedMessagesCacheKey),
		[queuedMessagesCacheKey],
	);
	const subscribeVisibleQueuedMessages = React.useCallback(
		(listener: () => void) =>
			subscribeQueuedFollowUpsCache(queuedMessagesCacheKey, listener),
		[queuedMessagesCacheKey],
	);
	const visibleQueuedMessages = React.useSyncExternalStore(
		subscribeVisibleQueuedMessages,
		getVisibleQueuedMessagesSnapshot,
		getVisibleQueuedMessagesSnapshot,
	);
	const isDrainingQueuedMessageRef = React.useRef(false);
	const retryTimerRef = React.useRef<number | null>(null);
	const [retryNonce, setRetryNonce] = React.useState(0);

	React.useEffect(() => {
		if (!queuedMessagesCacheKey || !queuedMessages) {
			return;
		}

		writeQueuedFollowUpsCache(queuedMessagesCacheKey, queuedMessages);
	}, [queuedMessages, queuedMessagesCacheKey]);

	const updateVisibleQueuedMessages = React.useCallback(
		(
			updater: (
				messages: Array<QueuedFollowUpMessage>,
			) => Array<QueuedFollowUpMessage>,
		) => {
			updateQueuedFollowUpsCache(queuedMessagesCacheKey, updater);
		},
		[queuedMessagesCacheKey],
	);

	React.useEffect(
		() => () => {
			if (retryTimerRef.current !== null) {
				window.clearTimeout(retryTimerRef.current);
			}
		},
		[],
	);

	const scheduleRetry = React.useCallback(() => {
		if (retryTimerRef.current !== null) {
			return;
		}

		retryTimerRef.current = window.setTimeout(() => {
			retryTimerRef.current = null;
			setRetryNonce((current) => current + 1);
		}, QUEUED_FOLLOW_UP_DRAIN_RETRY_MS);
	}, []);

	React.useEffect(() => {
		void retryNonce;
		const hasQueuedMessage = (queuedMessages?.length ?? 0) > 0;

		if (
			!shouldDrainQueuedFollowUp({
				activeRun,
				hasQueuedMessage,
				isBlocked,
				isDraining: isDrainingQueuedMessageRef.current,
				workspaceId,
			})
		) {
			return;
		}
		// react-doctor-disable-next-line react-doctor/no-event-handler
		const resolvedWorkspaceId = workspaceId;
		if (!resolvedWorkspaceId) {
			return;
		}

		isDrainingQueuedMessageRef.current = true;
		void (async () => {
			let claimedQueuedMessageId: Id<"assistantQueuedMessages"> | null = null;
			try {
				// react-doctor-disable-next-line react-doctor/no-event-handler
				const queuedMessage = await claimQueuedMessage({
					workspaceId: resolvedWorkspaceId,
					// react-doctor-disable-next-line react-doctor/no-event-handler
					chatId,
				});

				if (!queuedMessage) {
					scheduleRetry();
					return;
				}
				claimedQueuedMessageId = queuedMessage._id;

				const preparedQueuedMessage = await fromQueuedUserMessage({
					hasMessageId: (messageId) => localMessageIds.has(messageId),
					queuedMessage,
					resolveConvexToken: getCachedConvexToken,
				});
				latestRequestBodyRef.current = preparedQueuedMessage.body;
				await sendMessage(preparedQueuedMessage.message, {
					body: preparedQueuedMessage.body,
				});
				await discardClaimedMessage({
					queuedMessageId: claimedQueuedMessageId,
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
		discardClaimedMessage,
		isBlocked,
		latestRequestBodyRef,
		localMessageIds,
		queuedMessages,
		requeueClaimedMessage,
		retryNonce,
		scheduleRetry,
		sendMessage,
		workspaceId,
	]);

	return {
		queuedMessages: visibleQueuedMessages,
		setQueuedMessages: updateVisibleQueuedMessages,
	};
};
