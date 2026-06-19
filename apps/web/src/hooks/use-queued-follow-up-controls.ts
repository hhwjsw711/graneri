import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { toast } from "sonner";
import type { QueuedFollowUpBarItem } from "@/components/chat/chat-queued-follow-up-bar";
import { fromQueuedUserMessage } from "@/lib/chat-queue";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type PreparedQueuedMessage = Awaited<ReturnType<typeof fromQueuedUserMessage>>;
type QueuedChatSendMessage = (
	message: PreparedQueuedMessage["message"],
	options: { body: PreparedQueuedMessage["body"] },
) => Promise<unknown>;
type AttachableRun =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;
type SetQueuedMessages = (
	updater: (
		messages: Array<QueuedFollowUpMessage>,
	) => Array<QueuedFollowUpMessage>,
) => void;
type QueuedMessageEditDraft = {
	index: number;
	message: QueuedFollowUpMessage;
};
const QUEUED_SEND_NOW_PENDING_ID = "__queued_send_now_pending__";

const restoreQueuedMessageAtIndex = (
	messages: Array<QueuedFollowUpMessage>,
	editDraft: QueuedMessageEditDraft,
) => {
	if (messages.some((message) => message._id === editDraft.message._id)) {
		return messages;
	}

	const nextMessages = [...messages];
	nextMessages.splice(editDraft.index, 0, editDraft.message);
	return nextMessages;
};

