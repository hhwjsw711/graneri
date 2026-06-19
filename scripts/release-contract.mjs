import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const parseEnvLine = (line) => {
	const trimmed = line.trim();

	if (!trimmed || trimmed.startsWith("#")) {
		return null;
	}

	const separatorIndex = trimmed.indexOf("=");
	if (separatorIndex === -1) {
		return null;
	}

	const key = trimmed.slice(0, separatorIndex).trim();
	let value = trimmed.slice(separatorIndex + 1).trim();

	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}

	return { key, value };
};

export const loadSelectedEnvFile = ({ repoRoot, envFileName }) => {
	const envFilePath = resolve(repoRoot, envFileName);

	if (!existsSync(envFilePath)) {
		return;
	}

	const rawEnv = readFileSync(envFilePath, "utf8");

	for (const line of rawEnv.split(/\r?\n/u)) {
		const entry = parseEnvLine(line);
		if (!entry || process.env[entry.key]) {
			continue;
		}

		process.env[entry.key] = entry.value;
	}
};

export const loadEnvFiles = ({ repoRoot, envFileNames }) => {
	const values = new Map();

	for (const envFileName of envFileNames.toReversed()) {
		const envFilePath = resolve(repoRoot, envFileName);
		if (!existsSync(envFilePath)) {
			continue;
		}

		const rawEnv = readFileSync(envFilePath, "utf8");
		for (const line of rawEnv.split(/\r?\n/u)) {
			const entry = parseEnvLine(line);
			if (!entry) {
				continue;
			}

			values.set(entry.key, entry.value);
		}
	}

	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") {
			values.set(key, value);
		}
	}

	return values;
};

export const getValue = (values, ...names) => {
	for (const name of names) {
		const value = values.get(name)?.trim();
		if (value) {
			return value;
		}
	}

	return "";
};

export const isHttpUrl = (value) => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
};

export const parseDeploymentName = (url) => {
	const value = typeof url === "string" ? url.trim() : "";

	if (!value) {
		return "";
	}

	try {
		const parsed = new URL(value);
		return parsed.hostname.split(".")[0] ?? "";
	} catch {
		return "";
	}
};

const requiredHostedEnv = (name, env) => {
	const value =
		env[`GRANERI_HOSTED_${name}`]?.trim() ?? env[name]?.trim() ?? "";

	if (!value) {
		throw new Error(
			`Missing required production desktop build config: ${name}. Set ${name} in .env or GRANERI_HOSTED_${name} in the build environment.`,
		);
	}

	return value;
};

export const buildHostedRuntimeConfig = (env = process.env) => ({
	convexUrl:
		env.GRANERI_HOSTED_CONVEX_URL?.trim() ?? env.CONVEX_URL?.trim() ?? "",
	convexSiteUrl:
		env.GRANERI_HOSTED_CONVEX_SITE_URL?.trim() ??
		env.CONVEX_SITE_URL?.trim() ??
		"",
	siteUrl: env.GRANERI_HOSTED_SITE_URL?.trim() ?? env.SITE_URL?.trim() ?? "",
});

export const validateProductionRuntimeConfig = (config, env = process.env) => {
	if (env.GRANERI_ENV_MODE?.trim() !== "production") {
		return;
	}

	requiredHostedEnv("CONVEX_URL", env);
	requiredHostedEnv("CONVEX_SITE_URL", env);
	requiredHostedEnv("SITE_URL", env);

	if (!config.convexUrl || !config.convexSiteUrl || !config.siteUrl) {
		throw new Error("Production desktop runtime config is incomplete.");
	}
};

export const getExpectedConvexDeployment = (env = process.env) =>
	env.GRANERI_EXPECTED_CONVEX_DEPLOYMENT?.trim() ||
	parseDeploymentName(env.GRANERI_HOSTED_CONVEX_URL) ||
	parseDeploymentName(env.VITE_CONVEX_URL) ||
	parseDeploymentName(env.CONVEX_URL);

export const getForbiddenConvexDeployments = ({
	env = process.env,
	expectedDeployment,
	knownDevDeployments,
}) =>
	[
		...knownDevDeployments,
		...(env.GRANERI_FORBIDDEN_CONVEX_DEPLOYMENTS?.trim() ?? "")
			.split(",")
			.map((deployment) => deployment.trim())
			.filter(Boolean),
	].filter((deployment) => deployment !== expectedDeployment);
