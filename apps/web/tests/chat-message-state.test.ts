import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	appendLocalOptimisticChatMessages,
	mergePersistedChatMessagesWithController,
	normalizeChatMessages,
} from "@/lib/chat-message-state";
import { applyPendingMessageTruncation } from "@/lib/chat-thread";

const textMessage = ({
	id,
	role,
	text,
}: {
	id: string;
	role: UIMessage["role"];
	text: string;
}): UIMessage => ({
	id,
	role,
	parts: [{ type: "text", text }],
});

describe("normalizeChatMessages", () => {
	it("keeps the latest message for duplicate ids", () => {
		const messages = [
			textMessage({ id: "user-1", role: "user", text: "Prompt" }),
			textMessage({ id: "assistant-1", role: "assistant", text: "old" }),
			textMessage({ id: "assistant-1", role: "assistant", text: "newer" }),
		];

		expect(normalizeChatMessages(messages)).toEqual([messages[0], messages[2]]);
	});

	it("collapses consecutive assistant snapshot and replay messages", () => {
		const userMessage = textMessage({
			id: "user-1",
			role: "user",
			text: "Prompt",
		});
		const activeSnapshot = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "partial assistant text",
		});
		const resumedReplay = textMessage({
			id: "msg-1",
			role: "assistant",
			text: "partial assistant text with more content",
		});

		expect(
			normalizeChatMessages([userMessage, activeSnapshot, resumedReplay]),
		).toEqual([userMessage, resumedReplay]);
	});

	it("keeps assistant messages from separate user turns", () => {
		const messages = [
			textMessage({ id: "user-1", role: "user", text: "First" }),
			textMessage({
				id: "assistant-1",
				role: "assistant",
				text: "First answer",
			}),
			textMessage({ id: "user-2", role: "user", text: "Second" }),
			textMessage({
				id: "assistant-2",
				role: "assistant",
				text: "Second answer",
			}),
		];

		expect(normalizeChatMessages(messages)).toEqual(messages);
	});

	it("keeps consecutive assistant messages when they are not resume overlap", () => {
		const messages = [
			textMessage({ id: "user-1", role: "user", text: "Prompt" }),
			textMessage({
				id: "assistant-1",
				role: "assistant",
				text: "First independent assistant message",
			}),
			textMessage({
				id: "assistant-2",
				role: "assistant",
				text: "Second independent assistant message",
			}),
		];

		expect(normalizeChatMessages(messages)).toEqual(messages);
	});
});

describe("mergePersistedChatMessagesWithController", () => {
	it("anchors active assistant messages after the persisted triggering user turn", () => {
		const persistedMessages = [
			textMessage({ id: "user-1", role: "user", text: "First" }),
			textMessage({
				id: "assistant-1",
				role: "assistant",
				text: "First answer",
			}),
			textMessage({ id: "user-2", role: "user", text: "Second" }),
		];
		const staleControllerMessages = [
			textMessage({ id: "user-1", role: "user", text: "First" }),
			textMessage({
				id: "assistant-1",
				role: "assistant",
				text: "First answer",
			}),
			textMessage({
				id: "stream-1",
				role: "assistant",
				text: "Streaming answer",
			}),
		];
		const activeAssistantMessage = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "Streaming answer",
		});

		expect(
			mergePersistedChatMessagesWithController({
				activeAssistantMessage,
				activeAssistantMessageId: activeAssistantMessage.id,
				controllerMessages: staleControllerMessages,
				persistedMessages,
			}),
		).toEqual([...persistedMessages, activeAssistantMessage]);
	});

	it("drops optimistic user duplicates once the user turn is persisted under another id", () => {
		const persistedUserMessage = textMessage({
			id: "persisted-user-1",
			role: "user",
			text: "Prompt",
		});
		const optimisticUserMessage = textMessage({
			id: "optimistic-user-1",
			role: "user",
			text: "Prompt",
		});
		const activeAssistantMessage = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "Streaming answer",
		});

		expect(
			mergePersistedChatMessagesWithController({
				activeAssistantMessage,
				activeAssistantMessageId: activeAssistantMessage.id,
				controllerMessages: [optimisticUserMessage, activeAssistantMessage],
				persistedMessages: [persistedUserMessage],
			}),
		).toEqual([persistedUserMessage, activeAssistantMessage]);
	});

	it("keeps queued follow-ups after the active assistant message", () => {
		const persistedUserMessage = textMessage({
			id: "persisted-user-1",
			role: "user",
			text: "Prompt",
		});
		const activeAssistantMessage = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "Streaming answer",
		});
		const queuedFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Follow-up",
		});

		expect(
			mergePersistedChatMessagesWithController({
				activeAssistantMessage,
				activeAssistantMessageId: activeAssistantMessage.id,
				controllerMessages: [
					persistedUserMessage,
					activeAssistantMessage,
					queuedFollowUpMessage,
				],
				persistedMessages: [persistedUserMessage],
			}),
		).toEqual([
			persistedUserMessage,
			activeAssistantMessage,
			queuedFollowUpMessage,
		]);
	});

	it("keeps persisted steered follow-ups after the active assistant message", () => {
		const persistedUserMessage = textMessage({
			id: "persisted-user-1",
			role: "user",
			text: "Prompt",
		});
		const activeAssistantMessage = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "Streaming answer",
		});
		const persistedSteeredFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Follow-up",
		});

		expect(
			mergePersistedChatMessagesWithController({
				activeAssistantMessage,
				activeAssistantMessageId: activeAssistantMessage.id,
				controllerMessages: [persistedUserMessage, activeAssistantMessage],
				persistedMessages: [
					persistedUserMessage,
					persistedSteeredFollowUpMessage,
				],
			}),
		).toEqual([
			persistedUserMessage,
			activeAssistantMessage,
			persistedSteeredFollowUpMessage,
		]);
	});

	it("places persisted steered follow-ups before the new active assistant message", () => {
		const persistedUserMessage = textMessage({
			id: "persisted-user-1",
			role: "user",
			text: "Prompt",
		});
		const interruptedAssistantMessage = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "Interrupted streaming answer",
		});
		const persistedSteeredFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Follow-up",
		});
		const newActiveAssistantMessage = textMessage({
			id: "stream-2",
			role: "assistant",
			text: "Steered answer",
		});

		expect(
			mergePersistedChatMessagesWithController({
				activeAssistantMessage: newActiveAssistantMessage,
				activeAssistantMessageId: newActiveAssistantMessage.id,
				controllerMessages: [
					persistedUserMessage,
					interruptedAssistantMessage,
					newActiveAssistantMessage,
				],
				persistedMessages: [
					persistedUserMessage,
					interruptedAssistantMessage,
					persistedSteeredFollowUpMessage,
				],
				persistedQueuedMessagePosition: "before-active",
			}),
		).toEqual([
			persistedUserMessage,
			interruptedAssistantMessage,
			persistedSteeredFollowUpMessage,
			newActiveAssistantMessage,
		]);
	});
});

