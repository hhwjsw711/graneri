import { getCachedConvexToken } from "@/lib/convex-token";

export const prepareChatReconnectToStreamRequest = async ({
	api,
	chatId,
	workspaceId,
}: {
	api: string;
	chatId: string;
	workspaceId: string | null;
}) => {
	if (!workspaceId) {
		throw new Error("Cannot resume chat stream without a workspace.");
	}

	const convexToken = await getCachedConvexToken();
	if (!convexToken) {
		throw new Error("Cannot resume chat stream without authentication.");
	}

	const reconnectUrl = new URL(
		`${api.replace(/\/$/, "")}/${encodeURIComponent(chatId)}/stream`,
		window.location.origin,
	);
	reconnectUrl.searchParams.set("workspaceId", workspaceId);

	return {
		api: reconnectUrl.toString(),
		headers: {
			Authorization: `Bearer ${convexToken}`,
		},
	};
};
