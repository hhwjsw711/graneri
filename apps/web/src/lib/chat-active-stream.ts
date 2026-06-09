import type { Id } from "../../../../convex/_generated/dataModel";
import { getCachedConvexToken } from "./convex-token";
import { getChatApiUrl } from "./runtime-config";

const readStopErrorMessage = async (response: Response) => {
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

	return `Failed to stop chat stream (${response.status}).`;
};

export const stopActiveChatStream = async ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces">;
}) => {
	const convexToken = await getCachedConvexToken();

	const response = await fetch(`${getChatApiUrl()}/stop`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			id: chatId,
			workspaceId,
			convexToken,
		}),
	});

	if (!response.ok) {
		throw new Error(await readStopErrorMessage(response));
	}
};
