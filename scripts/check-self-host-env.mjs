import { resolve } from "node:path";
import { getValue, isHttpUrl, loadEnvFiles } from "./release-contract.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const envFileNames = [".env.local", ".env"];

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

const values = loadEnvFiles({ envFileNames, repoRoot });
const failures = [];
const warnings = [];

for (const check of checks) {
	const missingNames = check.names.filter((name) => !values.get(name)?.trim());
	const value = getValue(values, ...check.names);

	if (check.required && missingNames.length === check.names.length) {
		failures.push(`${check.label}: set ${check.names.join(" or ")}`);
		continue;
	}

	if (value && check.kind === "url" && !isHttpUrl(value)) {
		failures.push(`${check.label}: ${value} is not a valid HTTP(S) URL`);
		continue;
	}

	if (value && check.kind === "url-list") {
		const invalidUrl = value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean)
			.find((entry) => !isHttpUrl(entry));

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
