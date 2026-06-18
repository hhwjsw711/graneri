import {
	buildHostedChatSaveMessageArgs,
	generateHostedChatTitle,
} from "./hosted-chat-runtime.mjs";

const getConvexErrorCode = (error) => {
	if (!error || typeof error !== "object" || !("data" in error)) {
		return null;
	}

	const data = error.data;
	if (!data || typeof data !== "object" || !("code" in data)) {
		return null;
	}

	return typeof data.code === "string" ? data.code : null;
};

const isConvexErrorCode = (error, code) => getConvexErrorCode(error) === code;

export const createHostedAssistantRunFinalizer = ({
	activeStreamSession,
	assistantRunId,
	chatId,
	failAssistantRun,
	finishAssistantRun,
	lastUserMessage,
	logError,
	logLatency,
	model,
	noteId,
	onCompleted,
	onFailed,
	onFinalizeError,
	onTitleGenerationError,
	reasoningEffort,
	saveAssistantMessageForRun,
	shouldGenerateChatTitle,
	updateChatTitle,
	workspaceId,
}) => {
	const finalizeCompletedRun = async ({ responseMessage }) => {
		logLatency("stream.persist_save_start", {
			messageId: responseMessage.id,
			runId: assistantRunId,
		});
		const saveResult = await saveAssistantMessageForRun({
			...buildHostedChatSaveMessageArgs({
				workspaceId,
				chatId,
				noteId,
				model,
				reasoningEffort,
				message: responseMessage,
			}),
			runId: assistantRunId,
		});
		logLatency("stream.persist_save_done", {
			messageId: responseMessage.id,
			runId: assistantRunId,
			saved: Boolean(saveResult),
		});

		if (!saveResult) {
			logLatency("stream.finish_save_skipped_for_terminal_run", {
				runId: assistantRunId,
			});
			return false;
		}

		if (
			shouldGenerateChatTitle &&
			lastUserMessage &&
			!activeStreamSession.abortSignal.aborted
		) {
			void (async () => {
				try {
					const generatedChatTitle = await generateHostedChatTitle({
						userMessage: lastUserMessage,
						assistantMessage: responseMessage,
					});
					await updateChatTitle({
						workspaceId,
						chatId,
						title: generatedChatTitle,
						onlyIfReplaceable: true,
					});
				} catch (error) {
					onTitleGenerationError?.({ error, responseMessage });
				}
			})();
		}

		return true;
	};

	const closePersistenceForTerminalization = async (terminalization) => {
		try {
			await activeStreamSession.closePersistence();
		} catch (error) {
			if (
				terminalization.status === "completed" &&
				isConvexErrorCode(error, "ACTIVE_STREAM_NOT_FOUND")
			) {
				logLatency("stream.persistence_already_closed", {
					runId: assistantRunId,
				});
				return;
			}

			throw error;
		}
	};

	const failRunAfterFinalizeError = async (error) => {
		try {
			await failAssistantRun({
				runId: assistantRunId,
				errorText: error instanceof Error ? error.message : "Unknown error",
			});
		} catch (failError) {
			if (isConvexErrorCode(failError, "INVALID_ASSISTANT_RUN_TRANSITION")) {
				logLatency("stream.fail_skipped_for_terminal_run", {
					runId: assistantRunId,
				});
				return;
			}

			throw failError;
		}
	};

	return async (terminalization) => {
		try {
			if (terminalization.status === "completed") {
				const shouldFinalizeRun = await finalizeCompletedRun(terminalization);
				if (!shouldFinalizeRun) {
					return;
				}
			}

			logLatency("stream.finalize_start", {
				runId: assistantRunId,
				status: terminalization.status,
			});
			await closePersistenceForTerminalization(terminalization);
			logLatency("stream.persistence_closed", {
				runId: assistantRunId,
			});

			if (terminalization.status === "completed") {
				await finishAssistantRun({ runId: assistantRunId });
				logLatency("stream.finalize_done", {
					runId: assistantRunId,
					status: terminalization.status,
				});
				onCompleted?.();
				return;
			}

			await failAssistantRun({
				runId: assistantRunId,
				errorText: terminalization.errorText,
			});
			logLatency("stream.finalize_done", {
				runId: assistantRunId,
				status: terminalization.status,
			});
			onFailed?.();
		} catch (error) {
			if (
				terminalization.status === "completed" &&
				activeStreamSession.abortSignal.aborted
			) {
				logLatency("stream.finish_save_skipped_after_abort", {
					runId: assistantRunId,
				});
				return;
			}

			logError({
				error,
				terminalization,
			});
			onFinalizeError?.({ error, terminalization });
			await failRunAfterFinalizeError(error);
		} finally {
			activeStreamSession.cleanup();
		}
	};
};
