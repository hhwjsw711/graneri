import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = resolve(packageRoot, "tests");
const nativeAudioTest = "native-audio-capture.test.mjs";

const testFiles = (await readdir(testsDir))
	.filter(
		(fileName) =>
			(fileName.endsWith(".test.cjs") || fileName.endsWith(".test.mjs")) &&
			fileName !== nativeAudioTest,
	)
	.sort()
	.map((fileName) => resolve(testsDir, fileName));

if (testFiles.length === 0) {
	throw new Error("No desktop tests were found.");
}

const child = spawn(process.execPath, ["--test", ...testFiles], {
	cwd: packageRoot,
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});
