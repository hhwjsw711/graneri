import type { UIMessage } from "ai";

type QueuedRequestBody = Record<string, unknown>;

const hasDurableUnsafeLocalFolders = (requestBody: Record<string, unknown>) =>
	Array.isArray(requestBody.localFolders) &&
	requestBody.localFolders.length > 0;

type QueuedMessage = {
	messageId: string;
	metadataJson?: string;
	requestBodyJson: string;
	text: string;
};

const isRecord = (value: unknown): value is QueuedRequestBody =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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
	const trimmedText = text.trim();
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
		messageId: messageId ?? `queued-${crypto.randomUUID()}`,
		partsJson: JSON.stringify([{ type: "text", text: trimmedText }]),
		metadataJson: metadata === undefined ? undefined : JSON.stringify(metadata),
		text: trimmedText,
		requestBodyJson: JSON.stringify(sanitizedRequestBody),
	};
};

export const fromQueuedUserMessage = async ({
	queuedMessage,
	resolveConvexToken,
}: {
	queuedMessage: QueuedMessage;
	resolveConvexToken: () => Promise<string | null>;
}) => {
	const requestBody = parseQueuedRequestBody(queuedMessage.requestBodyJson);
	const convexToken = await resolveConvexToken();
	const metadata = parseQueuedMessageMetadata(queuedMessage.metadataJson);

	return {
		body: {
			...requestBody,
			convexToken,
		},
		message: {
			messageId: queuedMessage.messageId,
			text: queuedMessage.text,
			metadata,
		},
	};
};
