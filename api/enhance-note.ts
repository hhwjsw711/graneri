import type { IncomingMessage, ServerResponse } from "node:http";
import { handleEnhanceNoteRequest } from "../apps/web/server/enhance-note-handler";
import { handleHostedApiRoute } from "./_hosted-route";

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
