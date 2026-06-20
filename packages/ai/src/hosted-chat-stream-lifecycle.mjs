import { createAgentUIStream } from "ai";
import { pipeHostedActiveStreamText } from "./hosted-chat-active-stream.mjs";
import { createHostedAssistantRunFinalizationQueue } from "./hosted-chat-run-finalization-queue.mjs";

export const createHostedChatRunResponseStream = async ({
	activeStreamSession,
	agent,
	assistantMessageId,
	assistantRunId,
	chatMessages,
	createUiStream = createAgentUIStream,
	failAssistantRun,
	finalizeAssistantRun,
	finalizedToolSet,
	logLatency,
	onStreamCreateError,
	streamLatencyTracker,
	systemPrompt,
}) => {
	let finalizationQueue = null;
	let pendingTerminalization = null;
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const stream = await (async () => {
		try {
			return await createUiStream({
				agent,
				uiMessages: chatMessages,
				abortSignal: activeStreamSession.abortSignal,
				originalMessages: chatMessages,
				generateMessageId: () => assistantMessageId,
				sendReasoning: true,
				sendSources: true,
				onFinish: ({ isAborted, responseMessage }) => {
					logLatency("stream.finish", streamLatencyTracker.getFinishDetails());
					if (isAborted) {
						return;
					}

					const terminalization = {
						responseMessage,
						status: "completed",
					};
					if (finalizationQueue) {
						finalizationQueue.setTerminalization(terminalization);
						return;
					}
					pendingTerminalization = terminalization;
				},
				onError: () => "Something went wrong.",
			});
		} catch (error) {
			await onStreamCreateError?.(error);
			await failAssistantRun({
				runId: assistantRunId,
				errorText: error instanceof Error ? error.message : "Unknown error",
			});
			activeStreamSession.cleanup();
			return {
				error,
				ok: false,
			};
		}
	})();
	if (stream?.ok === false) {
		return stream;
	}

	logLatency("ai.stream_created");
	finalizationQueue = createHostedAssistantRunFinalizationQueue({
		finalizeAssistantRun,
		logLatency,
		runId: assistantRunId,
	});
	if (pendingTerminalization) {
		finalizationQueue.setTerminalization(pendingTerminalization);
		pendingTerminalization = null;
	}
	const persistedStream = pipeHostedActiveStreamText({
		onError: async (error) => {
			finalizationQueue?.setTerminalization({
				errorText:
					error instanceof Error
						? error.message
						: "Unknown active stream persistence error",
				status: "failed",
			});
			await finalizationQueue?.flushAfterClientStream();
		},
		onFlush: async () => {
			await finalizationQueue?.flushAfterClientStream();
		},
		persister: activeStreamSession,
		stream: streamLatencyTracker.wrapStream(stream),
	});

	return {
		ok: true,
		responseStream: activeStreamSession.startBroadcast(persistedStream),
	};
};
