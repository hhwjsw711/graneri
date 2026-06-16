import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const recipeFields = {
	_id: v.id("recipes"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	slug: v.string(),
	name: v.string(),
	prompt: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const recipePayloadValidator = v.object({
	slug: v.string(),
	name: v.string(),
	prompt: v.string(),
});

const REMOVE_ALL_RECIPES_BATCH_SIZE = 50;
const MAX_RECIPES = 10;

const WRITE_PRD_DEFAULT_PROMPT = `Write a PRD in the style of a strong product lead: clear, structured, concise, and grounded in evidence from my meetings.

Start with an interactive discovery flow before drafting:

1. First response should say:
"I'm going to ask you a few questions before filling out this PRD. First up: what would you like a PRD for? I can scan your recent meetings and draft one, or you can name the project."

2. Propose up to 3 likely candidates in this format:
**Project:** <inferred title>
- **Why it's a match:** <1 line>

3. Wait for the user to pick one candidate or provide a new project name.

4. After selection, use only the chosen meeting(s) and clearly related follow-ups from the next 14 days with the same project keywords or participants. Do not merge unrelated threads.

5. Before writing the full PRD, produce a one-sentence problem hypothesis based on the selected meetings and ask for confirmation.

6. Only after confirmation, write the PRD.

Writing rules:
- Be concrete and concise.
- Do not invent metrics, customer evidence, or designs. If something is unknown, say so and note the assumption or open question.
- Spend most of the depth on the problem, evidence, success criteria, audience, and rough solution.
- Keep the problem statement short, focused, solution-agnostic, and tied to a real user or business need.
- Leave a blank line between major sections.

Use this exact structure:

**1. Description: What is it?**
Describe the project so someone can quickly understand what it is and why it matters.

**2. Problem: What problem is this solving**

**2a. What is the problem this project addresses? (Ideally in 1 sentence)**
- <response>

**2b. What is your hypothesis for why this problem is happening?**
- <response>

**2c. What problems are you NOT solving?**
- <response>

**3. Why: How do we know this is a real problem and worth solving?**

Business Impact:
- <2-3 strong data points or evidence statements>

Customer Impact:
- <2-3 bullet points>

**4. Success: How do we know if we've solved this problem?**
Define specific, measurable goals tied to team or business outcomes. If precise metrics are not available, describe concrete success states and call out missing data.

**5. Audience: Who are we building for?**
Be concise and specific.

**6. What: Roughly, what does this look like in the product?**
Describe the rough solution shape. Link to designs if available.`;

const SALES_QUESTIONS_DEFAULT_PROMPT = `Act as a strong B2B sales consultant during a live call. Based only on what the prospect has said so far, suggest the next-best questions I should ask and the follow-up language I can use immediately after each answer.

Goal:
- Help me understand the prospect's pain, urgency, desired outcome, buying process, constraints, and next step.
- Increase the chance of a real, value-based next step or close.

Tone:
- Natural, conversational, direct, calm, and human.
- Consultative, not pushy.
- Confident, not aggressive.
- Do not sound robotic, manipulative, or overly scripted.

Style references:
- Draw loosely from Jordan Belfort, Shelby Haas, Alex Hormozi, Brian Tracy, and other strong sales operators, but prioritize clarity and authenticity over imitation.

Output rules:
- Base every question on the specific context from the current call.
- Do not repeat what has already been answered.
- Avoid generic discovery questions unless they clearly fit the moment.
- Ask questions that move the deal forward.
- Use assumptive language only when it feels earned by the conversation.
- Never use fake urgency or hype.

Output format:
For each suggestion, provide:
**Question:** <the exact question to ask>
**Why ask this now:** <1 short line>
**Follow-up language:** <1-3 sentences I can say after they answer>

Return 5 suggestions max, ordered by what I should ask next.`;

const WRITE_WEEKLY_RECAP_DEFAULT_PROMPT = `Write a weekly recap for my team so they can quickly understand what I worked on, what I accomplished, and what matters next.

Date rule:
- Always focus on a full calendar week.
- Determine today's date first.
- If today is Sunday, Monday, Tuesday, or Wednesday, recap the previous calendar week.
- If today is Thursday, Friday, or Saturday, recap the current calendar week.

Writing rules:
- Be concise, concrete, and easy to scan.
- Focus on outcomes, shipped work, decisions, progress, notable meetings, and meaningful support provided to others.
- Do not pad with low-value status updates.
- If something is incomplete, frame it as progress or an open thread.
- If the source material is thin, make the best recap possible from available context and clearly avoid inventing work.

Use this structure:
**Week of:** <date range>

**Topline**
- <2-3 bullets on the most important outcomes>

**What I worked on**
- <4-8 bullets with concrete accomplishments or progress>

**Key decisions / learnings**
- <0-3 bullets>

**Open threads / next up**
- <2-4 bullets>

Tone:
- Crisp, professional, and team-readable.
- Sound like a thoughtful teammate, not a performance review.`;

const defaultRecipes = [
	{
		slug: "write-prd",
		name: "Write PRD",
		prompt: WRITE_PRD_DEFAULT_PROMPT,
	},
	{
		slug: "sales-questions",
		name: "Sales questions",
		prompt: SALES_QUESTIONS_DEFAULT_PROMPT,
	},
	{
		slug: "write-weekly-recap",
		name: "Write weekly recap",
		prompt: WRITE_WEEKLY_RECAP_DEFAULT_PROMPT,
	},
] as const satisfies ReadonlyArray<{
	slug: string;
	name: string;
	prompt: string;
}>;

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access recipes.",
		});
	}

	return identity;
};

