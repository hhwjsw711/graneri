import { describe, expect, it } from "vitest";
import {
	getResolvingPersistedChatIds,
	resolveCollectionRoute,
} from "@/app/resource-route";
import type { Doc } from "../../../convex/_generated/dataModel";

const chatDoc = (id: string) =>
	({
		chatId: id,
	}) as Doc<"chats">;

describe("resource route resolution", () => {
	it("resolves collection route states behind one interface", () => {
		const items = [{ id: "project-1" }];

		expect(
			resolveCollectionRoute({
				currentView: "home",
				expectedView: "project",
				id: "project-1",
				items,
				matches: (item, id) => item.id === id,
			}),
		).toEqual({ status: "inactive" });
		expect(
			resolveCollectionRoute({
				currentView: "project",
				expectedView: "project",
				id: null,
				items,
				matches: (item, id) => item.id === id,
				missingWhenIdNull: true,
			}),
		).toEqual({ status: "missing" });
		expect(
			resolveCollectionRoute({
				currentView: "project",
				expectedView: "project",
				id: "project-1",
				items: undefined,
				matches: (item: { id: string }, id) => item.id === id,
			}),
		).toEqual({ status: "resolving" });
		expect(
			resolveCollectionRoute({
				currentView: "project",
				expectedView: "project",
				id: "project-1",
				items,
				matches: (item, id) => item.id === id,
			}),
		).toEqual({ status: "ready", value: items[0] });
		expect(
			resolveCollectionRoute({
				currentView: "project",
				expectedView: "project",
				id: "project-2",
				items,
				matches: (item, id) => item.id === id,
				resolvingIds: new Set(["project-2"]),
			}),
		).toEqual({ status: "resolving" });
		expect(
			resolveCollectionRoute({
				currentView: "project",
				expectedView: "project",
				id: "project-3",
				items,
				matches: (item, id) => item.id === id,
			}),
		).toEqual({ status: "missing" });
	});

	it("tracks only pending persisted chat ids missing from the listed chats", () => {
		expect(
			getResolvingPersistedChatIds({
				chats: undefined,
				pendingPersistedChatRouteIds: ["chat-1", "chat-2"],
			}),
		).toEqual(new Set(["chat-1", "chat-2"]));
		expect(
			getResolvingPersistedChatIds({
				chats: [chatDoc("chat-1")],
				pendingPersistedChatRouteIds: ["chat-1", "chat-2"],
			}),
		).toEqual(new Set(["chat-2"]));
		expect(
			getResolvingPersistedChatIds({
				chats: [chatDoc("chat-1"), chatDoc("chat-2")],
				pendingPersistedChatRouteIds: ["chat-1", "chat-2"],
			}),
		).toEqual(new Set());
	});
});
