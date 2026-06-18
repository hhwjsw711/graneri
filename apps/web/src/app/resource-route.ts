import type { AppView } from "@/app/app-types";
import { getChatId } from "@/lib/chat";
import type { Doc } from "../../../../convex/_generated/dataModel";

const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

export type ResourceRouteState<T> =
	| { status: "inactive" }
	| { status: "ready"; value: T | null }
	| { status: "resolving" }
	| { status: "missing" };

export const resolveCollectionRoute = <T>({
	currentView,
	expectedView,
	id,
	items,
	matches,
	missingWhenIdNull = false,
	resolvingIds,
}: {
	currentView: AppView;
	expectedView: AppView;
	id: string | null;
	items: T[] | undefined;
	matches: (item: T, id: string) => boolean;
	missingWhenIdNull?: boolean;
	resolvingIds?: ReadonlySet<string>;
}): ResourceRouteState<T> => {
	if (currentView !== expectedView) {
		return { status: "inactive" };
	}

	if (id === null) {
		return missingWhenIdNull
			? { status: "missing" }
			: { status: "ready", value: null };
	}

	if (items === undefined) {
		return { status: "resolving" };
	}

	const value = items.find((item) => matches(item, id));
	if (value) {
		return { status: "ready", value };
	}

	return resolvingIds?.has(id)
		? { status: "resolving" }
		: { status: "missing" };
};

export const getResolvingPersistedChatIds = ({
	chats,
	pendingPersistedChatRouteIds,
}: {
	chats: Array<Doc<"chats">> | undefined;
	pendingPersistedChatRouteIds: readonly string[];
}): ReadonlySet<string> => {
	if (pendingPersistedChatRouteIds.length === 0) {
		return EMPTY_STRING_SET;
	}

	if (!chats) {
		return new Set(pendingPersistedChatRouteIds);
	}

	const listedChatIds = new Set(chats.map(getChatId));
	const unresolvedChatIds = pendingPersistedChatRouteIds.filter(
		(chatId) => !listedChatIds.has(chatId),
	);

	return unresolvedChatIds.length > 0
		? new Set(unresolvedChatIds)
		: EMPTY_STRING_SET;
};