const requireOwnedWorkspace = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const workspace = await ctx.db.get(workspaceId);

	if (!workspace || workspace.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "WORKSPACE_NOT_FOUND",
			message: "Workspace not found.",
		});
	}
};

const normalizeWhitespace = (value: string) => value.trim();

const normalizeRecipePayload = (
	recipe:
		| (typeof defaultRecipes)[number]
		| {
				slug: string;
				name: string;
				prompt: string;
		  },
) => ({
	slug: recipe.slug,
	name: normalizeWhitespace(recipe.name),
	prompt: normalizeWhitespace(recipe.prompt),
});

export const seedDefaultRecipesForWorkspace = async ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
	now,
}: {
	ctx: MutationCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
	now: number;
}) => {
	await Promise.all(
		defaultRecipes.map((recipe) => {
			const normalizedRecipe = normalizeRecipePayload(recipe);

			return ctx.db.insert("recipes", {
				ownerTokenIdentifier,
				workspaceId,
				slug: normalizedRecipe.slug,
				name: normalizedRecipe.name,
				prompt: normalizedRecipe.prompt,
				createdAt: now,
				updatedAt: now,
			});
		}),
	);
};

const deleteRecipeBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const recipes = await ctx.db
		.query("recipes")
		.withIndex("by_ownerTokenIdentifier_and_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_RECIPES_BATCH_SIZE);

	await Promise.all(recipes.map((recipe) => ctx.db.delete(recipe._id)));

	return {
		deletedCount: recipes.length,
		hasMore: recipes.length === REMOVE_ALL_RECIPES_BATCH_SIZE,
	};
};

const deleteRecipeBatchForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const recipes = await ctx.db
		.query("recipes")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(REMOVE_ALL_RECIPES_BATCH_SIZE);

	await Promise.all(recipes.map((recipe) => ctx.db.delete(recipe._id)));

	return {
		deletedCount: recipes.length,
		hasMore: recipes.length === REMOVE_ALL_RECIPES_BATCH_SIZE,
	};
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(recipePayloadValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const recipes = await ctx.db
			.query("recipes")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", identity.tokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(MAX_RECIPES);

		return recipes.map((recipe) =>
			normalizeRecipePayload({
				slug: recipe.slug,
				name: recipe.name,
				prompt: recipe.prompt,
			}),
		);
	},
});

export const saveAll = mutation({
	args: {
		recipes: v.array(recipePayloadValidator),
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(recipePayloadValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const nextRecipes = args.recipes
			.slice(0, MAX_RECIPES)
			.map(normalizeRecipePayload);

		const seenSlugs = new Set<string>();
		for (const recipe of nextRecipes) {
			if (!recipe.slug) {
				throw new ConvexError({
					code: "INVALID_RECIPE",
					message: "Recipe slug is required.",
				});
			}

			if (!recipe.name) {
				throw new ConvexError({
					code: "INVALID_RECIPE",
					message: "Recipe name is required.",
				});
			}

			if (!recipe.prompt) {
				throw new ConvexError({
					code: "INVALID_RECIPE",
					message: "Recipe prompt is required.",
				});
			}

			if (seenSlugs.has(recipe.slug)) {
				throw new ConvexError({
					code: "DUPLICATE_RECIPE",
					message: "Recipe slugs must be unique.",
				});
			}

			seenSlugs.add(recipe.slug);
		}

		const existingRecipes = await ctx.db
			.query("recipes")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(MAX_RECIPES);

		await Promise.all(
			existingRecipes.map((recipe) => ctx.db.delete(recipe._id)),
		);

		const now = Date.now();
		for (const recipe of nextRecipes) {
			await ctx.db.insert("recipes", {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				slug: recipe.slug,
				name: recipe.name,
				prompt: recipe.prompt,
				createdAt: now,
				updatedAt: now,
			});
		}

		return nextRecipes;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteRecipeBatch(ctx, args.ownerTokenIdentifier);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.recipes.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteRecipeBatchForWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.recipes.removeAllForWorkspace, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return null;
	},
});

export const recipeValidator = v.object(recipeFields);