export const useQueuedFollowUpControls = ({
	activeRun,
	chatId,
	contextLabel,
	latestRequestBodyRef,
	localMessageIds,
	onEditMessage,
	queuedMessages,
	sendMessage,
	setQueuedMessages,
	workspaceId,
}: {
	activeRun: AttachableRun;
	chatId: string;
	contextLabel: string;
	latestRequestBodyRef: React.MutableRefObject<Record<string, unknown> | null>;
	localMessageIds: ReadonlySet<string>;
	onEditMessage: (message: QueuedFollowUpMessage) => void;
	queuedMessages: Array<QueuedFollowUpMessage>;
	sendMessage: QueuedChatSendMessage;
	setQueuedMessages: SetQueuedMessages;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const claimQueuedMessageForRun = useMutation(
		api.assistantQueuedMessages.claimNextForRun,
	);
	const discardClaimedMessage = useMutation(
		api.assistantQueuedMessages.discardClaimed,
	);
	const requeueClaimedMessage = useMutation(
		api.assistantQueuedMessages.requeueClaimed,
	);
	const discardQueuedMessage = useMutation(
		api.assistantQueuedMessages.discardQueued,
	);
	const reorderQueuedMessages = useMutation(
		api.assistantQueuedMessages.reorderQueuedForChat,
	);
	const [sendingNowId, setSendingNowId] = React.useState<string | null>(null);
	const [editingId, setEditingId] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [editDraft, setEditDraft] =
		React.useState<QueuedMessageEditDraft | null>(null);

	const restoreEditedQueuedMessage = React.useCallback(() => {
		if (!editDraft) {
			return;
		}

		setQueuedMessages((messages) =>
			restoreQueuedMessageAtIndex(messages, editDraft),
		);
		setEditDraft(null);
		setEditingId(null);
	}, [editDraft, setQueuedMessages]);

	const finishQueuedMessageEdit = React.useCallback(
		(updatedQueuedMessage: QueuedFollowUpMessage) => {
			if (!editDraft) {
				return;
			}

			setQueuedMessages((messages) => {
				const nextMessages = messages.filter(
					(message) => message._id !== updatedQueuedMessage._id,
				);
				nextMessages.splice(editDraft.index, 0, updatedQueuedMessage);
				return nextMessages;
			});
			setEditDraft(null);
			setEditingId(null);
		},
		[editDraft, setQueuedMessages],
	);

	const handleSendNow = React.useCallback(
		async (queuedMessageId?: string) => {
			if (!workspaceId || !activeRun || sendingNowId) {
				return;
			}

			let claimedQueuedMessageId: Id<"assistantQueuedMessages"> | null = null;
			let claimedQueuedMessage: QueuedFollowUpMessage | null = null;
			try {
				setSendingNowId(queuedMessageId ?? QUEUED_SEND_NOW_PENDING_ID);
				const queuedMessage = await claimQueuedMessageForRun({
					runId: activeRun._id,
					queuedMessageId: queuedMessageId as
						| Id<"assistantQueuedMessages">
						| undefined,
				});

				if (!queuedMessage) {
					return;
				}

				claimedQueuedMessageId = queuedMessage._id;
				claimedQueuedMessage = queuedMessage;
				setQueuedMessages((messages) =>
					messages.filter((message) => message._id !== queuedMessage._id),
				);
				setSendingNowId(queuedMessage._id);
				const preparedQueuedMessage = await fromQueuedUserMessage({
					hasMessageId: (messageId) => localMessageIds.has(messageId),
					queuedMessage,
					resolveConvexToken: getCachedConvexToken,
				});
				const outgoingRequestBody = {
					...preparedQueuedMessage.body,
					supersedeActiveRun: true,
				};
				latestRequestBodyRef.current = outgoingRequestBody;
				await sendMessage(preparedQueuedMessage.message, {
					body: outgoingRequestBody,
				});
				await discardClaimedMessage({
					queuedMessageId: claimedQueuedMessageId,
				});
				claimedQueuedMessageId = null;
			} catch (error) {
				if (claimedQueuedMessageId) {
					await requeueClaimedMessage({
						queuedMessageId: claimedQueuedMessageId,
					}).catch((requeueError) => {
						logError({
							event: "client.error",
							error: requeueError,
							message: `Failed to requeue steered ${contextLabel} message`,
						});
					});
					if (claimedQueuedMessage) {
						const requeuedMessage = claimedQueuedMessage;
						setQueuedMessages((messages) =>
							messages.some((message) => message._id === requeuedMessage._id)
								? messages
								: [requeuedMessage, ...messages],
						);
					}
				}
				logError({
					event: "client.error",
					error,
					message: `Failed to send queued ${contextLabel} message now`,
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to send queued message now",
				);
			} finally {
				setSendingNowId(null);
			}
		},
		[
			activeRun,
			claimQueuedMessageForRun,
			contextLabel,
			discardClaimedMessage,
			latestRequestBodyRef,
			localMessageIds,
			requeueClaimedMessage,
			sendMessage,
			sendingNowId,
			setQueuedMessages,
			workspaceId,
		],
	);

	const handleEdit = React.useCallback(
		(queuedMessageId: string) => {
			const queuedMessageIndex = queuedMessages.findIndex(
				(message) => message._id === queuedMessageId,
			);
			if (queuedMessageIndex < 0) {
				return;
			}

			const queuedMessage = queuedMessages[queuedMessageIndex];
			setEditingId(queuedMessage._id);
			setEditDraft({
				index: queuedMessageIndex,
				message: queuedMessage,
			});
			setQueuedMessages((messages) => {
				const nextMessages = editDraft
					? restoreQueuedMessageAtIndex(messages, editDraft)
					: messages;

				return nextMessages.filter(
					(message) => message._id !== queuedMessage._id,
				);
			});
			onEditMessage(queuedMessage);
		},
		[editDraft, onEditMessage, queuedMessages, setQueuedMessages],
	);

	const handleDelete = React.useCallback(
		async (queuedMessageId: string) => {
			const queuedMessage = queuedMessages.find(
				(message) => message._id === queuedMessageId,
			);
			if (!queuedMessage) {
				return;
			}

			setDeletingId(queuedMessage._id);
			try {
				await discardQueuedMessage({
					queuedMessageId: queuedMessage._id,
				});
				setQueuedMessages((messages) =>
					messages.filter((message) => message._id !== queuedMessage._id),
				);
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: `Failed to delete queued ${contextLabel} message`,
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to delete queued message",
				);
			} finally {
				setDeletingId(null);
			}
		},
		[contextLabel, discardQueuedMessage, queuedMessages, setQueuedMessages],
	);

	const handleReorder = React.useCallback(
		(queuedMessageIds: Array<string>) => {
			if (!workspaceId) {
				return;
			}

			setQueuedMessages((messages) => {
				const messagesById = new Map(
					messages.map((message) => [message._id, message]),
				);
				const reorderedMessages = queuedMessageIds
					.map((queuedMessageId) =>
						messagesById.get(queuedMessageId as Id<"assistantQueuedMessages">),
					)
					.filter(
						(message): message is (typeof messages)[number] =>
							message !== undefined,
					);

				return reorderedMessages.length === messages.length
					? reorderedMessages
					: messages;
			});
			void reorderQueuedMessages({
				workspaceId,
				chatId,
				queuedMessageIds: queuedMessageIds as Array<
					Id<"assistantQueuedMessages">
				>,
			}).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: `Failed to reorder queued ${contextLabel} messages`,
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to reorder queued messages",
				);
			});
		},
		[
			chatId,
			contextLabel,
			reorderQueuedMessages,
			setQueuedMessages,
			workspaceId,
		],
	);

	const queuedFollowUps = React.useMemo<Array<QueuedFollowUpBarItem>>(
		() =>
			queuedMessages.map((queuedMessage) => ({
				id: queuedMessage._id,
				isDeleting: deletingId === queuedMessage._id,
				isEditing: editingId === queuedMessage._id,
				isSendingNow: sendingNowId === queuedMessage._id,
				onDelete: () => {
					void handleDelete(queuedMessage._id);
				},
				onEdit: () => handleEdit(queuedMessage._id),
				onSendNow: () => {
					void handleSendNow(queuedMessage._id);
				},
				text: queuedMessage.text,
			})),
		[
			deletingId,
			editingId,
			handleDelete,
			handleEdit,
			handleSendNow,
			queuedMessages,
			sendingNowId,
		],
	);

	return {
		editDraft,
		finishQueuedMessageEdit,
		onQueuedFollowUpsReorder: handleReorder,
		queuedFollowUps,
		restoreEditedQueuedMessage,
		sendQueuedFollowUpNow: handleSendNow,
	};
};
