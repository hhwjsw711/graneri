import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type HostedApiHandler,
	handleHostedApiRoute,
} from "../../_hosted-route";

type ChatReconnectModule = {
	handleChatReconnectRequest: HostedApiHandler;
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
			const route = await importEsm<ChatReconnectModule>(
				"../../../apps/web/server/chat-handler.js",
			);

			await route.handleChatReconnectRequest(routeRequest, routeResponse);
		},
		method: "GET",
		request,
		response,
	});
}
