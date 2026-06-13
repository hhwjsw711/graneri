import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const files = [
	"src/main.mjs",
	"src/desktop-app-menu.mjs",
	"src/meeting-source.mjs",
	"src/meeting-detection.mjs",
	"src/desktop-navigation-state.mjs",
	"src/desktop-shell.mjs",
	"src/desktop-storage.mjs",
	"src/desktop-tray.mjs",
	"src/desktop-updater.mjs",
	"src/desktop-window.mjs",
	"src/native-audio-capture.mjs",
	"src/local-server.mjs",
	"src/auth-client.mjs",
	"src/network.mjs",
	"src/runtime-config.mjs",
	"src/env.mjs",
	"src/dictation-audio-buffer.mjs",
	"src/dictation-paste.mjs",
	"src/global-dictation.mjs",
	"src/global-dictation-hotkey-monitor.mjs",
	"src/preload-api.cjs",
	"src/preload.cjs",
	"tests/desktop-storage.test.mjs",
	"tests/dictation-audio-buffer.test.mjs",
	"tests/preload-api.test.cjs",
	"scripts/dev.mjs",
	"scripts/dev-bundled.mjs",
	"scripts/build.mjs",
	"scripts/build-system-audio-helper.mjs",
	"scripts/forward-electron-output.mjs",
	"scripts/generate-app-icon.mjs",
	"scripts/generate-tray-icons.mjs",
];

const cwd = fileURLToPath(new URL("..", import.meta.url));

for (const file of files) {
	const result = spawnSync(process.execPath, ["--check", file], {
		cwd,
		stdio: "inherit",
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
