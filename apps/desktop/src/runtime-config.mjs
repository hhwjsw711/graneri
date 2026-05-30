import { app } from "electron";

const defaultHostedConvexUrl = "https://precious-crane-700.convex.cloud";
const defaultHostedConvexSiteUrl = "https://precious-crane-700.convex.site";
const defaultHostedSiteUrl = defaultHostedConvexSiteUrl;

const trimConfigValue = (value) =>
	typeof value === "string" ? value.trim() : "";

const shouldUseHostedDefaults = () =>
	app.isPackaged === true && process.env.GRANERI_ENV_MODE?.trim() !== "local";

const deriveConvexSiteUrl = (convexUrl) => {
	if (!convexUrl) {
		return "";
	}

	try {
		const url = new URL(convexUrl);

		if (url.hostname.endsWith(".convex.cloud")) {
			url.hostname = url.hostname.replace(/\.convex\.cloud$/u, ".convex.site");
			url.pathname = "/";
			url.search = "";
			url.hash = "";
			return url.toString().replace(/\/$/u, "");
		}
	} catch {}

	return "";
};

const createRuntimeConfig = (value) => {
	const convexUrl =
		trimConfigValue(value?.convexUrl) ||
		(shouldUseHostedDefaults() ? defaultHostedConvexUrl : "");
	const convexSiteUrlInput = trimConfigValue(value?.convexSiteUrl);
	const convexSiteUrl =
		convexSiteUrlInput ||
		deriveConvexSiteUrl(convexUrl) ||
		(shouldUseHostedDefaults() ? defaultHostedConvexSiteUrl : "");
	const siteUrl =
		trimConfigValue(value?.siteUrl) ||
		(shouldUseHostedDefaults() ? defaultHostedSiteUrl : "");
	const openAIApiKey = trimConfigValue(value?.openAIApiKey);

	if (!convexUrl) {
		throw new Error("CONVEX_URL is not configured.");
	}

	if (!convexSiteUrl) {
		throw new Error("CONVEX_SITE_URL is not configured.");
	}

	return {
		convexUrl,
		convexSiteUrl,
		siteUrl,
		openAIApiKey,
	};
};

const toPublicRuntimeConfig = (value) => ({
	convexUrl: value.convexUrl,
	convexSiteUrl: value.convexSiteUrl,
	...(value.localApiOrigin ? { localApiOrigin: value.localApiOrigin } : {}),
});

const resolveRuntimeConfig = async () => {
	const envConvexUrl =
		trimConfigValue(process.env.CONVEX_URL) ||
		trimConfigValue(process.env.VITE_CONVEX_URL);
	const envConvexSiteUrl =
		trimConfigValue(process.env.CONVEX_SITE_URL) ||
		trimConfigValue(process.env.VITE_CONVEX_SITE_URL);
	const envOpenAIApiKey = trimConfigValue(process.env.OPENAI_API_KEY);
	const envSiteUrl = trimConfigValue(process.env.SITE_URL);

	return createRuntimeConfig({
		convexUrl: envConvexUrl,
		convexSiteUrl: envConvexSiteUrl,
		siteUrl: envSiteUrl,
		openAIApiKey: envOpenAIApiKey,
	});
};

const applyRuntimeConfig = (value) => {
	if (value.convexUrl) {
		process.env.CONVEX_URL = value.convexUrl;
		process.env.VITE_CONVEX_URL = value.convexUrl;
	}

	if (value.convexSiteUrl) {
		process.env.CONVEX_SITE_URL = value.convexSiteUrl;
		process.env.VITE_CONVEX_SITE_URL = value.convexSiteUrl;
	}

	if (value.openAIApiKey) {
		process.env.OPENAI_API_KEY = value.openAIApiKey;
	}

	if (value.siteUrl) {
		process.env.SITE_URL = value.siteUrl;
	}
};

export const hydrateRuntimeConfig = async () => {
	const runtimeConfig = await resolveRuntimeConfig();
	applyRuntimeConfig(runtimeConfig);
	return runtimeConfig;
};

export const getRuntimeConfig = async (extra = {}) =>
	toPublicRuntimeConfig({
		...(await resolveRuntimeConfig()),
		...extra,
	});
