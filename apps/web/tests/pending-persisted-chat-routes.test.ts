import { describe, expect, it, vi } from "vitest";
import {
	createPendingPersistedChatRoutesStore,
	PENDING_PERSISTED_CHAT_ROUTE_LIMIT,
} from "@/app/pending-persisted-chat-routes";

describe("pending persisted chat routes", () => {
	it("deduplicates chat ids and keeps only the most recent route ids", () => {
		const store = createPendingPersistedChatRoutesStore();

		store.add("chat-1");
		store.add("chat-1");

		expect(store.getSnapshot()).toEqual(["chat-1"]);

		for (
			let index = 2;
			index <= PENDING_PERSISTED_CHAT_ROUTE_LIMIT + 2;
			index++
		) {
			store.add(`chat-${index}`);
		}

		expect(store.getSnapshot()).toEqual([
			"chat-3",
			"chat-4",
			"chat-5",
			"chat-6",
			"chat-7",
			"chat-8",
			"chat-9",
			"chat-10",
		]);
	});

	it("removes existing ids and ignores missing ids without notifying", () => {
		const store = createPendingPersistedChatRoutesStore();
		const listener = vi.fn();
		store.subscribe(listener);

		store.add("chat-1");
		store.add("chat-2");
		store.remove("chat-1");
		store.remove("missing");

		expect(store.getSnapshot()).toEqual(["chat-2"]);
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it("unsubscribes listeners", () => {
		const store = createPendingPersistedChatRoutesStore();
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);

		store.add("chat-1");
		unsubscribe();
		store.add("chat-2");

		expect(listener).toHaveBeenCalledTimes(1);
	});
});
