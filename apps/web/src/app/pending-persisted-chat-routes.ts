export const PENDING_PERSISTED_CHAT_ROUTE_LIMIT = 8;

export type PendingPersistedChatRoutesStore = {
	add: (chatId: string) => void;
	getSnapshot: () => readonly string[];
	remove: (chatId: string) => void;
	subscribe: (listener: () => void) => () => void;
};

export const createPendingPersistedChatRoutesStore =
	(): PendingPersistedChatRoutesStore => {
		let chatIds: readonly string[] = [];
		const listeners = new Set<() => void>();

		const emitChange = () => {
			for (const listener of listeners) {
				listener();
			}
		};

		const updateChatIds = (nextChatIds: readonly string[]) => {
			if (nextChatIds === chatIds) {
				return;
			}

			chatIds = nextChatIds;
			emitChange();
		};

		return {
			add: (chatId) => {
				if (chatIds.includes(chatId)) {
					return;
				}

				updateChatIds(
					[...chatIds, chatId].slice(-PENDING_PERSISTED_CHAT_ROUTE_LIMIT),
				);
			},
			getSnapshot: () => chatIds,
			remove: (chatId) => {
				if (!chatIds.includes(chatId)) {
					return;
				}

				updateChatIds(chatIds.filter((currentId) => currentId !== chatId));
			},
			subscribe: (listener) => {
				listeners.add(listener);

				return () => {
					listeners.delete(listener);
				};
			},
		};
	};
