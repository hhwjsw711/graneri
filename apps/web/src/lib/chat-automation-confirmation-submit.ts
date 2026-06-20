import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type { UIMessage } from "ai";
// react-doctor-disable-next-line react-doctor/no-flush-sync
import { flushSync } from "react-dom";
import { toast } from "sonner";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-controls";
import { normalizeChatMessages } from "@/lib/chat-message-state";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { logError } from "@/lib/logger";
import type { Id } from "../../../../convex/_generated/dataModel";
import { waitForBrowserPaint } from "./browser-paint";
import {
	type ActiveRun,
	type EnqueueQueuedChatTurn,
	removeChatMessageById,
	type SendChatTurn,
	submitChatTurn,
} from "./chat-submit-session";

type ScopedLocalOptimisticMessages = {
	chatId: string;
	messages: UIMessage[];
};

type StateUpdate<T> = T | ((currentState: T) => T);

type SetState<T> = (update: StateUpdate<T>) => void;
type SetQueuedMessages = (
	update: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
) => void;

export const submitAutomationConfirmationChatTurn = async <
	TRequestBody extends Record<string, unknown>,
>({
	activeRun,
	activeWorkspaceId,
	buildRequestBody,
	chatId,
	displayActiveRun,
	enqueueQueuedMessage,
	isAiRequestPending,
	onBeforeSubmit,
	onFinally,
	onOptimisticMessage,
	onRequestPrepared,
	sendMessage,
	setLocalOptimisticMessages,
	setMessages,
	setQueuedMessages,
	text,
}: {
	activeRun: ActiveRun;
	activeWorkspaceId: Id<"workspaces"> | null;
	buildRequestBody: (text: string) => Promise<
		TRequestBody & {
			localFolders: DesktopLocalFolder[];
		}
	>;
	chatId: string;
	displayActiveRun: ActiveRun;
	enqueueQueuedMessage: EnqueueQueuedChatTurn;
	isAiRequestPending: boolean;
	onBeforeSubmit?: () => void;
	onFinally?: () => void;
	onOptimisticMessage?: () => void;
	onRequestPrepared: (args: {
		localFolders: DesktopLocalFolder[];
		requestBody: Record<string, unknown>;
	}) => void;
	sendMessage: SendChatTurn;
	setLocalOptimisticMessages: SetState<ScopedLocalOptimisticMessages | null>;
	setMessages: SetState<UIMessage[]>;
	setQueuedMessages: SetQueuedMessages;
	text: string;
}) => {
	let optimisticMessageId: string | null = null;

	try {
		onBeforeSubmit?.();
		const result = await submitChatTurn({
			attachedFiles: [] satisfies ChatAttachment[],
			buildRequestBody: () => buildRequestBody(text),
			chatId,
			displayActiveRun,
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage: (message) => {
				optimisticMessageId = message.id;
				// react-doctor-disable-next-line react-doctor/no-flush-sync
				flushSync(() => {
					setLocalOptimisticMessages((currentState) => ({
						chatId,
						messages: normalizeChatMessages([
							...(currentState?.chatId === chatId ? currentState.messages : []),
							message,
						]),
					}));
					setMessages((currentMessages) =>
						normalizeChatMessages([...currentMessages, message]),
					);
				});
				onOptimisticMessage?.();
			},
			onRequestPrepared,
			onQueuedMessageSaved: ({ optimisticMessageId, queuedMessage }) => {
				setQueuedMessages((messages) =>
					messages.map((message) =>
						message._id === optimisticMessageId ? queuedMessage : message,
					),
				);
			},
			queueActiveRun:
				displayActiveRun ?? (isAiRequestPending ? activeRun : null),
			sendMessage,
			text,
			workspaceId: activeWorkspaceId,
		});

		if (result.status === "queued") {
			await waitForBrowserPaint();
		}
	} catch (error) {
		logError({
			event: "client.error",
			error,
			message: "Failed to submit automation confirmation",
		});
		toast.error(
			error instanceof Error
				? error.message
				: "Failed to submit automation confirmation",
		);
		if (optimisticMessageId) {
			const failedOptimisticMessageId = optimisticMessageId;
			setLocalOptimisticMessages((currentState) =>
				currentState?.chatId === chatId
					? {
							chatId,
							messages: removeChatMessageById(
								currentState.messages,
								failedOptimisticMessageId,
							),
						}
					: currentState,
			);
			setMessages((currentMessages) =>
				removeChatMessageById(currentMessages, failedOptimisticMessageId),
			);
		}
	} finally {
		onFinally?.();
	}
};
