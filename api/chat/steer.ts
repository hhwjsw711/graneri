import type { IncomingMessage, ServerResponse } from "node:http";
import { handleHostedApiRoute } from "../_hosted-route";

type ChatSteerModule = {
	handleChatRequest: (
		request: IncomingMessage,
		response: ServerResponse,
		options: { isSteerRoute: true },
	) => Promise<void>;
};

const importEsm = new Function("specifier", "return import(specifier)") as <T>(
	specifier: string,
) => Promise<T>;

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: async (routeRequest, routeResponse) => {
			const route = await importEsm<ChatSteerModule>(
				"../../apps/web/server/chat-handler.js",
			);

			await route.handleChatRequest(routeRequest, routeResponse, {
				isSteerRoute: true,
			});
		},
		method: "POST",
		request,
		response,
	});
}
