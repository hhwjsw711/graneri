import type { UIMessage } from "ai";
import {
	clampHostedChatWhitespace,
	MAX_HOSTED_CHAT_INPUT_TEXT_CHARS,
	validateHostedChatInputTextLimit,
} from "../../../../packages/ai/src/hosted-chat-runtime.mjs";

type QueuedRequestBody = Record<string, unknown>;

const hasDurableUnsafeLocalFolders = (requestBody: Record<string, unknown>) =>
	Array.isArray(requestBody.localFolders) &&
	requestBody.localFolders.length > 0;

type QueuedMessage = {
	_id: string;
	messageId: string;
	metadataJson?: string;
	requestBodyJson: string;
	text: string;
};

const generatedQueuedMessageIdPrefix = "queued-";

export const createQueuedUserMessageId = () =>
	`${generatedQueuedMessageIdPrefix}${crypto.randomUUID()}`;

export { MAX_HOSTED_CHAT_INPUT_TEXT_CHARS };

const isRecord = (value: unknown): value is QueuedRequestBody =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isGeneratedQueuedMessageId = (messageId: string) =>
	messageId.startsWith(generatedQueuedMessageIdPrefix);

const parseQueuedRequestBody = (requestBodyJson: string): QueuedRequestBody => {
	const parsed = JSON.parse(requestBodyJson) as unknown;

	if (!isRecord(parsed)) {
		throw new Error("Queued chat request body is invalid.");
	}

	return parsed;
};

const parseQueuedMessageMetadata = (
	metadataJson: string | undefined,
): UIMessage["metadata"] | undefined => {
	if (metadataJson === undefined) {
		return undefined;
	}

	const parsed = JSON.parse(metadataJson) as unknown;

	if (parsed !== undefined && !isRecord(parsed)) {
		throw new Error("Queued chat message metadata is invalid.");
	}

	return parsed as UIMessage["metadata"];
};

export const toQueuedUserMessageInput = ({
	messageId,
	metadata,
	requestBody,
	text,
}: {
	messageId?: string;
	metadata?: UIMessage["metadata"];
	requestBody: Record<string, unknown>;
	text: string;
}) => {
	const canonicalText = clampHostedChatWhitespace(text);
	if (!canonicalText) {
		throw new Error("Queued chat message cannot be empty.");
	}
	const resolvedMessageId = messageId ?? createQueuedUserMessageId();
	validateHostedChatInputTextLimit({
		id: resolvedMessageId,
		role: "user",
		parts: [{ type: "text", text }],
	});

	if (hasDurableUnsafeLocalFolders(requestBody)) {
		throw new Error(
			"Wait for the current answer before sending follow-ups that use local folders.",
		);
	}

	const sanitizedRequestBody = {
		...requestBody,
		convexToken: null,
	};

	return {
		messageId: resolvedMessageId,
		partsJson: JSON.stringify([{ type: "text", text: canonicalText }]),
		metadataJson: metadata === undefined ? undefined : JSON.stringify(metadata),
		text: canonicalText,
		requestBodyJson: JSON.stringify(sanitizedRequestBody),
	};
};

export const fromQueuedUserMessage = async ({
	hasMessageId,
	queuedMessage,
	resolveConvexToken,
}: {
	hasMessageId?: (messageId: string) => boolean;
	queuedMessage: QueuedMessage;
	resolveConvexToken: () => Promise<string | null>;
}) => {
	if (!queuedMessage._id.trim()) {
		throw new Error("Queued chat message requires a durable queue id.");
	}

	const requestBody = parseQueuedRequestBody(queuedMessage.requestBodyJson);
	const convexToken = await resolveConvexToken();
	if (!convexToken) {
		throw new Error("Cannot send queued chat message without a Convex token.");
	}
	const metadata = parseQueuedMessageMetadata(queuedMessage.metadataJson);

	return {
		body: {
			...requestBody,
			convexToken,
			replayQueuedMessageId: queuedMessage._id,
		},
		message: {
			messageId:
				!isGeneratedQueuedMessageId(queuedMessage.messageId) ||
				hasMessageId?.(queuedMessage.messageId)
					? queuedMessage.messageId
					: undefined,
			text: queuedMessage.text,
			metadata,
		},
	};
};
