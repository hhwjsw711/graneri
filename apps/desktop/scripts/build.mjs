import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "./build-system-audio-helper.mjs";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(packageRoot, "src");
const distDir = resolve(packageRoot, "dist");
const webDistDir = resolve(packageRoot, "../web/dist");
const bundleRootDir = resolve(packageRoot, ".bundle-root");
const bundleDesktopDistDir = resolve(bundleRootDir, "apps", "desktop", "dist");
const bundleWebDistDir = resolve(bundleRootDir, "apps", "web", "dist");
const bundleConvexGeneratedDir = resolve(bundleRootDir, "convex", "_generated");
const packageAiSrcDir = resolve(packageRoot, "../../packages/ai/src");
const bundleAiSrcDir = resolve(bundleRootDir, "packages", "ai", "src");
const desktopAssetsDir = resolve(sourceDir, "assets");

const buildHostedRuntimeConfig = () => ({
	convexUrl: process.env.GRANERI_HOSTED_CONVEX_URL?.trim() ?? "",
	convexSiteUrl: process.env.GRANERI_HOSTED_CONVEX_SITE_URL?.trim() ?? "",
	siteUrl: process.env.GRANERI_HOSTED_SITE_URL?.trim() ?? "",
});

const writeHostedRuntimeConfig = async () => {
	const config = buildHostedRuntimeConfig();

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

if (!existsSync(resolve(webDistDir, "index.html"))) {
	throw new Error(
		"Web build output is missing. Run `bun run build --filter=web` before building the desktop shell.",
	);
}

await rm(distDir, { recursive: true, force: true });
await rm(bundleRootDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

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

if (process.platform === "darwin") {
	await mkdir(resolve(distDir, "bin"), { recursive: true });
	for (const helperName of [
		"graneri-system-audio-helper",
		"graneri-microphone-helper",
		"graneri-microphone-activity-helper",
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
}

await mkdir(bundleDesktopDistDir, { recursive: true });
await mkdir(bundleWebDistDir, { recursive: true });
await mkdir(bundleConvexGeneratedDir, { recursive: true });
await mkdir(bundleAiSrcDir, { recursive: true });

await cp(distDir, bundleDesktopDistDir, { recursive: true });
await cp(webDistDir, bundleWebDistDir, { recursive: true });
await cp(
	resolve(packageRoot, "../../convex/_generated/api.js"),
	resolve(bundleConvexGeneratedDir, "api.js"),
);
await cp(packageAiSrcDir, bundleAiSrcDir, { recursive: true });
