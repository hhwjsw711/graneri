import type { IncomingMessage, ServerResponse } from "node:http";
import { type HostedApiHandler, handleHostedApiRoute } from "./_hosted-route";

type EnhanceNoteModule = {
	handleEnhanceNoteRequest: HostedApiHandler;
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
			const route = await importEsm<EnhanceNoteModule>(
				"../apps/web/server/enhance-note-handler.js",
			);

			await route.handleEnhanceNoteRequest(routeRequest, routeResponse);
		},
		method: "POST",
		request,
		response,
	});
}
