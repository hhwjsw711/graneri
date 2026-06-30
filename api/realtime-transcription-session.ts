import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRealtimeTranscriptionSessionRequest } from "../apps/web/server/realtime-transcription-session-handler.js";
import { handleHostedApiRoute } from "./_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleRealtimeTranscriptionSessionRequest,
		method: "POST",
		request,
		response,
	});
}
