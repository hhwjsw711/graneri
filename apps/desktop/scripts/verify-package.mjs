import { spawn } from "node:child_process";
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
import { desktopPackageContract } from "./desktop-package-contract.mjs";
import { nativeRuntimeToolNames } from "./native-runtime-tools.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(packageRoot, "../..");
const packagedAppResourcePath = resolve(
	packageRoot,
	desktopPackageContract.packagedResourcesPath,
);
const packagedAppAsarPath = resolve(
	packageRoot,
	desktopPackageContract.packagedResourcesAsarPath,
);
const stagedPackageAppPath = resolve(
	packageRoot,
	desktopPackageContract.appDirectory,
);
const convexDeploymentUrlPattern =
	/\bhttps:\/\/([a-z0-9-]+)\.convex\.(?:cloud|site)\b/giu;
const convexConfigurationContextPattern =
	/(?:VITE_)?CONVEX(?:_SITE)?_URL|GRANERI_HOSTED_CONVEX|convex(?:Site)?Url|hostedRuntimeConfig|preconnect/iu;

loadSelectedEnvFile({
	envFileName:
		process.env.GRANERI_ENV_MODE?.trim() === "local" ? ".env.local" : ".env",
	repoRoot,
});

const expectedDeployment = getExpectedConvexDeployment();
const expectedSiteUrl =
	process.env.GRANERI_HOSTED_SITE_URL?.trim() ||
	process.env.SITE_URL?.trim() ||
	"";
export const forbiddenLifecycleFallbacks = [
	{
		label: "concurrent assistant-run request flag",
		pattern: ["allow", "Concurrent", "Run"].join(""),
	},
	{
		label: "legacy concurrent assistant-run start policy",
		pattern: ["allow", "concurrent"].join("_"),
	},
	{
		label: "legacy return-existing assistant-run start policy",
		pattern: ["return", "existing"].join("_"),
	},
	{
		label: "legacy queued assistant-run transition mutation",
		pattern: ["mark", "Assistant", "Run", "Running"].join(""),
	},
	{
		label: "legacy claimed queue requeue mutation",
		pattern: ["requeue", "Claimed"].join(""),
	},
	{
		label: "legacy queued assistant-run camel-case state",
		pattern: ["queued", "Assistant", "Run"].join(""),
	},
	{
		label: "legacy queued assistant-run snake-case state",
		pattern: ["queued", "assistant", "run"].join("_"),
	},
	{
		label: "legacy discarded queued-message status",
		pattern: ["status", ":", '"discarded"'].join(""),
	},
];

if (!expectedDeployment) {
	throw new Error(
		"Expected Convex deployment is not configured. Set GRANERI_EXPECTED_CONVEX_DEPLOYMENT, GRANERI_HOSTED_CONVEX_URL, VITE_CONVEX_URL, or CONVEX_URL before verifying a package.",
	);
}

if (!expectedSiteUrl) {
	throw new Error(
		"Expected hosted site URL is not configured. Set GRANERI_HOSTED_SITE_URL or SITE_URL before verifying a package.",
	);
}

if (new URL(expectedSiteUrl).hostname.endsWith(".convex.site")) {
	throw new Error(
		"Expected hosted site URL must be the hosted web app origin, not a Convex site URL.",
	);
}

