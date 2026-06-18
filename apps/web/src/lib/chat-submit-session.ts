import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type { FileUIPart, UIMessage } from "ai";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import { getReadyFileParts } from "@/components/ai-elements/file-attachment-utils";
import { createChatUserMessage } from "@/lib/chat-message-state";
import {
	createQueuedUserMessageId,
	toQueuedUserMessageInput,
} from "@/lib/chat-queue";
import type { Id } from "../../../../convex/_generated/dataModel";

type ActiveRun =
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

type EnqueueQueuedChatTurn = (args: {
	workspaceId: Id<"workspaces">;
	chatId: string;
	runId: Id<"assistantRuns">;
	message: ReturnType<typeof toQueuedUserMessageInput>;
}) => Promise<unknown>;

type SendChatTurn = (
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

export const removeChatMessageById = (
	messages: UIMessage[],
	messageId: string,
) => messages.filter((message) => message.id !== messageId);

export const submitChatTurn = async <
	TRequestBody extends Record<string, unknown>,
>({
	activeRun,
	attachedFiles,
	buildRequestBody,
	chatId,
	displayActiveRun,
	editingMessageId,
	enqueueQueuedMessage,
	metadata,
	onOptimisticMessage,
	onRequestPrepared,
	optimisticQueuedMessage = true,
	sendMessage,
	text,
	workspaceId,
}: {
	activeRun: ActiveRun;
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
	optimisticQueuedMessage?: boolean;
	sendMessage: SendChatTurn;
	text: string;
	workspaceId: Id<"workspaces"> | null;
}): Promise<SubmitChatTurnResult> => {
	const readyFiles = getReadyFileParts(attachedFiles);
	const filePayload = readyFiles.length > 0 ? { files: readyFiles } : {};
	const optimisticMessageId =
		editingMessageId === null
			? displayActiveRun
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

	if (optimisticMessage && (!displayActiveRun || optimisticQueuedMessage)) {
		onOptimisticMessage(optimisticMessage);
	}

	const requestBody = await buildRequestBody();
	const outgoingRequestBody =
		activeRun && !displayActiveRun
			? { ...requestBody, allowConcurrentRun: true }
			: requestBody;
	onRequestPrepared({
		localFolders: requestBody.localFolders,
		requestBody: outgoingRequestBody,
	});

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

	if (displayActiveRun && workspaceId) {
		await enqueueQueuedMessage({
			workspaceId,
			chatId,
			runId: displayActiveRun._id,
			message: toQueuedUserMessageInput({
				messageId: editingMessageId ?? optimisticMessageId ?? undefined,
				metadata,
				requestBody: outgoingRequestBody,
				text,
			}),
		});
		return { status: "queued" };
	}

	await Promise.resolve(
		sendMessage(outgoingMessage, {
			body: outgoingRequestBody,
		}),
	);
	return { status: "sent" };
};
