import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type { FileUIPart, UIMessage } from "ai";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import { getReadyFileParts } from "@/components/ai-elements/file-attachment-utils";
import { createChatUserMessage } from "@/lib/chat-message-state";
import {
	createQueuedUserMessageId,
	toQueuedUserMessageInput,
} from "@/lib/chat-queue";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ActiveRun =
	| {
			_id: Id<"assistantRuns">;
	  }
	| null
	| undefined;

type SubmitChatTurnMessage = {
	files?: FileUIPart[];
	messageId?: string;
	metadata?: UIMessage["metadata"];
	text: string;
};

export type EnqueueQueuedChatTurn = (args: {
	workspaceId: Id<"workspaces">;
	chatId: string;
	runId: Id<"assistantRuns">;
	message: ReturnType<typeof toQueuedUserMessageInput>;
}) => Promise<QueuedFollowUpMessage>;

export type SendChatTurn = (
	message: SubmitChatTurnMessage,
	options: { body: Record<string, unknown> },
) => Promise<unknown> | unknown;

export type SubmitChatTurnResult =
	| {
			status: "queued";
	  }
	| {
			status: "sent";
	  };

const isAssistantRunNoLongerActiveError = (error: unknown) => {
	const maybeError = error as
		| { data?: unknown; message?: unknown; code?: unknown }
		| null
		| undefined;
	if (maybeError?.code === "ASSISTANT_RUN_NOT_ACTIVE") {
		return true;
	}

	if (
		maybeError?.data &&
		typeof maybeError.data === "object" &&
		(maybeError.data as { code?: unknown }).code === "ASSISTANT_RUN_NOT_ACTIVE"
	) {
		return true;
	}

	return (
		typeof maybeError?.message === "string" &&
		maybeError.message.includes("ASSISTANT_RUN_NOT_ACTIVE")
	);
};

export const removeChatMessageById = (
	messages: UIMessage[],
	messageId: string,
) => messages.filter((message) => message.id !== messageId);

export const submitChatTurn = async <
	TRequestBody extends Record<string, unknown>,
>({
	attachedFiles,
	buildRequestBody,
	chatId,
	displayActiveRun,
	editingMessageId,
	enqueueQueuedMessage,
	metadata,
	onOptimisticMessage,
	onRequestPrepared,
	onQueuedMessageSaved,
	queueActiveRun,
	sendMessage,
	text,
	workspaceId,
}: {
	attachedFiles: ChatAttachment[];
	buildRequestBody: () => Promise<
		TRequestBody & { localFolders: DesktopLocalFolder[] }
	>;
	chatId: string;
	displayActiveRun: ActiveRun;
	editingMessageId: string | null;
	enqueueQueuedMessage: EnqueueQueuedChatTurn;
	metadata?: UIMessage["metadata"];
	onOptimisticMessage: (message: UIMessage) => void;
	onRequestPrepared: (args: {
		localFolders: DesktopLocalFolder[];
		requestBody: Record<string, unknown>;
	}) => void;
	onQueuedMessageSaved?: (args: {
		optimisticMessageId: string;
		queuedMessage: QueuedFollowUpMessage;
	}) => void;
	queueActiveRun?: ActiveRun;
	sendMessage: SendChatTurn;
	text: string;
	workspaceId: Id<"workspaces"> | null;
}): Promise<SubmitChatTurnResult> => {
	const queuedActiveRun = queueActiveRun ?? displayActiveRun;
	const readyFiles = getReadyFileParts(attachedFiles);
	const filePayload = readyFiles.length > 0 ? { files: readyFiles } : {};
	const optimisticMessageId =
		editingMessageId === null
			? queuedActiveRun
				? createQueuedUserMessageId()
				: crypto.randomUUID()
			: null;
	const optimisticMessage = optimisticMessageId
		? createChatUserMessage({
				files: readyFiles,
				id: optimisticMessageId,
				metadata,
				text,
			})
		: null;

	const requestBody = await buildRequestBody();
	onRequestPrepared({
		localFolders: requestBody.localFolders,
		requestBody,
	});

	if (optimisticMessage && !queuedActiveRun) {
		onOptimisticMessage(optimisticMessage);
	}

	const outgoingMessage = editingMessageId
		? {
				messageId: editingMessageId,
				text,
				metadata,
				...filePayload,
			}
		: {
				messageId: optimisticMessageId ?? undefined,
				text,
				metadata,
				...filePayload,
			};

	if (queuedActiveRun && workspaceId) {
		const queuedMessageInput = toQueuedUserMessageInput({
			messageId: editingMessageId ?? optimisticMessageId ?? undefined,
			metadata,
			requestBody,
			text,
		});

		try {
			const queuedMessage = await enqueueQueuedMessage({
				workspaceId,
				chatId,
				runId: queuedActiveRun._id,
				message: queuedMessageInput,
			});
			if (optimisticMessageId && onQueuedMessageSaved) {
				onQueuedMessageSaved({ optimisticMessageId, queuedMessage });
			}
			return { status: "queued" };
		} catch (error) {
			if (!isAssistantRunNoLongerActiveError(error)) {
				throw error;
			}
		}
	}

	if (optimisticMessage && queuedActiveRun) {
		onOptimisticMessage(optimisticMessage);
	}

	await Promise.resolve(
		sendMessage(outgoingMessage, {
			body: requestBody,
		}),
	);
	return { status: "sent" };
};
