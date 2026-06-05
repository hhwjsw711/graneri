import { afterEach, describe, expect, it } from "vitest";
import {
	getTranscriptionControllerMode,
	shouldUseDesktopTranscriptionProxy,
} from "../src/lib/desktop-transcription-session-mode";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
});

describe("desktop transcription session mode", () => {
	it("uses the desktop transcription proxy for macOS desktop runtime", () => {
		window.graneriDesktop = {
			platform: "darwin",
			configureTranscriptionSession: async () => ({ ok: true }),
			getTranscriptionSessionState: async () =>
				({}) as Awaited<
					ReturnType<
						NonNullable<
							Window["graneriDesktop"]
						>["getTranscriptionSessionState"]
					>
				>,
			onTranscriptionSessionEvent: () => () => {},
			onTranscriptionSessionState: () => () => {},
			startTranscriptionSession: async () => true,
			stopTranscriptionSession: async () => ({ ok: true }),
		} as Window["graneriDesktop"];

		expect(getTranscriptionControllerMode()).toBe("desktop-proxy");
		expect(shouldUseDesktopTranscriptionProxy()).toBe(true);
	});

	it("does not use the desktop transcription proxy outside macOS desktop runtime", () => {
		window.graneriDesktop = undefined;

		expect(getTranscriptionControllerMode()).toBe("browser");
		expect(shouldUseDesktopTranscriptionProxy()).toBe(false);

		window.graneriDesktop = {
			platform: "win32",
		} as Window["graneriDesktop"];

		expect(getTranscriptionControllerMode()).toBe("browser");
		expect(shouldUseDesktopTranscriptionProxy()).toBe(false);
	});

	it("fails visibly for stale macOS desktop bridge without transcription controller", () => {
		window.graneriDesktop = {
			platform: "darwin",
		} as Window["graneriDesktop"];

		expect(() => getTranscriptionControllerMode()).toThrow(
			"Desktop transcription controller is unavailable",
		);
	});
});
