import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	buildHostedRuntimeConfig,
	loadSelectedEnvFile,
	validateProductionRuntimeConfig,
} from "../../../scripts/release-contract.mjs";
import "./build-system-audio-helper.mjs";
import {
	createDesktopPackageManifest,
	desktopPackageContract,
} from "./desktop-package-contract.mjs";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackage = require(resolve(packageRoot, "package.json"));
const repoRoot = resolve(packageRoot, "../..");
const sourceDir = resolve(packageRoot, "src");
const distDir = resolve(packageRoot, "dist");
const webDistDir = resolve(packageRoot, "../web/dist");
const packageAppDir = resolve(packageRoot, desktopPackageContract.appDirectory);
const packageElectronMainDir = resolve(
	packageAppDir,
	desktopPackageContract.runtimeDirectory,
);
const packageRendererDistDir = resolve(
	packageAppDir,
	desktopPackageContract.rendererDirectory,
);
const desktopAssetsDir = resolve(sourceDir, "assets");
const bundledMainDir = resolve(distDir, ".main-bundle");

const writeHostedRuntimeConfig = async () => {
	const config = buildHostedRuntimeConfig();
	validateProductionRuntimeConfig(config);

	await cp(
		resolve(sourceDir, "hosted-runtime-config.mjs"),
		resolve(distDir, "hosted-runtime-config.mjs"),
	);

	if (!config.convexUrl && !config.convexSiteUrl && !config.siteUrl) {
		return;
	}

	await writeFile(
		resolve(distDir, "hosted-runtime-config.mjs"),
		`export const hostedRuntimeConfig = ${JSON.stringify(config, null, "\t")};\n`,
	);
};

const resolveOptionalPackageBinary = (packageName) => {
	try {
		return require(packageName).path;
	} catch {
		return null;
	}
};

const copyOptionalExecutable = async ({ from, to }) => {
	if (!from || !existsSync(from)) {
		return false;
	}

	await cp(from, to);
	return true;
};

const copyRuntimeSources = async () => {
	for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}

		if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".cjs")) {
			continue;
		}

		await cp(resolve(sourceDir, entry.name), resolve(distDir, entry.name));
	}

	await writeHostedRuntimeConfig();
	await cp(desktopAssetsDir, resolve(distDir, "assets"), { recursive: true });
};

const bundleDesktopMain = async () => {
	await rm(bundledMainDir, { recursive: true, force: true });
	await mkdir(bundledMainDir, { recursive: true });
	await execFileAsync(
		"bun",
		[
			"build",
			resolve(distDir, "main.mjs"),
			"--target=node",
			"--format=esm",
			`--outdir=${bundledMainDir}`,
			"--external",
			"electron",
			"--sourcemap=none",
		],
		{
			cwd: repoRoot,
			stdio: "inherit",
		},
	);

	await rm(resolve(distDir, "main.mjs"), { force: true });
	await rename(
		resolve(bundledMainDir, "main.js"),
		resolve(distDir, "index.js"),
	);
	await cp(bundledMainDir, distDir, { recursive: true, force: true });
	await rm(bundledMainDir, { recursive: true, force: true });

	for (const entry of await readdir(distDir, { withFileTypes: true })) {
		if (
			entry.isFile() &&
			entry.name.endsWith(".mjs") &&
			entry.name !== "hosted-runtime-config.mjs"
		) {
			await rm(resolve(distDir, entry.name), { force: true });
		}
	}
};

const copyNativeRuntimeTools = async () => {
	if (process.platform !== "darwin") {
		return;
	}

	await mkdir(resolve(distDir, "bin"), { recursive: true });
	for (const helperName of [
		"graneri-system-audio-helper",
		"graneri-microphone-helper",
		"graneri-microphone-activity-helper",
		"graneri-meeting-window-helper",
	]) {
		await cp(
			resolve(packageRoot, ".generated", "system-audio", helperName),
			resolve(distDir, "bin", helperName),
		);
	}

	await copyOptionalExecutable({
		from: resolveOptionalPackageBinary("@ffmpeg-installer/ffmpeg"),
		to: resolve(distDir, "bin", "ffmpeg"),
	});
	await copyOptionalExecutable({
		from: resolveOptionalPackageBinary("@ffprobe-installer/ffprobe"),
		to: resolve(distDir, "bin", "ffprobe"),
	});
};

const stagePackageApp = async () => {
	await mkdir(packageAppDir, { recursive: true });
	await mkdir(resolve(packageAppDir, "dist-electron"), { recursive: true });
	await cp(distDir, packageElectronMainDir, { recursive: true });
	await cp(webDistDir, packageRendererDistDir, { recursive: true });
	await writeFile(
		resolve(packageAppDir, "package.json"),
		`${JSON.stringify(createDesktopPackageManifest(desktopPackage), null, "\t")}\n`,
	);
};

if (!existsSync(resolve(webDistDir, "index.html"))) {
	throw new Error(
		"Web build output is missing. Run `bun run build --filter=web` before building the desktop shell.",
	);
}

loadSelectedEnvFile({
	envFileName:
		process.env.GRANERI_ENV_MODE?.trim() === "production"
			? ".env"
			: ".env.local",
	repoRoot,
});

await rm(distDir, { recursive: true, force: true });
await rm(packageAppDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await copyRuntimeSources();
await bundleDesktopMain();
await copyNativeRuntimeTools();
await stagePackageApp();
