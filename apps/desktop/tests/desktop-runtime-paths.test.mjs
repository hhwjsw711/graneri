import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	resolveDesktopRuntimeBinPath,
	resolveDesktopRuntimeExecutablePath,
	resolveGeneratedDesktopHelperPath,
} from "../src/desktop-runtime-paths.mjs";

test("resolves runtime bin paths from the desktop runtime directory", () => {
	assert.equal(
		resolveDesktopRuntimeBinPath({
			executableName: "graneri-microphone-helper",
			runtimeDir:
				"/Graneri.app/Contents/Resources/app/.bundle-root/apps/desktop/dist",
		}),
		"/Graneri.app/Contents/Resources/app/.bundle-root/apps/desktop/dist/bin/graneri-microphone-helper",
	);
});

test("resolves generated helper paths for development builds", () => {
	assert.equal(
		resolveGeneratedDesktopHelperPath({
			executableName: "graneri-system-audio-helper",
			runtimeDir: "/repo/apps/desktop/dist",
		}),
		"/repo/apps/desktop/.generated/system-audio/graneri-system-audio-helper",
	);
});

test("prefers explicit executable override paths", async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-runtime-paths-"));
	const overridePath = join(directory, "override-helper");
	await writeFile(overridePath, "");

	assert.equal(
		resolveDesktopRuntimeExecutablePath({
			envPath: ` ${overridePath} `,
			executableName: "graneri-microphone-helper",
			runtimeDir: resolve(directory, "runtime"),
		}),
		overridePath,
	);
});

test("uses packaged runtime executables before generated development helpers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-runtime-paths-"));
	const runtimeDir = join(directory, "runtime");
	const runtimeHelperPath = join(
		runtimeDir,
		"bin",
		"graneri-microphone-activity-helper",
	);
	await mkdir(join(runtimeDir, "bin"), { recursive: true });
	await writeFile(runtimeHelperPath, "");

	assert.equal(
		resolveDesktopRuntimeExecutablePath({
			envPath: null,
			executableName: "graneri-microphone-activity-helper",
			runtimeDir,
		}),
		runtimeHelperPath,
	);
});

test("uses unpacked runtime executables when running from app.asar", async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-runtime-paths-"));
	const runtimeDir = join(
		directory,
		"Graneri.app",
		"Contents",
		"Resources",
		"app.asar",
		".bundle-root",
		"apps",
		"desktop",
		"dist",
	);
	const unpackedHelperPath = join(
		directory,
		"Graneri.app",
		"Contents",
		"Resources",
		"app.asar.unpacked",
		".bundle-root",
		"apps",
		"desktop",
		"dist",
		"bin",
		"graneri-system-audio-helper",
	);
	await mkdir(join(unpackedHelperPath, ".."), { recursive: true });
	await writeFile(unpackedHelperPath, "");

	assert.equal(
		resolveDesktopRuntimeExecutablePath({
			envPath: null,
			executableName: "graneri-system-audio-helper",
			runtimeDir,
		}),
		unpackedHelperPath,
	);
});
