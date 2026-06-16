import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

test("workspace creation seeds default templates and recipes as stored rows", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const workspace = await asOwner.mutation(api.workspaces.create, {
		name: "Workspace",
	});

	const [templates, recipes] = await Promise.all([
		asOwner.query(api.templates.list, { workspaceId: workspace._id }),
		asOwner.query(api.recipes.list, { workspaceId: workspace._id }),
	]);

	expect(templates.map((template) => template.slug)).toEqual([
		"one-to-one",
		"stand-up",
		"weekly-team-meeting",
	]);
	expect(recipes.map((recipe) => recipe.slug)).toEqual([
		"write-prd",
		"sales-questions",
		"write-weekly-recap",
	]);

	const storedCounts = await t.run(async (ctx) => ({
		templates: (await ctx.db.query("templates").take(10)).length,
		recipes: (await ctx.db.query("recipes").take(10)).length,
	}));

	expect(storedCounts).toEqual({
		templates: 3,
		recipes: 3,
	});
});
