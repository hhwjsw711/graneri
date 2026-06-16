import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { normalizeChatMessages } from "@/lib/chat-message-state";

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
