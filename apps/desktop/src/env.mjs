import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const getEnvFileName = () =>
	process.env.GRANERI_ENV_MODE?.trim() === "production" ? ".env" : ".env.local";

export const getEnvPaths = (options = {}) => {
	const envFileName = getEnvFileName();
	const includeWorkingDirectory = options.includeWorkingDirectory !== false;
	const envPaths = [
		resolve(fileURLToPath(new URL("../../..", import.meta.url)), envFileName),
	];

	if (includeWorkingDirectory) {
		envPaths.unshift(
			resolve(process.cwd(), "../..", envFileName),
			resolve(process.cwd(), envFileName),
		);
	}

	return envPaths.filter(Boolean);
};

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

export const loadRootEnv = (options = {}) => {
	const loadedKeys = new Set();
	const envPaths = getEnvPaths(options);

	for (const envPath of new Set(envPaths)) {
		if (!existsSync(envPath)) {
			continue;
		}

		const rawEnv = readFileSync(envPath, "utf8");

		for (const line of rawEnv.split(/\r?\n/)) {
			const entry = parseEnvLine(line);
			if (!entry) {
				continue;
			}

			// Keep explicit shell env vars authoritative, but let `.env.local`
			// override values loaded earlier from `.env`.
			if (process.env[entry.key] && !loadedKeys.has(entry.key)) {
				continue;
			}

			process.env[entry.key] = entry.value;
			loadedKeys.add(entry.key);
		}
	}
};
