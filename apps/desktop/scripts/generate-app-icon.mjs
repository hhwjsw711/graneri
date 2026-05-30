import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceIconPath = resolve(packageRoot, "src/assets/GraneriDock.png");
const buildDir = resolve(packageRoot, "build");
const iconsetDir = resolve(buildDir, "icon.iconset");
const outputIconPath = resolve(buildDir, "icon.icns");

const run = (cmd, args) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(cmd, args, {
			cwd: packageRoot,
			stdio: "inherit",
		});

		child.on("error", rejectPromise);
		child.on("exit", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}

			rejectPromise(
				new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? -1}.`),
			);
		});
	});

await rm(iconsetDir, { recursive: true, force: true });
await mkdir(iconsetDir, { recursive: true });

for (const size of [16, 32, 128, 256, 512]) {
	await run("sips", [
		"-z",
		String(size),
		String(size),
		sourceIconPath,
		"--out",
		resolve(iconsetDir, `icon_${size}x${size}.png`),
	]);

	await run("sips", [
		"-z",
		String(size * 2),
		String(size * 2),
		sourceIconPath,
		"--out",
		resolve(iconsetDir, `icon_${size}x${size}@2x.png`),
	]);
}

await run("iconutil", ["-c", "icns", iconsetDir, "-o", outputIconPath]);
