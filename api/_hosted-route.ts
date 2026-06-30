import type { IncomingMessage, ServerResponse } from "node:http";
import { getHostedChatConvexRouteError } from "../packages/ai/src/hosted-chat-runtime.mjs";

export type HostedApiHandler = (
	request: IncomingMessage,
	response: ServerResponse,
) => Promise<void>;

export const handleHostedApiRoute = async ({
	handler,
	method,
	request,
	response,
}: {
	handler: HostedApiHandler;
	method: "GET" | "POST";
	request: IncomingMessage;
	response: ServerResponse;
}) => {
	if (request.method !== method) {
		response.statusCode = 405;
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ error: "Method not allowed." }));
		return;
	}

	try {
		await handler(request, response);
	} catch (error) {
		const routeError = getHostedChatConvexRouteError(error);
		if (routeError) {
			response.statusCode = routeError.statusCode;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					error: routeError.error,
					errorCode: routeError.errorCode,
				}),
			);
			return;
		}

		const message =
			error instanceof Error ? error.message : "Unexpected server error.";
		response.statusCode = 500;
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ error: message }));
	}
};
