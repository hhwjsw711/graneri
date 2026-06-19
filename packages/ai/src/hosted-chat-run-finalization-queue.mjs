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
		finalizePromise = (async () => {
			try {
				await finalizeAssistantRun(terminalization);
				if (pendingTerminalization === terminalization) {
					pendingTerminalization = null;
				}
			} finally {
				finalizePromise = null;
			}
		})();
		return finalizePromise;
	};

	return {
		flush,
		flushAfterClientStream() {
			return flush();
		},
		hasTerminalization() {
			return Boolean(pendingTerminalization);
		},
		setTerminalization(terminalization) {
			pendingTerminalization = terminalization;
		},
	};
};
