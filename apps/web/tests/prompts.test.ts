import { describe, expect, it } from "vitest";
import { deriveFallbackChatTitle } from "../../../packages/ai/src/chat-titles.mjs";
import {
	buildHostedChatRuntimePrompt,
	buildHostedNotesContext,
	getStoredHostedNoteContext,
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
});
