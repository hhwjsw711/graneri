import { describe, expect, it } from "vitest";
import { deriveFallbackChatTitle } from "../../../packages/ai/src/chat-titles.mjs";
import { buildHostedChatRuntimePrompt } from "../../../packages/ai/src/hosted-chat-runtime.mjs";
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
});
