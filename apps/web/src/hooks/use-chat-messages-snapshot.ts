import { useConvex } from "convex/react";
import * as React from "react";
import type { StoredChatMessage } from "@/lib/chat-snapshot";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type ConvexClient = ReturnType<typeof useConvex>;
type SnapshotCacheEntry = {
	messages?: StoredChatMessage[];
	promise?: Promise<StoredChatMessage[]>;
};

const CHAT_MESSAGES_SNAPSHOT_CACHE_LIMIT = 24;
const chatMessagesSnapshotCache = new Map<string, SnapshotCacheEntry>();

const getChatMessagesSnapshotCacheKey = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces">;
}) => `${workspaceId}:${chatId}`;

const getChatMessagesSnapshotCacheEntry = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces">;
}) =>
	chatMessagesSnapshotCache.get(
		getChatMessagesSnapshotCacheKey({
			chatId,
			workspaceId,
		}),
	);

const writeChatMessagesSnapshotCacheEntry = ({
	chatId,
	workspaceId,
	entry,
}: {
	chatId: string;
	workspaceId: Id<"workspaces">;
	entry: SnapshotCacheEntry;
}) => {
	const cacheKey = getChatMessagesSnapshotCacheKey({
		chatId,
		workspaceId,
	});

	chatMessagesSnapshotCache.delete(cacheKey);
	chatMessagesSnapshotCache.set(cacheKey, entry);

	while (chatMessagesSnapshotCache.size > CHAT_MESSAGES_SNAPSHOT_CACHE_LIMIT) {
		const oldestEntry = chatMessagesSnapshotCache.keys().next().value;
		if (!oldestEntry) {
			break;
		}

		chatMessagesSnapshotCache.delete(oldestEntry);
	}
};

const getCachedChatMessagesSnapshot = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces">;
}) => getChatMessagesSnapshotCacheEntry({ chatId, workspaceId })?.messages;

export const prefetchChatMessagesSnapshot = async ({
	chatId,
	convex,
	force = false,
	workspaceId,
}: {
	chatId: string;
	convex: ConvexClient;
	force?: boolean;
	workspaceId: Id<"workspaces">;
}) => {
	const cachedEntry = getChatMessagesSnapshotCacheEntry({
		chatId,
		workspaceId,
	});

	if (cachedEntry?.promise) {
		return cachedEntry.promise;
	}

	if (!force && cachedEntry?.messages !== undefined) {
		return cachedEntry.messages;
	}

	const promise = convex
		.query(api.chats.getMessagesSnapshot, {
			workspaceId,
			chatId,
		})
		.then((messages) => {
			writeChatMessagesSnapshotCacheEntry({
				chatId,
				workspaceId,
				entry: {
					messages,
				},
			});
			return messages;
		})
		.catch((error) => {
			writeChatMessagesSnapshotCacheEntry({
				chatId,
				workspaceId,
				entry: cachedEntry?.messages
					? {
							messages: cachedEntry.messages,
						}
					: {},
			});
			throw error;
		});

	writeChatMessagesSnapshotCacheEntry({
		chatId,
		workspaceId,
		entry: {
			messages: cachedEntry?.messages,
			promise,
		},
	});

	return promise;
};

export const useChatMessagesSnapshot = ({
	chatId,
	workspaceId,
	enabled = true,
}: {
	chatId: string | null;
	workspaceId: Id<"workspaces"> | null;
	enabled?: boolean;
}) => {
	const convex = useConvex();
	const activeCacheKey =
		enabled && chatId && workspaceId
			? getChatMessagesSnapshotCacheKey({
					chatId,
					workspaceId,
				})
			: null;
	const cachedMessages =
		enabled && chatId && workspaceId
			? getCachedChatMessagesSnapshot({
					chatId,
					workspaceId,
				})
			: [];
	const [messages, setMessages] = React.useState<
		StoredChatMessage[] | undefined
	>(cachedMessages);
	const [isFetching, setIsFetching] = React.useState(false);
	const setSnapshotState = React.useCallback(
		({
			isFetching: nextIsFetching,
			messages: nextMessages,
		}: {
			isFetching: boolean;
			messages: StoredChatMessage[] | undefined;
		}) => {
			setMessages(nextMessages);
			setIsFetching(nextIsFetching);
		},
		[],
	);
	const requestIdRef = React.useRef(0);
	const lastRequestedCacheKeyRef = React.useRef<string | null>(null);

	const refresh = React.useCallback(async () => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;

		if (!enabled || !chatId || !workspaceId) {
			setSnapshotState({ isFetching: false, messages: [] });
			lastRequestedCacheKeyRef.current = null;
			return [];
		}

		setIsFetching(true);

		try {
			const result = await prefetchChatMessagesSnapshot({
				chatId,
				convex,
				force: true,
				workspaceId,
			});

			if (requestIdRef.current === requestId) {
				React.startTransition(() => {
					setSnapshotState({ isFetching: false, messages: result });
				});
			}

			return result;
		} catch (error) {
			if (requestIdRef.current === requestId) {
				React.startTransition(() => {
					setSnapshotState({ isFetching: false, messages: [] });
				});
			}

			console.error("Failed to load chat messages snapshot", error);

			return [];
		}
	}, [chatId, convex, enabled, setSnapshotState, workspaceId]);

	// react-doctor-disable-next-line react-doctor/no-derived-state
	React.useEffect(() => {
		requestIdRef.current += 1;

		if (!enabled || !chatId || !workspaceId) {
			// react-doctor-disable-next-line react-doctor/no-derived-state
			setSnapshotState({ isFetching: false, messages: [] });
			lastRequestedCacheKeyRef.current = null;
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		setSnapshotState({
			isFetching: false,
			messages: getCachedChatMessagesSnapshot({
				chatId,
				workspaceId,
			}),
		});
		lastRequestedCacheKeyRef.current = null;
	}, [chatId, enabled, setSnapshotState, workspaceId]);

	// react-doctor-disable-next-line react-doctor/no-derived-state
	React.useEffect(() => {
		if (
			!activeCacheKey ||
			!enabled ||
			!chatId ||
			!workspaceId ||
			isFetching ||
			lastRequestedCacheKeyRef.current === activeCacheKey
		) {
			return;
		}

		lastRequestedCacheKeyRef.current = activeCacheKey;
		void refresh();
	}, [activeCacheKey, chatId, enabled, isFetching, refresh, workspaceId]);

	return {
		messages,
		isLoading:
			Boolean(enabled && chatId && workspaceId) &&
			(messages === undefined || isFetching),
		refresh,
	};
};
