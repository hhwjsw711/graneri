export const createDesktopRecordingPowerSaveBlocker = ({
	logError,
	logInfo,
	powerSaveBlocker,
}) => {
	let blockerId = null;

	const start = ({ reason } = {}) => {
		if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
			return blockerId;
		}

		try {
			blockerId = powerSaveBlocker.start("prevent-display-sleep");
			logInfo({
				message: "[transcription] power save blocker started",
				details: {
					blockerId,
					reason,
					type: "prevent-display-sleep",
				},
			});
			return blockerId;
		} catch (error) {
			blockerId = null;
			logError({
				error,
				message: "[transcription] failed to start power save blocker",
			});
			return null;
		}
	};

	const stop = ({ reason } = {}) => {
		if (blockerId === null) {
			return;
		}

		const currentBlockerId = blockerId;
		blockerId = null;

		if (!powerSaveBlocker.isStarted(currentBlockerId)) {
			return;
		}

		try {
			powerSaveBlocker.stop(currentBlockerId);
			logInfo({
				message: "[transcription] power save blocker stopped",
				details: {
					blockerId: currentBlockerId,
					reason,
				},
			});
		} catch (error) {
			logError({
				error,
				message: "[transcription] failed to stop power save blocker",
			});
		}
	};

	return {
		isActive: () => blockerId !== null && powerSaveBlocker.isStarted(blockerId),
		start,
		stop,
	};
};
