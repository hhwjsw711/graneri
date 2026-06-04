import { afterEach, describe, expect, it } from "vitest";
import { shouldUseDesktopTranscriptionProxy } from "../src/lib/desktop-transcription-session-mode";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
});

describe("desktop transcription session mode", () => {
	it("uses the desktop transcription proxy for macOS desktop runtime", () => {
		window.graneriDesktop = {
			platform: "darwin",
		} as Window["graneriDesktop"];

		expect(shouldUseDesktopTranscriptionProxy()).toBe(true);
	});

	it("does not use the desktop transcription proxy outside macOS desktop runtime", () => {
		window.graneriDesktop = undefined;

		expect(shouldUseDesktopTranscriptionProxy()).toBe(false);

		window.graneriDesktop = {
			platform: "win32",
		} as Window["graneriDesktop"];

		expect(shouldUseDesktopTranscriptionProxy()).toBe(false);
	});
});
