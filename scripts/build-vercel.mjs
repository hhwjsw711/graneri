import { cp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const outputDir = path.join(rootDir, "dist");

const getEnv = (name) => process.env[name]?.trim() ?? "";

const hasWebConvexConfig = () =>
	Boolean(
		(getEnv("VITE_CONVEX_URL") ||
			getEnv("CONVEX_URL") ||
			getEnv("GRANERI_HOSTED_CONVEX_URL")) &&
			(getEnv("VITE_CONVEX_SITE_URL") ||
				getEnv("CONVEX_SITE_URL") ||
				getEnv("GRANERI_HOSTED_CONVEX_SITE_URL")),
	);

const getTarget = () => {
	const explicitTarget = getEnv("GRANERI_VERCEL_TARGET");

	if (explicitTarget === "web" || explicitTarget === "marketing") {
		return explicitTarget;
	}

	return hasWebConvexConfig() ? "web" : "marketing";
};

const run = (command, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: rootDir,
			env: process.env,
			stdio: "inherit",
		});

		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(
				new Error(
					`${command} ${args.join(" ")} failed with ${signal ?? `code ${code}`}`,
				),
			);
		});
	});

const target = getTarget();
const sourceDistDir = path.join(rootDir, "apps", target, "dist");

console.log(`[vercel] building ${target}`);

await rm(outputDir, { force: true, recursive: true });
await run("bun", [`--filter=${target}`, "run", "build"]);
await cp(sourceDistDir, outputDir, { recursive: true });

console.log(`[vercel] copied ${path.relative(rootDir, sourceDistDir)} to dist`);
