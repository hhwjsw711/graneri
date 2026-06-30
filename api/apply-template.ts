import type { IncomingMessage, ServerResponse } from "node:http";
import { type HostedApiHandler, handleHostedApiRoute } from "./_hosted-route";

type ApplyTemplateModule = {
	handleApplyTemplateRequest: HostedApiHandler;
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
			const route = await importEsm<ApplyTemplateModule>(
				"../apps/web/server/apply-template-handler.js",
			);

			await route.handleApplyTemplateRequest(routeRequest, routeResponse);
		},
		method: "POST",
		request,
		response,
	});
}
