import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { forwardElectronOutput } from "./forward-electron-output.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const webPackageRoot = resolve(repoRoot, "apps", "web");
const releaseDir = resolve(packageRoot, "release");
const rendererUrl = process.env.GRANERI_RENDERER_URL ?? "http://127.0.0.1:3000";

const sleep = (ms) =>
	new Promise((resolvePromise) => {
		setTimeout(resolvePromise, ms);
	});

const waitForUrl = async (targetUrl) => {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		try {
			const response = await fetch(targetUrl);
			if (response.ok) {
				return;
			}
		} catch {}

		await sleep(500);
	}

	throw new Error(`Renderer did not become available at ${targetUrl}.`);
};

const isUrlAvailable = async (targetUrl) => {
	try {
		const response = await fetch(targetUrl);
		return response.ok;
	} catch {
		return false;
	}
};

const runCommand = (command, args, options = {}) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			cwd: options.cwd ?? packageRoot,
			stdio: "inherit",
			env: {
				...process.env,
				...options.env,
			},
		});

		child.on("error", rejectPromise);
		child.on("exit", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}

			rejectPromise(
				new Error(
					`${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
				),
			);
		});
	});

const resolveBundledAppExecutable = async () => {
	const releaseEntries = await readdir(releaseDir, { withFileTypes: true });

	for (const entry of releaseEntries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const executablePath = resolve(
			releaseDir,
			entry.name,
			"Graneri.app",
			"Contents",
			"MacOS",
			"Graneri",
		);

		if (existsSync(executablePath)) {
			return executablePath;
		}
	}

	throw new Error("Unable to locate the unpacked Graneri.app executable.");
};

const ensureRendererServer = async () => {
	if (await isUrlAvailable(rendererUrl)) {
		return null;
	}

	const child = spawn("bun", ["run", "dev"], {
		cwd: webPackageRoot,
		stdio: "inherit",
		env: process.env,
	});

	await new Promise((resolvePromise, rejectPromise) => {
		let settled = false;

		const rejectWithExit = (code) => {
			if (settled) {
				return;
			}

			settled = true;
			rejectPromise(
				new Error(
					`bun run dev exited before the renderer became available (code ${code ?? "null"}).`,
				),
			);
		};

		child.once("error", rejectPromise);
		child.once("exit", rejectWithExit);

		void waitForUrl(rendererUrl)
			.then(() => {
				if (settled) {
					return;
				}

				settled = true;
				child.removeListener("exit", rejectWithExit);
				resolvePromise();
			})
			.catch((error) => {
				if (settled) {
					return;
				}

				settled = true;
				child.removeListener("exit", rejectWithExit);
				rejectPromise(error);
			});
	});

	return child;
};

const terminateChild = (child, signal = "SIGTERM") => {
	if (!child || child.killed) {
		return;
	}

	child.kill(signal);
};

const rendererServer = await ensureRendererServer();

if (process.platform !== "darwin") {
	try {
		await runCommand("node", ["./scripts/dev.mjs"], { cwd: packageRoot });
		process.exit(0);
	} finally {
		terminateChild(rendererServer);
	}
}

await runCommand("bun", ["run", "build:desktop"], {
	cwd: webPackageRoot,
});
await runCommand("bun", ["run", "build"], { cwd: packageRoot });
await runCommand("bunx", ["electron-builder", "--mac", "dir"], {
	cwd: packageRoot,
});

const bundledAppExecutable = await resolveBundledAppExecutable();
const child = spawn(bundledAppExecutable, [], {
	cwd: packageRoot,
	stdio: ["inherit", "pipe", "pipe"],
	env: {
		...process.env,
		GRANERI_ENABLE_TRANSCRIPTION_DEBUG:
			process.env.GRANERI_ENABLE_TRANSCRIPTION_DEBUG ?? "1",
		GRANERI_DISABLE_UPDATER: "1",
		GRANERI_RENDERER_URL: rendererUrl,
	},
});

forwardElectronOutput(child);

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		child.kill(signal);
		terminateChild(rendererServer, signal);
	});
}

child.on("exit", (code) => {
	terminateChild(rendererServer);
	process.exit(code ?? 0);
});
