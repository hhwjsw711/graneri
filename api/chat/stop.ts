import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatStopRequest } from "../../apps/web/server/chat-handler";
import { handleHostedApiRoute } from "../_hosted-route";

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
