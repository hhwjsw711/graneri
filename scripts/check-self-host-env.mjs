import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const envFileNames = [".env.local", ".env"];

const parseEnvLine = (line) => {
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

const loadEnvFiles = () => {
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

const getValue = (values, ...names) => {
	for (const name of names) {
		const value = values.get(name)?.trim();
		if (value) {
			return value;
		}
	}

	return "";
};

const isUrl = (value) => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
};

const checks = [
	{
		label: "Convex client URL",
		names: ["VITE_CONVEX_URL", "CONVEX_URL"],
		required: true,
		kind: "url",
	},
	{
		label: "Convex site URL",
		names: ["VITE_CONVEX_SITE_URL", "CONVEX_SITE_URL"],
		required: true,
		kind: "url",
	},
	{
		label: "Public site URL",
		names: ["SITE_URL"],
		required: true,
		kind: "url",
	},
	{
		label: "Additional trusted origins",
		names: ["SITE_TRUSTED_ORIGINS"],
		required: false,
		kind: "url-list",
	},
	{
		label: "Better Auth secret",
		names: ["BETTER_AUTH_SECRET"],
		required: true,
	},
	{
		label: "OpenAI API key",
		names: ["OPENAI_API_KEY"],
		required: false,
		warnWhenMissing: true,
	},
	{
		label: "GitHub OAuth app",
		names: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
		required: false,
		warnWhenMissing: true,
	},
	{
		label: "Google OAuth app",
		names: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
		required: false,
		warnWhenMissing: true,
	},
];

const values = loadEnvFiles();
const failures = [];
const warnings = [];

for (const check of checks) {
	const missingNames = check.names.filter((name) => !values.get(name)?.trim());
	const value = getValue(values, ...check.names);

	if (check.required && missingNames.length === check.names.length) {
		failures.push(`${check.label}: set ${check.names.join(" or ")}`);
		continue;
	}

	if (value && check.kind === "url" && !isUrl(value)) {
		failures.push(`${check.label}: ${value} is not a valid HTTP(S) URL`);
		continue;
	}

	if (value && check.kind === "url-list") {
		const invalidUrl = value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean)
			.find((entry) => !isUrl(entry));

		if (invalidUrl) {
			failures.push(`${check.label}: ${invalidUrl} is not a valid HTTP(S) URL`);
			continue;
		}
	}

	if (check.warnWhenMissing && missingNames.length > 0) {
		warnings.push(
			`${check.label}: missing ${missingNames.join(", ")}; related features may be unavailable`,
		);
	}
}

if (failures.length > 0) {
	console.error("Self-host environment check failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exitCode = 1;
} else {
	console.info("Self-host environment check passed.");
}

if (warnings.length > 0) {
	console.warn("Warnings:");
	for (const warning of warnings) {
		console.warn(`- ${warning}`);
	}
}
