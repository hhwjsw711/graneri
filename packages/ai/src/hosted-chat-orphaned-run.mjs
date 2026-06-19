export const stopOrphanedHostedAssistantRun = async ({
	chatId,
	finishStoppedAssistantRun,
	logLatency,
	requestStopAssistantRun,
	runId,
	stopActiveStream,
	workspaceId,
}) => {
	logLatency("stream.reconnect_orphaned_run_stop_start", {
		runId,
	});
	await requestStopAssistantRun({
		runId,
		stopReason: "cleanup_failed",
	});
	try {
		await stopActiveStream({
			workspaceId,
			chatId,
			runId,
		});
	} finally {
		await finishStoppedAssistantRun({ runId });
	}
	logLatency("stream.reconnect_orphaned_run_stop_done", {
		runId,
	});
};
