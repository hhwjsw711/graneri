import {
	buildHostedChatSaveMessageArgs,
	getHostedChatReplayAcceptanceHeaders,
	getHostedChatSteerAcceptanceHeaders,
} from "./hosted-chat-runtime.mjs";

export const isHostedQueuedUserMessageAccept = ({
	continueRunId,
	queuedInput,
	replayQueuedMessageId,
}) =>
	Boolean(
		(continueRunId && queuedInput.hasClaimed) ||
			(replayQueuedMessageId && !continueRunId),
	);

const buildSaveMessageArgs = ({
	chatId,
	message,
	model,
	noteId,
	reasoningEffort,
	workspaceId,
}) =>
	buildHostedChatSaveMessageArgs({
		workspaceId,
		chatId,
		noteId,
		model,
		reasoningEffort,
		message,
	});

export const persistHostedChatUserMessage = async ({
	acceptQueuedUserMessage,
	acceptSteeredUserMessages,
	appendUserMessageToRun,
	chatId,
	continueRunId,
	message,
	model,
	noteId,
	queuedInput,
	reasoningEffort,
	replayQueuedMessageId,
	saveMessage,
	steeredUserMessages,
	workspaceId,
}) => {
	const saveMessageArgs = buildSaveMessageArgs({
		workspaceId,
		chatId,
		noteId,
		model,
		reasoningEffort,
		message,
	});

	if (continueRunId && queuedInput.hasClaimed) {
		const acceptedQueuedMessageId = queuedInput.claimedQueuedMessageId;
		if (!acceptedQueuedMessageId) {
			throw new Error("Claimed steered queued message is missing.");
		}

		await acceptSteeredUserMessages({
			workspaceId: saveMessageArgs.workspaceId,
			chatId: saveMessageArgs.chatId,
			noteId: saveMessageArgs.noteId,
			title: saveMessageArgs.title,
			preview: saveMessageArgs.preview,
			model: saveMessageArgs.model,
			reasoningEffort: saveMessageArgs.reasoningEffort,
			runId: continueRunId,
			messages: steeredUserMessages.map((steeredMessage, index) => ({
				queuedMessageId: queuedInput.claimedQueuedMessageIds[index],
				message: buildSaveMessageArgs({
					workspaceId,
					chatId,
					noteId,
					model,
					reasoningEffort,
					message: steeredMessage,
				}).message,
			})),
		});

		const acceptedHeaders = getHostedChatSteerAcceptanceHeaders({
			queuedMessageId: acceptedQueuedMessageId,
			queuedMessageIds: queuedInput.claimedQueuedMessageIds,
			turnId: continueRunId,
		});
		queuedInput.clearClaimed();
		return {
			acceptedSteerTurnId: continueRunId,
			pendingQueuedAcceptanceHeaders: acceptedHeaders,
		};
	}

	if (replayQueuedMessageId && !continueRunId) {
		await acceptQueuedUserMessage({
			...saveMessageArgs,
			queuedMessageId: replayQueuedMessageId,
		});
		return {
			acceptedSteerTurnId: null,
			pendingQueuedAcceptanceHeaders: getHostedChatReplayAcceptanceHeaders({
				queuedMessageId: replayQueuedMessageId,
			}),
		};
	}

	await saveMessage(saveMessageArgs);
	if (continueRunId) {
		await appendUserMessageToRun({
			runId: continueRunId,
			messageId: message.id,
		});
	}

	return {
		acceptedSteerTurnId: null,
		pendingQueuedAcceptanceHeaders: null,
	};
};
