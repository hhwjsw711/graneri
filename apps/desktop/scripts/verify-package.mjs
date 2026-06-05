import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
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
const packagedAppAsarPath = resolve(
	packageRoot,
	"release/mac-arm64/Graneri.app/Contents/Resources/app.asar",
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

const readAsarHeader = (archivePath) => {
	const archive = readFileSync(archivePath);
	const headerSize = archive.readUInt32LE(4);
	const headerBuffer = archive.subarray(8, 8 + headerSize);
	const headerStringLength = headerBuffer.readInt32LE(4);
	const headerString = headerBuffer
		.subarray(8, 8 + headerStringLength)
		.toString("utf8");

	return {
		archive,
		header: JSON.parse(headerString),
		headerSize,
	};
};

const walkAsarEntries = ({ archivePath, directory = "", files }) => {
	const entries = [];

	for (const [name, entry] of Object.entries(files)) {
		const relativePath = directory ? `${directory}/${name}` : name;

		if (entry.files) {
			entries.push(
				...walkAsarEntries({
					archivePath,
					directory: relativePath,
					files: entry.files,
				}),
			);
			continue;
		}

		entries.push({
			archivePath,
			entry,
			relativePath,
		});
	}

	return entries;
};

const readAsarEntryText = ({
	archive,
	archivePath,
	entry,
	headerSize,
	relativePath,
}) => {
	if (entry.unpacked) {
		return readFileSync(join(`${archivePath}.unpacked`, relativePath), "utf8");
	}

	const offset = 8 + headerSize + Number.parseInt(entry.offset, 10);
	return archive.subarray(offset, offset + entry.size).toString("utf8");
};

const loadPackagedResources = async () => {
	if (existsSync(packagedAppResourcePath)) {
		const files = await walkFiles(packagedAppResourcePath);
		return {
			files: files.map((filePath) => ({
				absolutePath: filePath,
				readText: () => readFileSync(filePath, "utf8"),
				relativePath: relative(packagedAppResourcePath, filePath),
			})),
			hasPackagePath: (relativePackagePath) =>
				existsSync(join(packagedAppResourcePath, relativePackagePath)),
		};
	}

	if (!existsSync(packagedAppAsarPath)) {
		throw new Error(
			`Packaged app resources are missing at ${packagedAppResourcePath} or ${packagedAppAsarPath}. Run bun run dist:mac first.`,
		);
	}

	const { archive, header, headerSize } = readAsarHeader(packagedAppAsarPath);
	const entries = walkAsarEntries({
		archivePath: packagedAppAsarPath,
		files: header.files,
	});
	const entryPaths = new Set(entries.map((entry) => entry.relativePath));

	return {
		files: entries.map((asarEntry) => ({
			readText: () =>
				readAsarEntryText({
					archive,
					archivePath: asarEntry.archivePath,
					entry: asarEntry.entry,
					headerSize,
					relativePath: asarEntry.relativePath,
				}),
			relativePath: asarEntry.relativePath,
		})),
		hasPackagePath: (relativePackagePath) => {
			const packagePath = relativePackagePath.replaceAll("\\", "/");
			return [...entryPaths].some(
				(entryPath) =>
					entryPath === packagePath || entryPath.startsWith(`${packagePath}/`),
			);
		},
	};
};

const packageNameFromSpecifier = (specifier) =>
	specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];

const scanRuntimeImports = (packagedResources) => {
	const runtimeFiles = packagedResources.files.filter(
		(file) =>
			file.relativePath.startsWith(".bundle-root/") &&
			/\.(cjs|js|mjs)$/u.test(file.relativePath),
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
		const source = filePath.readText();

		if (/convex\/[^"']+\.ts/u.test(source)) {
			convexServerImports.push(filePath.relativePath);
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
			const packagedDependencyPath = join("node_modules", packageName);

			if (!packagedResources.hasPackagePath(packagedDependencyPath)) {
				const references = missing.get(packageName) ?? [];
				references.push(`${filePath.relativePath} -> ${specifier}`);
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

{
	const packagedResources = await loadPackagedResources();
	const allText = packagedResources.files
		.filter((file) => /\.(html|js|mjs|cjs|json)$/u.test(file.relativePath))
		.map((file) => file.readText())
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
		scanRuntimeImports(packagedResources);

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
