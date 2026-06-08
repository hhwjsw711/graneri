import { detectActiveBrowserMeetingWindowState } from "./browser-meeting-source.mjs";
import { createInactiveBrowserMeetingWindowState } from "./meeting-window-state.mjs";

const browserMeetingWindowPollMs = 2_000;
const browserMeetingWindowFailureBackoffMs = 30_000;

export const createBrowserMeetingWindowMonitor = ({ onState }) => {
	let pollTimeoutId = null;
	let isRunning = false;
	let consecutiveUnavailablePolls = 0;

	const stop = () => {
		isRunning = false;
		if (pollTimeoutId != null) {
			clearTimeout(pollTimeoutId);
			pollTimeoutId = null;
		}

		onState(createInactiveBrowserMeetingWindowState());
	};

	const poll = async () => {
		try {
			const state = await detectActiveBrowserMeetingWindowState();
			onState(state);
			consecutiveUnavailablePolls =
				state.permissionGranted === false ? consecutiveUnavailablePolls + 1 : 0;
		} catch (error) {
			console.error(
				"[meeting-detection] failed to detect browser meeting window",
				error,
			);
			consecutiveUnavailablePolls += 1;
		} finally {
			if (isRunning) {
				pollTimeoutId = setTimeout(
					() => {
						void poll();
					},
					consecutiveUnavailablePolls > 0
						? browserMeetingWindowFailureBackoffMs
						: browserMeetingWindowPollMs,
				);
			}
		}
	};

	const start = async () => {
		if (process.platform !== "darwin") {
			return false;
		}

		if (isRunning) {
			return true;
		}

		isRunning = true;
		await poll();
		return true;
	};

	return {
		start,
		stop,
	};
};
