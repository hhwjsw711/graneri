import { describe, expect, it } from "vitest";
import {
	getComposerContentFromMessage,
	getMessageTextWithoutRecipeMention,
	getRecipeSlugFromComposerContent,
} from "@/components/note/note-composer-recipe-mentions";
import type { RecipePrompt } from "@/lib/recipes";

const recipe = {
	name: "Meeting Summary",
	slug: "meeting-summary",
	prompt: "Summarize this meeting",
} satisfies RecipePrompt;

describe("note composer recipe mentions", () => {
	it("finds the first recipe mention slug in editor content", () => {
		expect(
			getRecipeSlugFromComposerContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "text", text: "Use " },
							{
								type: "mention",
								attrs: {
									id: "meeting-summary",
									label: "Meeting Summary",
								},
							},
						],
					},
				],
			}),
		).toBe("meeting-summary");
	});

	it("returns plain text when message content does not begin with the selected recipe", () => {
		expect(getComposerContentFromMessage("Use @Meeting Summary", recipe)).toBe(
			"Use @Meeting Summary",
		);
		expect(getComposerContentFromMessage("@Meeting Summary", null)).toBe(
			"@Meeting Summary",
		);
	});

	it("rebuilds editor JSON when message content begins with a recipe mention", () => {
		expect(
			getComposerContentFromMessage("@Meeting Summary include actions", recipe),
		).toEqual({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "mention",
							attrs: {
								id: "meeting-summary",
								label: "Meeting Summary",
							},
						},
						{
							type: "text",
							text: " include actions",
						},
					],
				},
			],
		});
		expect(getComposerContentFromMessage("Meeting Summary", recipe)).toEqual({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "mention",
							attrs: {
								id: "meeting-summary",
								label: "Meeting Summary",
							},
						},
					],
				},
			],
		});
	});

	it("strips selected recipe mentions from submitted message text", () => {
		expect(
			getMessageTextWithoutRecipeMention(
				"  @Meeting Summary   include actions  ",
				recipe,
			),
		).toBe("include actions");
		expect(
			getMessageTextWithoutRecipeMention(
				"Before Meeting Summary after",
				recipe,
			),
		).toBe("Before after");
		expect(getMessageTextWithoutRecipeMention("  keep text  ", null)).toBe(
			"keep text",
		);
	});
});
