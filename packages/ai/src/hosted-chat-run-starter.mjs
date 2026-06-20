import { createHostedActiveChatStreamSession } from "./hosted-chat-active-stream.mjs";

export const getHostedChatRunStartPolicy = ({
	supersedeActiveRun = false,
	trigger,
}) =>
	trigger === "regenerate-message" || supersedeActiveRun ? "supersede" : "reject";

const getErrorText = (error, fallback) =>
	error instanceof Error ? error.message : fallback;

export const startHostedChatRun = async ({
	appendActiveStreamText,
	assistantMessageId,
	attachableRun,
	chatId,
	continueRunId,
	controllers,
	deleteActiveStreamSnapshot,
	failAssistantRun,
	finishActiveStreamToolCall,
	model,
	reasoningEffort,
	startActiveStream,
	startActiveStreamToolCall,
	startAssistantRun,
	supersedeActiveRun = false,
	trigger,
	workspaceId,
}) => {
	let assistantRun =
		continueRunId && attachableRun?._id === continueRunId ? attachableRun : null;
	let activeStreamSession = null;

	try {
		assistantRun ??= await startAssistantRun({
			workspaceId,
			chatId,
			assistantMessageId,
			model,
			reasoningEffort,
			policy: getHostedChatRunStartPolicy({
				trigger,
				supersedeActiveRun,
			}),
		});

		activeStreamSession = createHostedActiveChatStreamSession({
			controllers,
			workspaceId,
			chatId,
			messageId: assistantMessageId,
			runId: assistantRun._id,
			callbacks: {
				startActiveStream: (args) =>
					startActiveStream({
						...args,
						assistantMessageId,
					}),
				appendActiveStreamText,
				finishActiveStream: deleteActiveStreamSnapshot,
				startActiveStreamToolCall,
				finishActiveStreamToolCall,
			},
		});
		await activeStreamSession.start();

		return {
			activeStreamSession,
			assistantRun,
			ok: true,
		};
	} catch (error) {
		let terminalizationError = null;
		if (assistantRun) {
			await failAssistantRun({
				runId: assistantRun._id,
				errorText: getErrorText(error, "Unknown stream start error"),
			}).catch((failError) => {
				terminalizationError = failError;
			});
		}
		activeStreamSession?.cleanup();

		return {
			activeStreamSession,
			assistantRun,
			error,
			ok: false,
			terminalizationError,
		};
	}
};
