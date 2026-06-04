import { isDesktopPlatform } from "@workspace/platform/desktop";

export const shouldUseDesktopTranscriptionProxy = () =>
	isDesktopPlatform("darwin");
