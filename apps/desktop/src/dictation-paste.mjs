import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clipboard } from "electron";

const execFileAsync = promisify(execFile);
const pasteRestoreDelayMs = 400;

export const pasteTextToFocusedInput = async (text) => {
	const previousText = clipboard.readText();

	clipboard.writeText(text);
	await execFileAsync("osascript", [
		"-e",
		'tell application "System Events" to keystroke "v" using command down',
	]);

	setTimeout(() => {
		if (clipboard.readText() === text) {
			clipboard.writeText(previousText);
		}
	}, pasteRestoreDelayMs);
};
