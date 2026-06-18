import type { JSONContent } from "@tiptap/core";
import type { RecipePrompt, RecipeSlug } from "@/lib/recipes";

export const getRecipeSlugFromComposerContent = (
	content: JSONContent,
): RecipeSlug | null => {
	if (content.type === "mention" && typeof content.attrs?.id === "string") {
		return content.attrs.id as RecipeSlug;
	}

	for (const child of content.content ?? []) {
		const recipeSlug = getRecipeSlugFromComposerContent(child);
		if (recipeSlug) {
			return recipeSlug;
		}
	}

	return null;
};

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getComposerContentFromMessage = (
	value: string,
	recipe: Pick<RecipePrompt, "name" | "slug"> | null | undefined,
): JSONContent | string => {
	if (!recipe) {
		return value;
	}

	const recipeMentionPrefixes = [`@${recipe.name}`, recipe.name];
	const recipeMentionText = recipeMentionPrefixes.find((prefix) =>
		value.startsWith(prefix),
	);
	if (!recipeMentionText) {
		return value;
	}

	const trailingText = value.slice(recipeMentionText.length);
	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [
					{
						type: "mention",
						attrs: {
							id: recipe.slug,
							label: recipe.name,
						},
					},
					...(trailingText
						? [
								{
									type: "text",
									text: trailingText,
								},
							]
						: []),
				],
			},
		],
	};
};

export const getMessageTextWithoutRecipeMention = (
	value: string,
	recipe: Pick<RecipePrompt, "name"> | null | undefined,
) => {
	const nextValue = value.trim();

	if (!recipe) {
		return nextValue;
	}

	return nextValue
		.replace(
			new RegExp(`(^|\\s)@?${escapeRegExp(recipe.name)}(?=\\s|$)`, "u"),
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
};
