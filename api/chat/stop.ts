import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatStopRequest } from "../../apps/web/server/chat-handler.js";
import { handleHostedApiRoute } from "../_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleChatStopRequest,
		method: "POST",
		request,
		response,
	});
}
