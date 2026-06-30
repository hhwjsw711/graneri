import type { IncomingMessage, ServerResponse } from "node:http";
import { handleEnhanceNoteRequest } from "../apps/web/server/enhance-note-handler.js";
import { handleHostedApiRoute } from "./_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleEnhanceNoteRequest,
		method: "POST",
		request,
		response,
	});
}
