export const createHostedAssistantRunFinalizationQueue = ({
	finalizeAssistantRun,
	logLatency,
	runId,
}) => {
	let finalizePromise = null;
	let pendingTerminalization = null;

	const flush = () => {
		if (finalizePromise) {
			return finalizePromise;
		}

		if (!pendingTerminalization) {
			return Promise.resolve();
		}

		const terminalization = pendingTerminalization;
		logLatency("stream.finalize_queued", {
			runId,
			status: terminalization.status,
		});
		finalizePromise = finalizeAssistantRun(terminalization);
		return finalizePromise;
	};

	return {
		flush,
		hasTerminalization() {
			return Boolean(pendingTerminalization);
		},
		setTerminalization(terminalization) {
			pendingTerminalization = terminalization;
		},
	};
};