const forbiddenDeployments = getForbiddenConvexDeployments({
	expectedDeployment,
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

const getConfigurationConvexDeployments = (source) => {
	const deployments = new Set();

	for (const match of source.matchAll(convexDeploymentUrlPattern)) {
		const contextStart = Math.max(0, match.index - 120);
		const contextEnd = Math.min(
			source.length,
			match.index + match[0].length + 120,
		);
		const context = source.slice(contextStart, contextEnd);

		if (convexConfigurationContextPattern.test(context)) {
			deployments.add(match[1]);
		}
	}

	return deployments;
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
	if (existsSync(stagedPackageAppPath)) {
		const files = await walkFiles(stagedPackageAppPath);
		return {
			files: files.map((filePath) => ({
				absolutePath: filePath,
				readText: () => readFileSync(filePath, "utf8"),
				relativePath: relative(stagedPackageAppPath, filePath),
			})),
			hasPackagePath: (relativePackagePath) =>
				existsSync(join(stagedPackageAppPath, relativePackagePath)),
		};
	}

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

const resolvePackagedNativeToolPath = (toolName) => {
	const stagedToolPath = join(
		packageRoot,
		desktopPackageContract.appDirectory,
		desktopPackageContract.runtimeDirectory,
		"bin",
		toolName,
	);
	if (existsSync(stagedToolPath)) {
		return stagedToolPath;
	}

	const unpackedToolPath = join(
		`${packagedAppAsarPath}.unpacked`,
		desktopPackageContract.runtimeDirectory,
		"bin",
		toolName,
	);
	if (existsSync(unpackedToolPath)) {
		return unpackedToolPath;
	}

	const directoryToolPath = join(
		packagedAppResourcePath,
		desktopPackageContract.runtimeDirectory,
		"bin",
		toolName,
	);
	if (existsSync(directoryToolPath)) {
		return directoryToolPath;
	}

	return null;
};

const runNativeRuntimeTool = (toolPath, args) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(toolPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", rejectPromise);
		child.on("exit", (code) => {
			if (code !== 0) {
				rejectPromise(
					new Error(
						`${toolPath} ${args.join(" ")} exited with code ${code ?? -1}.\n${stderr}`,
					),
				);
				return;
			}

			resolvePromise(stdout);
		});
	});

const verifyNativeRuntimeTools = async () => {
	for (const toolName of nativeRuntimeToolNames) {
		if (!resolvePackagedNativeToolPath(toolName)) {
			throw new Error(`Packaged native runtime tool is missing: ${toolName}`);
		}
	}

	const combinedAudioHelperPath = resolvePackagedNativeToolPath(
		"graneri-combined-audio-helper",
	);
	const selfTestOutput = await runNativeRuntimeTool(combinedAudioHelperPath, [
		"--self-test",
	]);
	const selfTestResult = JSON.parse(selfTestOutput.trim());

	if (
		selfTestResult?.ok !== true ||
		typeof selfTestResult.activeRenderPassthroughErrorRms !== "number" ||
		selfTestResult.activeRenderPassthroughErrorRms > 0.16 ||
		typeof selfTestResult.echoReductionRatio !== "number" ||
		selfTestResult.echoReductionRatio < 0.35 ||
		typeof selfTestResult.noRenderPassthroughErrorRms !== "number" ||
		selfTestResult.noRenderPassthroughErrorRms > 0.000001 ||
		typeof selfTestResult.suppressedChunks !== "number" ||
		selfTestResult.suppressedChunks <= 0 ||
		typeof selfTestResult.systemOutputErrorRms !== "number" ||
		selfTestResult.systemOutputErrorRms > 0.000001
	) {
		throw new Error(
			`Combined audio helper self-test failed: ${selfTestOutput.trim()}`,
		);
	}

	return selfTestResult;
};

const packageNameFromSpecifier = (specifier) =>
	specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];

const scanRuntimeImports = (packagedResources) => {
	const runtimeFiles = packagedResources.files.filter(
		(file) =>
			file.relativePath.startsWith(
				desktopPackageContract.runtimeImportDirectory,
			) && /\.(cjs|js|mjs)$/u.test(file.relativePath),
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
	const nativeAudioSelfTestResult = await verifyNativeRuntimeTools();
	const allText = packagedResources.files
		.filter((file) => /\.(html|js|mjs|cjs|json)$/u.test(file.relativePath))
		.map((file) => file.readText())
		.join("\n");
	const packagedConvexDeployments = getConfigurationConvexDeployments(allText);

	for (const deployment of forbiddenDeployments) {
		if (allText.includes(deployment)) {
			throw new Error(
				`Packaged app contains forbidden Convex deployment "${deployment}".`,
			);
		}
	}

	for (const deployment of packagedConvexDeployments) {
		if (deployment !== expectedDeployment) {
			throw new Error(
				`Packaged app contains unexpected Convex deployment "${deployment}" while expecting "${expectedDeployment}".`,
			);
		}
	}

	if (expectedDeployment && !allText.includes(expectedDeployment)) {
		throw new Error(
			`Packaged app does not contain expected Convex deployment "${expectedDeployment}".`,
		);
	}

	if (!allText.includes(expectedSiteUrl)) {
		throw new Error(
			`Packaged app does not contain expected hosted site URL "${expectedSiteUrl}".`,
		);
	}

	for (const fallback of forbiddenLifecycleFallbacks) {
		if (allText.includes(fallback.pattern)) {
			throw new Error(
				`Packaged app contains forbidden lifecycle fallback "${fallback.pattern}" (${fallback.label}).`,
			);
		}
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
			`Expected hosted site URL: ${expectedSiteUrl}`,
			`Combined audio echo reduction self-test: ${nativeAudioSelfTestResult.echoReductionRatio}`,
		].join("\n"),
	);
}
