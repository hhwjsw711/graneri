import type { Id } from "../../../../convex/_generated/dataModel";
import { getCachedConvexToken } from "./convex-token";
import { getChatApiUrl } from "./runtime-config";

export const stopActiveChatStream = async ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces">;
}) => {
	const convexToken = await getCachedConvexToken();

	await fetch(`${getChatApiUrl()}/stop`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			id: chatId,
			workspaceId,
			convexToken,
		}),
	});
};
