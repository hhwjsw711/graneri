import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
type AttachableRun =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;
type QueuedMessage = NonNullable<
	FunctionReturnType<typeof api.assistantQueuedMessages.listQueuedForChat>
>[number];

const QUEUED_MESSAGE_DRAIN_RETRY_MS = 400;
const EMPTY_QUEUED_MESSAGES: Array<QueuedMessage> = [];
const queuedMessagesCache = new Map<string, Array<QueuedMessage>>();
const queuedMessagesCacheListeners = new Map<string, Set<() => void>>();

const getQueuedMessagesCacheKey = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => (workspaceId ? `${workspaceId}:${chatId}` : null);

const readQueuedMessagesCache = (cacheKey: string | null) =>
	cacheKey
		? (queuedMessagesCache.get(cacheKey) ?? EMPTY_QUEUED_MESSAGES)
		: EMPTY_QUEUED_MESSAGES;

const writeQueuedMessagesCache = (
	cacheKey: string | null,
	messages: Array<QueuedMessage>,
) => {
	if (!cacheKey) {
		return;
	}

	queuedMessagesCache.set(cacheKey, messages);
	for (const listener of queuedMessagesCacheListeners.get(cacheKey) ?? []) {
		listener();
	}
};

const subscribeQueuedMessagesCache = (
	cacheKey: string | null,
	listener: () => void,
) => {
	if (!cacheKey) {
		return () => undefined;
	}

	const listeners = queuedMessagesCacheListeners.get(cacheKey) ?? new Set();
	listeners.add(listener);
	queuedMessagesCacheListeners.set(cacheKey, listeners);

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			queuedMessagesCacheListeners.delete(cacheKey);
		}
	};
};

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
		() => getQueuedMessagesCacheKey({ workspaceId, chatId }),
		[chatId, workspaceId],
	);
	const getVisibleQueuedMessagesSnapshot = React.useCallback(
		() => readQueuedMessagesCache(queuedMessagesCacheKey),
		[queuedMessagesCacheKey],
	);
	const subscribeVisibleQueuedMessages = React.useCallback(
		(listener: () => void) =>
			subscribeQueuedMessagesCache(queuedMessagesCacheKey, listener),
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

		writeQueuedMessagesCache(queuedMessagesCacheKey, queuedMessages);
	}, [queuedMessages, queuedMessagesCacheKey]);

	const updateVisibleQueuedMessages = React.useCallback(
		(updater: (messages: Array<QueuedMessage>) => Array<QueuedMessage>) => {
			writeQueuedMessagesCache(
				queuedMessagesCacheKey,
				updater(readQueuedMessagesCache(queuedMessagesCacheKey)),
			);
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
		}, QUEUED_MESSAGE_DRAIN_RETRY_MS);
	}, []);

	React.useEffect(() => {
		void retryNonce;
		const hasQueuedMessage = (queuedMessages?.length ?? 0) > 0;

		if (
			!workspaceId ||
			!hasQueuedMessage ||
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
				// react-doctor-disable-next-line react-doctor/no-event-handler
				const queuedMessage = await claimQueuedMessage({ workspaceId, chatId });

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
