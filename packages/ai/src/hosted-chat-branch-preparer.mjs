import { prepareHostedChatBranch } from "./hosted-chat-runtime.mjs";

export const getHostedInterruptedAssistantMessageIds = (runEvents) =>
	runEvents.flatMap((runEvent) =>
		runEvent.event.type === "assistant.message.interrupted"
			? [runEvent.event.assistantMessageId]
			: [],
	);

export const prepareHostedChatTurnBranch = async ({
	attachableRunId,
	chatId,
	continueRunId,
	getMessagesSnapshot,
	listRunEventsAfter,
	logLatency,
	message,
	messageId,
	messages = [],
	onTruncateError,
	pendingMessages = [],
	shouldLoadStoredMessages = true,
	storedMessagesForStatelessBranch = [],
	trigger,
	truncateFromMessage,
	workspaceId,
}) => {
	const storedMessages = shouldLoadStoredMessages
		? await getMessagesSnapshot({ workspaceId, chatId })
		: [];
	const runEvents =
		shouldLoadStoredMessages && continueRunId && attachableRunId === continueRunId
			? await listRunEventsAfter({ runId: continueRunId, limit: 500 })
			: [];
	const interruptedAssistantMessageIds =
		getHostedInterruptedAssistantMessageIds(runEvents);
	logLatency?.("convex.messages_loaded", {
		messageCount: storedMessages.length,
	});

	const branchStoredMessages = shouldLoadStoredMessages
		? storedMessages
		: storedMessagesForStatelessBranch;
	const preparedBranch = prepareHostedChatBranch({
		interruptedAssistantMessageIds,
		message,
		messageId,
		messages,
		pendingMessages,
		storedMessages: branchStoredMessages,
		trigger,
	});
	const shouldTruncateChatBranch = preparedBranch.shouldTruncateChatBranch;

	if (shouldTruncateChatBranch && preparedBranch.truncateMessageId) {
		try {
			await truncateFromMessage({
				workspaceId,
				chatId,
				messageId: preparedBranch.truncateMessageId,
			});
		} catch (error) {
			const handled = await onTruncateError?.({
				error,
				messageId: preparedBranch.truncateMessageId,
			});
			if (handled) {
				return {
					ok: false,
					reason: "truncate_error_handled",
				};
			}
			throw error;
		}
	}

	logLatency?.("chat.branch_ready", {
		incomingMessageCount: preparedBranch.incomingMessages.length,
		shouldTruncateChatBranch,
	});

	return {
		ok: true,
		preparedBranch,
		shouldTruncateChatBranch,
		storedMessages,
	};
};
