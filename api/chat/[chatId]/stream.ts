import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatReconnectRequest } from "../../../apps/web/server/chat-handler.js";
import { handleHostedApiRoute } from "../../_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleChatReconnectRequest,
		method: "GET",
		request,
		response,
	});
}
