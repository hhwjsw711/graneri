import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatRequest } from "../../apps/web/server/chat-handler.js";
import { handleHostedApiRoute } from "../_hosted-route.js";

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
