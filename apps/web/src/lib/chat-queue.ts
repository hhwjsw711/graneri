import type { UIMessage } from "ai";

const hasDurableUnsafeLocalFolders = (requestBody: Record<string, unknown>) =>
	Array.isArray(requestBody.localFolders) &&
	requestBody.localFolders.length > 0;

type QueuedMessage = {
	messageId: string;
	metadataJson?: string;
	requestBodyJson: string;
	text: string;
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
	const requestBody = JSON.parse(queuedMessage.requestBodyJson) as Record<
		string,
		unknown
	>;
	const convexToken = await resolveConvexToken();
	const metadata =
		queuedMessage.metadataJson === undefined
			? undefined
			: (JSON.parse(queuedMessage.metadataJson) as UIMessage["metadata"]);

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
