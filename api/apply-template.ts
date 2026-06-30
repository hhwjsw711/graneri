import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApplyTemplateRequest } from "../apps/web/server/apply-template-handler.js";
import { handleHostedApiRoute } from "./_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleApplyTemplateRequest,
		method: "POST",
		request,
		response,
	});
}
