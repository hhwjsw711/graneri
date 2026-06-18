import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type QueuedFollowUpMessage = NonNullable<
	FunctionReturnType<typeof api.assistantQueuedMessages.listQueuedForChat>
>[number];

export type QueuedFollowUpCacheKey = string | null;

const EMPTY_QUEUED_FOLLOW_UPS: Array<QueuedFollowUpMessage> = [];
const queuedFollowUpsCache = new Map<string, Array<QueuedFollowUpMessage>>();
const queuedFollowUpsCacheListeners = new Map<string, Set<() => void>>();

export const QUEUED_FOLLOW_UP_DRAIN_RETRY_MS = 400;

export const getQueuedFollowUpCacheKey = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces"> | null | undefined;
}): QueuedFollowUpCacheKey => (workspaceId ? `${workspaceId}:${chatId}` : null);

export const readQueuedFollowUpsCache = (cacheKey: QueuedFollowUpCacheKey) =>
	cacheKey
		? (queuedFollowUpsCache.get(cacheKey) ?? EMPTY_QUEUED_FOLLOW_UPS)
		: EMPTY_QUEUED_FOLLOW_UPS;

export const writeQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	messages: Array<QueuedFollowUpMessage>,
) => {
	if (!cacheKey) {
		return;
	}

	queuedFollowUpsCache.set(cacheKey, messages);
	for (const listener of queuedFollowUpsCacheListeners.get(cacheKey) ?? []) {
		listener();
	}
};

export const updateQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	updater: (
		messages: Array<QueuedFollowUpMessage>,
	) => Array<QueuedFollowUpMessage>,
) =>
	writeQueuedFollowUpsCache(
		cacheKey,
		updater(readQueuedFollowUpsCache(cacheKey)),
	);

export const subscribeQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	listener: () => void,
) => {
	if (!cacheKey) {
		return () => undefined;
	}

	const listeners = queuedFollowUpsCacheListeners.get(cacheKey) ?? new Set();
	listeners.add(listener);
	queuedFollowUpsCacheListeners.set(cacheKey, listeners);

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			queuedFollowUpsCacheListeners.delete(cacheKey);
		}
	};
};

export const shouldDrainQueuedFollowUp = ({
	activeRun,
	hasQueuedMessage,
	isBlocked,
	isDraining,
	workspaceId,
}: {
	activeRun: unknown;
	hasQueuedMessage: boolean;
	isBlocked: boolean;
	isDraining: boolean;
	workspaceId: Id<"workspaces"> | null | undefined;
}) =>
	Boolean(workspaceId) &&
	hasQueuedMessage &&
	!activeRun &&
	!isBlocked &&
	!isDraining;

export const resetQueuedFollowUpsCacheForTest = () => {
	queuedFollowUpsCache.clear();
	queuedFollowUpsCacheListeners.clear();
};
