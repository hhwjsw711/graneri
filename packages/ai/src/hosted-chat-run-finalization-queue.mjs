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
		flushAfterClientStream() {
			if (pendingTerminalization?.status !== "completed") {
				return flush();
			}

			void flush().catch((error) => {
				logLatency("stream.finalize_background_failed", {
					errorMessage:
						error instanceof Error ? error.message : "Unknown error",
					runId,
				});
			});
			return Promise.resolve();
		},
		hasTerminalization() {
			return Boolean(pendingTerminalization);
		},
		setTerminalization(terminalization) {
			pendingTerminalization = terminalization;
		},
	};
};
