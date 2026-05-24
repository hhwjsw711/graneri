import { isDesktopRuntime } from "@workspace/platform/desktop";

export type ReduceMotionPreference = "system" | "on" | "off";

export type DesktopAppearancePreferences = {
	fontSmoothing?: boolean | null;
	reduceMotion?: ReduceMotionPreference | null;
	translucentSidebar?: boolean | null;
};

export const DEFAULT_FONT_SMOOTHING = true;
export const DEFAULT_REDUCE_MOTION: ReduceMotionPreference = "system";
export const DEFAULT_TRANSLUCENT_SIDEBAR = false;

export function applyDesktopAppearancePreferenceAttributes(
	preferences: DesktopAppearancePreferences | null | undefined,
) {
	const root = document.documentElement;

	if (!isDesktopRuntime()) {
		delete root.dataset.fontSmoothing;
		delete root.dataset.reduceMotion;
		delete root.dataset.translucentSidebar;
		return;
	}

	root.dataset.fontSmoothing = String(
		preferences?.fontSmoothing ?? DEFAULT_FONT_SMOOTHING,
	);
	root.dataset.reduceMotion =
		preferences?.reduceMotion ?? DEFAULT_REDUCE_MOTION;
	root.dataset.translucentSidebar = String(
		preferences?.translucentSidebar ?? DEFAULT_TRANSLUCENT_SIDEBAR,
	);
}
