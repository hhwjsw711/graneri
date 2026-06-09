import { describe, expect, it } from "vitest";
import { deriveFallbackChatTitle } from "../../../packages/ai/src/chat-titles.mjs";
import {
	buildHostedChatRuntimePrompt,
	buildHostedChatSaveMessageArgs,
	buildHostedNotesContext,
	fromHostedStoredMessages,
	getStoredHostedNoteContext,
	prepareHostedChatBranch,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import {
	buildApplyTemplatePrompt,
	buildChatSystemPrompt,
	buildEnhancedNotePrompt,
	CHAT_TITLE_SYSTEM_PROMPT,
} from "../../../packages/ai/src/prompts.mjs";

describe("prompt helpers", () => {
	it("skips nullable user profile fields in the chat system prompt", () => {
		expect(() =>
			buildChatSystemPrompt({
				userProfileContext: {
					name: null,
					jobTitle: null,
					companyName: null,
				},
			}),
		).not.toThrow();
	});

	it("accepts nullable note fields in note prompts", () => {
		expect(() =>
			buildEnhancedNotePrompt({
				title: null,
				rawNotes: null,
				transcript: null,
				noteText: null,
			}),
		).not.toThrow();
		expect(() =>
			buildApplyTemplatePrompt({
				title: null,
				templateName: null,
				meetingContext: null,
				templateSections: [],
				noteText: null,
			}),
		).not.toThrow();
	});

	it("tells chat title generation to preserve proper-name capitalization", () => {
		expect(CHAT_TITLE_SYSTEM_PROMPT).toContain(
			"Preserve the original capitalization of proper nouns",
		);
		expect(CHAT_TITLE_SYSTEM_PROMPT).toContain("OpenAI");
		expect(CHAT_TITLE_SYSTEM_PROMPT).toContain("Cirrus Labs");
	});

	it("preserves organization and people name casing in fallback chat titles", () => {
		expect(
			deriveFallbackChatTitle({
				userText: "why did OpenAI hire Sam Altman for GPT-5 work?",
			}),
		).toBe("OpenAI hire Sam Altman");
	});

	it("includes selected app source instructions in hosted chat runtime prompts", () => {
		const prompt = buildHostedChatRuntimePrompt({
			selectedAppSourceInstructions:
				"The selected app source for this chat is Linear.",
		});

		expect(prompt).toContain(
			"The selected app source for this chat is Linear.",
		);
	});

	it("formats attached hosted note context consistently", () => {
		const context = buildHostedNotesContext([
			{ title: "Decision log", searchableText: "Ship desktop first." },
			{ title: "Empty note", searchableText: "" },
		]);

		expect(context).toContain(
			"Attached notes are available below. Use them when they are relevant to the user's request.",
		);
		expect(context).toContain("Note 1: Decision log\nShip desktop first.");
		expect(context).toContain("Note 2: Empty note\n(empty note)");
	});

	it("omits attached hosted note context when no notes are selected", () => {
		expect(buildHostedNotesContext([])).toBe("");
	});

	it("formats stored hosted note context consistently", () => {
		const context = getStoredHostedNoteContext({
			title: "Planning",
			searchableText: "Line 1\r\nLine 2",
		});

		expect(context).toContain(
			"The current note is attached below. Use it as the primary context for this chat.",
		);
		expect(context).toContain("Current note title: Planning");
		expect(context).toContain("Current note content:\nLine 1\nLine 2");
	});

	it("omits stored hosted note context when the note is unavailable", () => {
		expect(getStoredHostedNoteContext(null)).toBe("");
	});

	it("builds hosted chat save message arguments consistently", () => {
		const saved = buildHostedChatSaveMessageArgs({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			noteId: null,
			title: "Generated title",
			model: "gpt-5",
			reasoningEffort: "medium",
			message: {
				id: "msg-1",
				role: "user",
				parts: [{ type: "text", text: "Hello from Graneri" }],
			},
		});

		expect(saved.workspaceId).toBe("workspace-1");
		expect(saved.chatId).toBe("chat-1");
		expect(saved.noteId).toBeUndefined();
		expect(saved.title).toBe("Generated title");
		expect(saved.preview).toBe("Hello from Graneri");
		expect(saved.model).toBe("gpt-5");
		expect(saved.reasoningEffort).toBe("medium");
		expect(saved.message.id).toBe("msg-1");
		expect(saved.message.text).toBe("Hello from Graneri");
	});

	it("replays stored hosted messages with tolerant parsing", () => {
		const messages = fromHostedStoredMessages([
			{
				id: "invalid-parts",
				role: "assistant",
				partsJson: "{",
				metadataJson: '{"status":"ignored"}',
			},
			{
				id: "empty-parts",
				role: "assistant",
				partsJson: JSON.stringify([{ type: "file", url: "file://local" }]),
			},
			{
				id: "valid-text",
				role: "user",
				partsJson: JSON.stringify([
					{ type: "text", text: "Replay this" },
					{ type: "text", text: "" },
				]),
				metadataJson: "{",
			},
		]);

		expect(messages).toEqual([
			{
				id: "valid-text",
				role: "user",
				metadata: undefined,
				parts: [{ type: "text", text: "Replay this" }],
			},
		]);
	});

	it("prepares edited hosted chat branches from stored snapshots", () => {
		const branch = prepareHostedChatBranch({
			message: {
				id: "edited-message",
				role: "user",
				parts: [{ type: "text", text: "Edited question" }],
			},
			messageId: "msg-2",
			storedMessages: [
				{
					id: "msg-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Original" }]),
				},
				{
					id: "msg-2",
					role: "assistant",
					partsJson: JSON.stringify([{ type: "text", text: "Old answer" }]),
				},
			],
			trigger: "submit-message",
		});

		expect(branch.editedMessageIndex).toBe(1);
		expect(branch.shouldTruncateChatBranch).toBe(true);
		expect(branch.truncateMessageId).toBe("msg-2");
		expect(branch.incomingMessages.map((message) => message.id)).toEqual([
			"msg-1",
			"edited-message",
		]);
	});

	it("prepares regenerated hosted chat branches even when the snapshot is stale", () => {
		const branch = prepareHostedChatBranch({
			message: {
				id: "retry-message",
				role: "user",
				parts: [{ type: "text", text: "Try again" }],
			},
			messageId: "missing-message",
			storedMessages: [],
			trigger: "regenerate-message",
		});

		expect(branch.editedMessageIndex).toBe(-1);
		expect(branch.shouldTruncateChatBranch).toBe(true);
		expect(branch.truncateMessageId).toBe("missing-message");
		expect(branch.incomingMessages).toHaveLength(1);
	});
});
