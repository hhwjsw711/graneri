import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { toast } from "sonner";
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
import {
	drainQueuedChatMessage,
	type QueuedChatSendMessage,
} from "@/lib/queued-chat-drain";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

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
	const pendingDiscardClaimedMessageIdRef =
		React.useRef<Id<"assistantQueuedMessages"> | null>(null);
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
		const queuedMessageCount = queuedMessages?.length ?? 0;
		const hasPendingClaimedMessageCleanup = Boolean(
			pendingDiscardClaimedMessageIdRef.current,
		);
		const hasQueuedMessage =
			queuedMessageCount > 0 || hasPendingClaimedMessageCleanup;

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
			try {
				const drainResult = await drainQueuedChatMessage({
					workspaceId: resolvedWorkspaceId,
					chatId,
					claimQueuedMessage,
					discardClaimedMessage,
					hasMessageId: (messageId) => localMessageIds.has(messageId),
					pendingDiscardClaimedMessageId:
						pendingDiscardClaimedMessageIdRef.current,
					queuedMessageCount,
					resolveConvexToken: getCachedConvexToken,
					sendMessage,
					setLatestRequestBody: (body) => {
						latestRequestBodyRef.current = body;
					},
				});
				pendingDiscardClaimedMessageIdRef.current =
					drainResult.pendingDiscardClaimedMessageId;

				if (drainResult.status === "retry") {
					scheduleRetry();
					return;
				}

				if (drainResult.status === "cleanup_failed") {
					logError({
						event: "client.error",
						error: drainResult.error,
						message: `Failed to discard failed ${contextLabel} message`,
					});
					toast.error("Failed to clean up queued follow-up");
					scheduleRetry();
					return;
				}

				if (drainResult.status === "send_failed") {
					logError({
						event: "client.error",
						error: drainResult.error,
						message: `Failed to drain queued ${contextLabel} message`,
					});
					toast.error(
						drainResult.error instanceof Error
							? drainResult.error.message
							: "Failed to send queued follow-up",
					);
				}
			} catch (error) {
				logError({
					event: "client.error",
					error,
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
