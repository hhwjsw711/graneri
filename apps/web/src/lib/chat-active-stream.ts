import type { Id } from "../../../../convex/_generated/dataModel";
import { getCachedConvexToken } from "./convex-token";
import { getChatApiUrl } from "./runtime-config";

const readChatActionErrorMessage = async (
	response: Response,
	messagePrefix: string,
) => {
	const text = await response.text().catch(() => "");

	if (text) {
		try {
			const payload = JSON.parse(text) as { error?: unknown };
			if (typeof payload.error === "string" && payload.error.length > 0) {
				return payload.error;
			}
		} catch {
			return text;
		}
	}

	return `${messagePrefix} (${response.status}).`;
};

export const stopActiveChatStream = async ({
	chatId,
	interruptActiveRun = false,
	workspaceId,
}: {
	chatId: string;
	interruptActiveRun?: boolean;
	workspaceId: Id<"workspaces">;
}) => {
	await stopActiveChatStreamWithTransport({
		chatId,
		fetchChatStop: fetch,
		interruptActiveRun,
		workspaceId,
	});
};

export const stopActiveChatStreamWithTransport = async ({
	chatId,
	fetchChatStop,
	interruptActiveRun = false,
	workspaceId,
}: {
	chatId: string;
	fetchChatStop: typeof fetch;
	interruptActiveRun?: boolean;
	workspaceId: Id<"workspaces">;
}) => {
	const convexToken = await getCachedConvexToken();
	if (!convexToken) {
		throw new Error("Cannot stop chat stream without a Convex token.");
	}

	const response = await fetchChatStop(`${getChatApiUrl()}/stop`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			id: chatId,
			interruptActiveRun,
			workspaceId,
			convexToken,
		}),
	});

	if (!response.ok) {
		throw new Error(
			await readChatActionErrorMessage(response, "Failed to stop chat stream"),
		);
	}
};
