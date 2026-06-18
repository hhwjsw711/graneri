type HostedChatLogDetails = Record<
	string,
	string | number | boolean | null | undefined
>;

export declare const stopOrphanedHostedAssistantRun: <
	TRunId extends string,
	TWorkspaceId extends string,
>({
	chatId,
	finishStoppedAssistantRun,
	logLatency,
	requestStopAssistantRun,
	runId,
	stopActiveStream,
	workspaceId,
}: {
	chatId: string;
	finishStoppedAssistantRun: (args: { runId: TRunId }) => Promise<unknown>;
	logLatency: (event: string, details?: HostedChatLogDetails) => void;
	requestStopAssistantRun: (args: {
		runId: TRunId;
		stopReason: "cleanup_failed";
	}) => Promise<unknown>;
	runId: TRunId;
	stopActiveStream: (args: {
		workspaceId: TWorkspaceId;
		chatId: string;
		runId: TRunId;
	}) => Promise<unknown>;
	workspaceId: TWorkspaceId;
}) => Promise<void>;
