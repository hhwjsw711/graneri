import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatRequest } from "../../apps/web/server/chat-handler";
import { handleHostedApiRoute } from "../_hosted-route";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: async (routeRequest, routeResponse) => {
			await handleChatRequest(routeRequest, routeResponse, {
				isSteerRoute: true,
			});
		},
		method: "POST",
		request,
		response,
	});
}
