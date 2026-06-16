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

const createClient = () => {
	const t = convexTest(schema, modules);

	return t.withIdentity(ownerIdentity);
};

test("user preferences default reasoning effort to medium", async () => {
	const asOwner = createClient();

	const preferences = await asOwner.query(api.userPreferences.get, {});

	expect(preferences.reasoningEffort).toBe("medium");
});

test("user preferences persist reasoning effort independently", async () => {
	const asOwner = createClient();

	const updated = await asOwner.mutation(api.userPreferences.update, {
		reasoningEffort: "high",
	});

	expect(updated).toMatchObject({
		reasoningEffort: "high",
		transcriptionLanguage: null,
		jobTitle: null,
		companyName: null,
	});

	const preferences = await asOwner.query(api.userPreferences.get, {});

	expect(preferences.reasoningEffort).toBe("high");
});
