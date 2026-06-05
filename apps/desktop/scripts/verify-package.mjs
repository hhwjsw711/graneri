import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	getExpectedConvexDeployment,
	getForbiddenConvexDeployments,
	loadSelectedEnvFile,
} from "../../../scripts/release-contract.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(packageRoot, "../..");
const packagedAppResourcePath = resolve(
	packageRoot,
	"release/mac-arm64/Graneri.app/Contents/Resources/app",
);
const knownDevDeployments = ["clever-chinchilla-887"];

loadSelectedEnvFile({
	envFileName:
		process.env.GRANERI_ENV_MODE?.trim() === "local" ? ".env.local" : ".env",
	repoRoot,
});

const expectedDeployment = getExpectedConvexDeployment();

if (!expectedDeployment) {
	throw new Error(
		"Expected Convex deployment is not configured. Set GRANERI_EXPECTED_CONVEX_DEPLOYMENT, GRANERI_HOSTED_CONVEX_URL, VITE_CONVEX_URL, or CONVEX_URL before verifying a package.",
	);
}

const forbiddenDeployments = getForbiddenConvexDeployments({
	expectedDeployment,
	knownDevDeployments,
});

const walkFiles = async (directory) => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const filePath = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await walkFiles(filePath)));
			continue;
		}

		files.push(filePath);
	}

	return files;
};

const packageNameFromSpecifier = (specifier) =>
	specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];

const scanRuntimeImports = async (extractDir) => {
	const runtimeRoot = join(extractDir, ".bundle-root");
	const runtimeFiles = (await walkFiles(runtimeRoot)).filter((filePath) =>
		/\.(cjs|js|mjs)$/u.test(filePath),
	);
	const builtins = new Set([
		...builtinModules,
		...builtinModules.map((moduleName) => `node:${moduleName}`),
		"electron",
	]);
	const importPattern =
		/(?:import\s+(?:[^"'()]+?\s+from\s+)?|export\s+[^"']*?from\s+|import\s*\()(["'])([^"']+)\1/gu;
	const missing = new Map();
	const convexServerImports = [];

	for (const filePath of runtimeFiles) {
		const source = await readFile(filePath, "utf8");

		if (/convex\/[^"']+\.ts/u.test(source)) {
			convexServerImports.push(relative(extractDir, filePath));
		}

		for (const match of source.matchAll(importPattern)) {
			const specifier = match[2];

			if (
				specifier.startsWith(".") ||
				specifier.startsWith("/") ||
				builtins.has(specifier)
			) {
				continue;
			}

			const packageName = packageNameFromSpecifier(specifier);
			const packagedDependencyPath = join(
				extractDir,
				"node_modules",
				packageName,
			);

			if (!existsSync(packagedDependencyPath)) {
				const references = missing.get(packageName) ?? [];
				references.push(`${relative(extractDir, filePath)} -> ${specifier}`);
				missing.set(packageName, references);
			}
		}
	}

	return {
		convexServerImports,
		missing,
		runtimeFileCount: runtimeFiles.length,
	};
};

if (!existsSync(packagedAppResourcePath)) {
	throw new Error(
		`Packaged app resources are missing at ${packagedAppResourcePath}. Run bun run dist:mac first.`,
	);
}

{
	const allFiles = await walkFiles(packagedAppResourcePath);
	const allText = allFiles
		.filter((filePath) => /\.(html|js|mjs|cjs|json)$/u.test(filePath))
		.map((filePath) => readFileSync(filePath, "utf8"))
		.join("\n");

	for (const deployment of forbiddenDeployments) {
		if (allText.includes(deployment)) {
			throw new Error(
				`Packaged app contains forbidden Convex deployment "${deployment}".`,
			);
		}
	}

	if (expectedDeployment && !allText.includes(expectedDeployment)) {
		throw new Error(
			`Packaged app does not contain expected Convex deployment "${expectedDeployment}".`,
		);
	}

	const { convexServerImports, missing, runtimeFileCount } =
		await scanRuntimeImports(packagedAppResourcePath);

	if (convexServerImports.length > 0) {
		throw new Error(
			`Packaged runtime imports Convex server TypeScript files:\n${convexServerImports
				.slice(0, 12)
				.map((filePath) => `  ${filePath}`)
				.join("\n")}`,
		);
	}

	if (missing.size > 0) {
		const details = [...missing.entries()]
			.map(([packageName, references]) =>
				[
					`Missing packaged dependency: ${packageName}`,
					...references.slice(0, 8).map((reference) => `  ${reference}`),
				].join("\n"),
			)
			.join("\n\n");

		throw new Error(details);
	}

	console.log(
		[
			"Desktop package verification passed.",
			`Runtime files checked: ${runtimeFileCount}`,
			expectedDeployment
				? `Expected Convex deployment: ${expectedDeployment}`
				: "Expected Convex deployment: not configured",
		].join("\n"),
	);
}
