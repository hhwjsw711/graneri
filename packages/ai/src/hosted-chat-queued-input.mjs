import {
	isHostedChatQueuedMessageNotFoundError,
	toHostedQueuedUserMessage,
} from "./hosted-chat-runtime.mjs";

const getClaimedQueuedMessageIds = ({
	claimedQueuedMessageId,
	claimedQueuedMessageIds,
}) =>
	claimedQueuedMessageIds.length > 0
		? claimedQueuedMessageIds
		: claimedQueuedMessageId
			? [claimedQueuedMessageId]
			: [];

export const createHostedChatQueuedInput = ({
	chatId,
	claimReadyForRun,
	discardClaimed,
	getClaimedForChat,
	workspaceId,
}) => {
	let claimedQueuedMessageId = null;
	let claimedQueuedMessageIds = [];

	const clearClaimed = () => {
		claimedQueuedMessageId = null;
		claimedQueuedMessageIds = [];
	};

	return {
		get hasClaimed() {
			return Boolean(claimedQueuedMessageId);
		},

		get claimedQueuedMessageId() {
			return claimedQueuedMessageId;
		},

		get claimedQueuedMessageIds() {
			return claimedQueuedMessageIds;
		},

		clearClaimed,

		async claimSteer({ queuedMessageId, runId }) {
			const claimedMessages = await claimReadyForRun({
				runId,
				queuedMessageId,
			});
			claimedQueuedMessageId = claimedMessages[0]?._id ?? null;
			claimedQueuedMessageIds = claimedMessages.map(
				(queuedMessage) => queuedMessage._id,
			);
			const userMessages = claimedMessages.map((queuedMessage) =>
				toHostedQueuedUserMessage(queuedMessage),
			);

			return {
				claimedMessages,
				userMessage: userMessages[userMessages.length - 1] ?? null,
				userMessages,
			};
		},

		async loadClaimedReplay({ queuedMessageId }) {
			const queuedMessage = await getClaimedForChat({
				workspaceId,
				chatId,
				queuedMessageId,
			});

			return queuedMessage ? toHostedQueuedUserMessage(queuedMessage) : null;
		},

		async cleanupClaimed({ tolerateMissing = false } = {}) {
			const queuedMessageIds = getClaimedQueuedMessageIds({
				claimedQueuedMessageId,
				claimedQueuedMessageIds,
			});
			if (queuedMessageIds.length === 0) {
				return { ok: true, cleaned: false };
			}

			try {
				await Promise.all(
					queuedMessageIds.map((queuedMessageId) =>
						discardClaimed({
							workspaceId,
							chatId,
							queuedMessageId,
						}),
					),
				);
				clearClaimed();
				return { ok: true, cleaned: true };
			} catch (error) {
				if (tolerateMissing && isHostedChatQueuedMessageNotFoundError(error)) {
					clearClaimed();
					return { ok: true, cleaned: true };
				}

				return {
					ok: false,
					error,
					queuedMessageIds,
				};
			}
		},
	};
};
