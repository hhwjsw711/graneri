import {
	isDesktopPlatform,
	supportsDesktopTranscriptionController,
} from "@workspace/platform/desktop";

export type TranscriptionControllerMode = "browser" | "desktop-proxy";

export const getTranscriptionControllerMode =
	(): TranscriptionControllerMode => {
		if (!isDesktopPlatform("darwin")) {
			return "browser";
		}

		if (!supportsDesktopTranscriptionController()) {
			throw new Error(
				"Desktop transcription controller is unavailable. Restart or update the desktop app.",
			);
		}

		return "desktop-proxy";
	};

export const shouldUseDesktopTranscriptionProxy = () =>
	getTranscriptionControllerMode() === "desktop-proxy";
