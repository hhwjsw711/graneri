import type { DesktopMeetingDetectionState } from "@workspace/platform/desktop-bridge";

export const getMeetingWidgetTitle = (
	state: DesktopMeetingDetectionState | null,
) => {
	if (!state?.hasMeetingSignal) {
		return "Listening for calls";
	}

	const sourceName = state.sourceName?.toLowerCase() ?? "";

	if (sourceName.includes("slack")) {
		return "Huddle detected";
	}

	if (sourceName.includes("facetime") || sourceName.includes("whatsapp")) {
		return "Call detected";
	}

	return "Meeting detected";
};

export const getMeetingWidgetDetail = (
	state: DesktopMeetingDetectionState | null,
) => {
	if (!state?.hasMeetingSignal) {
		return null;
	}

	if (state.calendarEvent) {
		return state.calendarEvent.title;
	}

	if (state.sourceName) {
		return state.sourceName;
	}

	return null;
};
