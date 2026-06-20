import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { toast } from "sonner";
import type { QueuedFollowUpBarItem } from "@/components/chat/chat-queued-follow-up-bar";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import {
	prepareQueuedSteerIntent,
	QUEUED_SEND_NOW_PENDING_ID,
	type QueuedChatSendMessage,
} from "@/lib/queued-chat-intent";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

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
	onSteerStart,
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
	onSteerStart?: () => (() => void) | undefined;
	onEditMessage: (message: QueuedFollowUpMessage) => void;
	queuedMessages: Array<QueuedFollowUpMessage>;
	sendMessage: QueuedChatSendMessage;
	setQueuedMessages: SetQueuedMessages;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const discardQueuedMessage = useMutation(
		api.assistantQueuedMessages.discardQueued,
	);
	const reorderQueuedMessages = useMutation(
		api.assistantQueuedMessages.reorderQueuedForChat,
	);
	const [sendingNowIds, setSendingNowIds] = React.useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [editingId, setEditingId] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [editDraft, setEditDraft] =
		React.useState<QueuedMessageEditDraft | null>(null);
	const sendingNowIdsRef = React.useRef<Set<string> | null>(null);
	if (sendingNowIdsRef.current === null) {
		sendingNowIdsRef.current = new Set();
	}
	const sendNowChainRef = React.useRef<Promise<void> | null>(null);
	if (sendNowChainRef.current === null) {
		sendNowChainRef.current = Promise.resolve();
	}

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
			if (!workspaceId || !activeRun) {
				return;
			}

			const nextSendingNowId = queuedMessageId ?? QUEUED_SEND_NOW_PENDING_ID;
			const sendingNowIds = sendingNowIdsRef.current;
			const sendNowChain = sendNowChainRef.current;
			if (!sendingNowIds || !sendNowChain) {
				return;
			}
			if (sendingNowIds.has(nextSendingNowId)) {
				return;
			}
			sendingNowIds.add(nextSendingNowId);
			setSendingNowIds(new Set(sendingNowIds));
			const queuedMessage = queuedMessageId
				? queuedMessages.find((message) => message._id === queuedMessageId)
				: (queuedMessages[0] ?? null);
			const queuedMessageIndex = queuedMessage
				? queuedMessages.findIndex(
						(message) => message._id === queuedMessage._id,
					)
				: -1;

			const sendQueuedMessageNow = async () => {
				let rollbackSteerStart: (() => void) | undefined;
				try {
					if (!queuedMessage) {
						return;
					}

					setQueuedMessages((messages) =>
						messages.filter((message) => message._id !== queuedMessage._id),
					);
					const preparedQueuedIntent = await prepareQueuedSteerIntent({
						activeRunId: activeRun._id,
						hasMessageId: (messageId) => localMessageIds.has(messageId),
						queuedMessage,
						resolveConvexToken: getCachedConvexToken,
					});
					latestRequestBodyRef.current = preparedQueuedIntent.body;
					rollbackSteerStart = onSteerStart?.();
					await sendMessage(preparedQueuedIntent.message, {
						body: preparedQueuedIntent.body,
					});
				} catch (error) {
					rollbackSteerStart?.();
					if (queuedMessage && queuedMessageIndex >= 0) {
						setQueuedMessages((messages) =>
							restoreQueuedMessageAtIndex(messages, {
								index: queuedMessageIndex,
								message: queuedMessage,
							}),
						);
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
					sendingNowIds.delete(nextSendingNowId);
					setSendingNowIds(new Set(sendingNowIds));
				}
			};
			const nextSend = sendNowChain.then(
				sendQueuedMessageNow,
				sendQueuedMessageNow,
			);
			sendNowChainRef.current = nextSend.catch(() => undefined);
			await nextSend;
		},
		[
			activeRun,
			contextLabel,
			latestRequestBodyRef,
			localMessageIds,
			onSteerStart,
			queuedMessages,
			sendMessage,
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
			if (!workspaceId) {
				toast.error("Workspace is not ready");
				return;
			}

			setDeletingId(queuedMessage._id);
			try {
				await discardQueuedMessage({
					workspaceId,
					chatId,
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
		[
			chatId,
			contextLabel,
			discardQueuedMessage,
			queuedMessages,
			setQueuedMessages,
			workspaceId,
		],
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
				isSendingNow: sendingNowIds.has(queuedMessage._id),
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
			sendingNowIds,
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
