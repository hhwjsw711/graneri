export const isPendingHostedUserMessage = (input) =>
	input &&
	typeof input === "object" &&
	typeof input.id === "string" &&
	input.role === "user" &&
	Array.isArray(input.parts);

const activeRunChangedError = () => ({
	error: "Active assistant run changed before the queued message could steer.",
	statusCode: 409,
});

const queuedMessageUnavailableError = () => ({
	error: "Queued message is no longer available.",
	statusCode: 409,
});

const cleanupClaimedInput = async ({ queuedInput, tolerateMissing = false }) => {
	const cleanupResult = await queuedInput.cleanupClaimed({ tolerateMissing });
	if (cleanupResult.ok) {
		return { ok: true };
	}

	return {
		ok: false,
		error: cleanupResult.error,
		queuedMessageIds: cleanupResult.queuedMessageIds,
	};
};

export const createHostedChatTurnController = ({
	attachableRun,
	chatId,
	interruptActiveRun,
	queuedInput,
	validateInput,
	workspaceId,
}) => {
	const cleanupClaimedSteerQueuedMessage = async (options = {}) =>
		await cleanupClaimedInput({
			queuedInput,
			tolerateMissing: options.tolerateMissing,
		});

	const prepareInput = async ({
		continueRunId,
		message,
		replayQueuedMessageId,
		steerQueuedMessageId,
	}) => {
		let interruptedPendingInput = [];
		let replayedUserMessage = null;
		let steeredUserMessage = null;
		let steeredUserMessages = [];

		if (steerQueuedMessageId) {
			if (!continueRunId || attachableRun?._id !== continueRunId) {
				return {
					ok: false,
					phase: "active_run_mismatch",
					...activeRunChangedError(),
				};
			}

			const claimedSteer = await queuedInput.claimSteer({
				runId: continueRunId,
				queuedMessageId: steerQueuedMessageId,
			});
			steeredUserMessages = claimedSteer.userMessages;
			steeredUserMessage = claimedSteer.userMessage;

			if (claimedSteer.claimedMessages.length === 0) {
				return {
					ok: false,
					phase: "queued_message_unavailable",
					...queuedMessageUnavailableError(),
				};
			}

			if (attachableRun.status === "running") {
				try {
					interruptedPendingInput = await interruptActiveRun({
						chatId,
						pendingInput: steeredUserMessages,
						runId: continueRunId,
						workspaceId,
					});
				} catch (error) {
					const cleanupResult = await cleanupClaimedSteerQueuedMessage();
					if (!cleanupResult.ok) {
						return {
							ok: false,
							cleanupError: cleanupResult.error,
							logMessage:
								"Failed to delete failed steered queue message after active run interrupt failure",
							phase: "steer_queue_cleanup_failed",
							error: "Failed to clean up claimed steered message.",
							statusCode: 500,
						};
					}

					return {
						ok: false,
						cause: error,
						logMessage: "Failed to interrupt active assistant run",
						phase: "active_run_interrupt_failed",
						error: "Failed to interrupt active assistant run.",
						statusCode: 500,
					};
				}
			}
		}

		if (replayQueuedMessageId && !continueRunId) {
			replayedUserMessage = await queuedInput.loadClaimedReplay({
				queuedMessageId: replayQueuedMessageId,
			});

			if (!replayedUserMessage) {
				return {
					ok: false,
					phase: "queued_message_unavailable",
					...queuedMessageUnavailableError(),
				};
			}
		}

		const effectiveMessage = steeredUserMessage ?? replayedUserMessage ?? message;
		if (!effectiveMessage) {
			const cleanupResult = await cleanupClaimedSteerQueuedMessage();
			if (!cleanupResult.ok) {
				return {
					ok: false,
					cleanupError: cleanupResult.error,
					logMessage:
						"Failed to delete failed steered queue message after missing input",
					phase: "steer_queue_cleanup_failed",
					error: "Failed to clean up claimed steered message.",
					statusCode: 500,
				};
			}

			return {
				ok: false,
				phase: "message_missing",
				error: "message is required.",
				statusCode: 400,
			};
		}

		const inputValidation = validateInput(effectiveMessage);
		if (!inputValidation.ok) {
			const cleanupResult = await cleanupClaimedSteerQueuedMessage();
			if (!cleanupResult.ok) {
				return {
					ok: false,
					cleanupError: cleanupResult.error,
					logMessage:
						"Failed to delete failed steered queue message after input size validation",
					phase: "steer_queue_cleanup_failed",
					error: "Failed to clean up claimed steered message.",
					statusCode: 500,
				};
			}

			return {
				ok: false,
				phase: "input_invalid",
				error: inputValidation.error,
				errorCode: inputValidation.errorCode,
				statusCode: 400,
			};
		}

		return {
			ok: true,
			cleanupClaimedSteerQueuedMessage,
			effectiveMessage,
			interruptedPendingInput,
			pendingSteerMessages:
				interruptedPendingInput.length > 0
					? interruptedPendingInput.filter(isPendingHostedUserMessage)
					: steeredUserMessages,
			replayedUserMessage,
			steeredUserMessage,
			steeredUserMessages,
		};
	};

	const requireSameActiveRun = async ({ continueRunId }) => {
		if (!continueRunId || attachableRun?._id === continueRunId) {
			return { ok: true };
		}

		const cleanupResult = await cleanupClaimedSteerQueuedMessage();
		if (!cleanupResult.ok) {
			return {
				ok: false,
				cleanupError: cleanupResult.error,
				logMessage:
					"Failed to delete failed steered queue message after active run mismatch",
				phase: "steer_queue_cleanup_failed",
				error: "Failed to clean up claimed steered message.",
				statusCode: 500,
			};
		}

		return {
			ok: false,
			phase: "active_run_mismatch",
			...activeRunChangedError(),
		};
	};

	return {
		cleanupClaimedSteerQueuedMessage,
		prepareInput,
		requireSameActiveRun,
	};
};