describe("appendLocalOptimisticChatMessages", () => {
	it("appends unresolved local optimistic messages after the reduced display transcript", () => {
		const persistedUserMessage = textMessage({
			id: "persisted-user-1",
			role: "user",
			text: "Prompt",
		});
		const activeAssistantMessage = textMessage({
			id: "stream-1",
			role: "assistant",
			text: "Streaming answer",
		});
		const optimisticFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Follow-up",
		});

		expect(
			appendLocalOptimisticChatMessages({
				displayMessages: [persistedUserMessage, activeAssistantMessage],
				localOptimisticMessages: [optimisticFollowUpMessage],
			}),
		).toEqual([
			persistedUserMessage,
			activeAssistantMessage,
			optimisticFollowUpMessage,
		]);
	});

	it("reconciles local optimistic messages by id, not by duplicate text", () => {
		const persistedUserMessage = textMessage({
			id: "persisted-user-1",
			role: "user",
			text: "Repeat this",
		});
		const optimisticFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Repeat this",
		});

		expect(
			appendLocalOptimisticChatMessages({
				displayMessages: [persistedUserMessage],
				localOptimisticMessages: [optimisticFollowUpMessage],
			}),
		).toEqual([persistedUserMessage, optimisticFollowUpMessage]);
	});

	it("keeps the local optimistic message authoritative over controller echoes", () => {
		const controllerEchoMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Controller echo",
		});
		const optimisticFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Local optimistic",
		});

		expect(
			appendLocalOptimisticChatMessages({
				displayMessages: [controllerEchoMessage],
				localOptimisticMessages: [optimisticFollowUpMessage],
			}),
		).toEqual([optimisticFollowUpMessage]);
	});

	it("drops local optimistic messages once the same id is persisted", () => {
		const persistedFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Persisted follow-up",
		});
		const optimisticFollowUpMessage = textMessage({
			id: "queued-user-1",
			role: "user",
			text: "Local optimistic",
		});

		expect(
			appendLocalOptimisticChatMessages({
				displayMessages: [persistedFollowUpMessage],
				localOptimisticMessages: [optimisticFollowUpMessage],
				resolvedMessages: [persistedFollowUpMessage],
			}),
		).toEqual([persistedFollowUpMessage]);
	});
});

describe("applyPendingMessageTruncation", () => {
	it("hides a pending deleted branch from stale persisted messages", () => {
		const messages = [
			textMessage({ id: "user-1", role: "user", text: "First" }),
			textMessage({ id: "assistant-1", role: "assistant", text: "Answer" }),
			textMessage({ id: "user-2", role: "user", text: "Delete me" }),
		];

		expect(applyPendingMessageTruncation(messages, "assistant-1")).toEqual([
			messages[0],
		]);
	});

	it("leaves messages unchanged without a pending delete boundary", () => {
		const messages = [
			textMessage({ id: "user-1", role: "user", text: "First" }),
			textMessage({ id: "assistant-1", role: "assistant", text: "Answer" }),
		];

		expect(applyPendingMessageTruncation(messages, null)).toBe(messages);
	});
});
