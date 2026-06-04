import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "./build-system-audio-helper.mjs";
import { forwardElectronOutput } from "./forward-electron-output.mjs";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererUrl = process.env.GRANERI_RENDERER_URL ?? "http://127.0.0.1:3000";
const electronArgs = process.argv.slice(2);

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

await waitForUrl(rendererUrl);

if (process.platform === "darwin") {
	console.warn("[desktop:dev] Running the raw Electron bundle in development.");
}

const child = spawn(electronBinary, [".", ...electronArgs], {
	cwd: packageRoot,
	stdio: ["inherit", "pipe", "pipe"],
	env: {
		...process.env,
		GRANERI_RENDERER_URL: rendererUrl,
	},
});

forwardElectronOutput(child);

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		child.kill(signal);
	});
}

child.on("exit", (code) => {
	process.exit(code ?? 0);
});
