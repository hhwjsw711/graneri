import { app } from "electron";
import { hostedRuntimeConfig } from "./hosted-runtime-config.mjs";

const trimConfigValue = (value) =>
	typeof value === "string" ? value.trim() : "";

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

const getHostedDefaults = () => {
	const convexUrl =
		trimConfigValue(process.env.GRANERI_HOSTED_CONVEX_URL) ||
		trimConfigValue(hostedRuntimeConfig.convexUrl);
	const convexSiteUrl =
		trimConfigValue(process.env.GRANERI_HOSTED_CONVEX_SITE_URL) ||
		trimConfigValue(hostedRuntimeConfig.convexSiteUrl) ||
		deriveConvexSiteUrl(convexUrl);
	const siteUrl =
		trimConfigValue(process.env.GRANERI_HOSTED_SITE_URL) ||
		trimConfigValue(hostedRuntimeConfig.siteUrl) ||
		convexSiteUrl;

	return {
		convexUrl,
		convexSiteUrl,
		siteUrl,
	};
};

const shouldUseHostedDefaults = () =>
	app.isPackaged === true &&
	process.env.GRANERI_ENV_MODE?.trim() !== "local" &&
	Boolean(getHostedDefaults().convexUrl);

const createRuntimeConfig = (value) => {
	const hostedDefaults = shouldUseHostedDefaults() ? getHostedDefaults() : {};
	const convexUrl =
		trimConfigValue(value?.convexUrl) || hostedDefaults.convexUrl || "";
	const convexSiteUrlInput = trimConfigValue(value?.convexSiteUrl);
	const convexSiteUrl =
		convexSiteUrlInput ||
		deriveConvexSiteUrl(convexUrl) ||
		hostedDefaults.convexSiteUrl ||
		"";
	const siteUrl =
		trimConfigValue(value?.siteUrl) || hostedDefaults.siteUrl || "";
	const openAIApiKey = trimConfigValue(value?.openAIApiKey);

	if (!convexUrl) {
		throw new Error(
			"CONVEX_URL is not configured. Set CONVEX_URL or VITE_CONVEX_URL. Official packaged builds may set GRANERI_HOSTED_CONVEX_URL.",
		);
	}

	if (!convexSiteUrl) {
		throw new Error(
			"CONVEX_SITE_URL is not configured. Set CONVEX_SITE_URL or VITE_CONVEX_SITE_URL.",
		);
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
