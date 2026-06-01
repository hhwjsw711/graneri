import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { requireRunMutationCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const LOCAL_SITE_URLS = ["http://127.0.0.1:3000", "http://localhost:3000"];
const DESKTOP_CALLBACK_ORIGINS = ["http://127.0.0.1:*", "http://localhost:*"];
const DESKTOP_PROTOCOL_ORIGIN = "graneri:/";

function requireEnv(name: string) {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

function envOrPlaceholder(name: string, fallback: string) {
	return process.env[name] ?? fallback;
}

function getSiteUrl() {
	return process.env.SITE_URL ?? LOCAL_SITE_URLS[0];
}

function getAdditionalTrustedOrigins() {
	return (process.env.SITE_TRUSTED_ORIGINS ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	const siteUrl = getSiteUrl();

	return betterAuth({
		appName: "Graneri",
		baseURL: requireEnv("CONVEX_SITE_URL"),
		trustedOrigins: [
			siteUrl,
			...getAdditionalTrustedOrigins(),
			...LOCAL_SITE_URLS,
			...DESKTOP_CALLBACK_ORIGINS,
			DESKTOP_PROTOCOL_ORIGIN,
		],
		database: authComponent.adapter(ctx),
		account: {
			accountLinking: {
				allowDifferentEmails: true,
				trustedProviders: ["github", "google"],
			},
		},
		user: {
			deleteUser: {
				enabled: true,
				beforeDelete: async () => {
					const identity = await ctx.auth.getUserIdentity();

					if (!identity) {
						return;
					}

					const runCtx = requireRunMutationCtx(ctx);
					await runCtx.runMutation(internal.notes.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.projects.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.chats.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(
						internal.calendarPreferences.removeAllForOwner,
						{
							ownerTokenIdentifier: identity.tokenIdentifier,
						},
					);
					await runCtx.runMutation(
						internal.notificationPreferences.removeAllForOwner,
						{
							ownerTokenIdentifier: identity.tokenIdentifier,
						},
					);
					await runCtx.runMutation(internal.userPreferences.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.inboxItems.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.noteComments.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.appConnections.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.onboarding.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.workspaces.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.templates.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
					await runCtx.runMutation(internal.recipes.removeAllForOwner, {
						ownerTokenIdentifier: identity.tokenIdentifier,
					});
				},
			},
		},
		socialProviders: {
			github: {
				clientId: envOrPlaceholder("GITHUB_CLIENT_ID", "github-client-id"),
				clientSecret: envOrPlaceholder(
					"GITHUB_CLIENT_SECRET",
					"github-client-secret",
				),
			},
			google: {
				clientId: envOrPlaceholder("GOOGLE_CLIENT_ID", "google-client-id"),
				clientSecret: envOrPlaceholder(
					"GOOGLE_CLIENT_SECRET",
					"google-client-secret",
				),
				accessType: "offline",
				prompt: "consent",
			},
		},
		plugins: [convex({ authConfig }), crossDomain({ siteUrl })],
	});
};

export const { getAuthUser } = authComponent.clientApi();

export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return (await authComponent.safeGetAuthUser(ctx)) ?? null;
	},
});
