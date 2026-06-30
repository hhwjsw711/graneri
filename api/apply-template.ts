import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApplyTemplateRequest } from "../apps/web/server/apply-template-handler";
import { handleHostedApiRoute } from "./_hosted-route";

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
