import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { handleApplyTemplateRequest } from "./apply-template-handler";
import {
	handleChatReconnectRequest,
	handleChatRequest,
	handleChatStopRequest,
} from "./chat-handler";
import { handleEnhanceNoteRequest } from "./enhance-note-handler";
import { handleRealtimeTranscriptionSessionRequest } from "./realtime-transcription-session-handler";

type ChatApiHandler = (
	request: IncomingMessage,
	response: ServerResponse,
) => Promise<void>;
type ChatApiRoute = {
	method: "GET" | "POST";
	matches: (pathname: string) => boolean;
	handler: ChatApiHandler;
};

const chatApiRoutes: Array<ChatApiRoute> = [
	{
		method: "POST",
		matches: (pathname) => pathname === "/api/chat",
		handler: handleChatRequest,
	},
	{
		method: "POST",
		matches: (pathname) => pathname === "/api/chat/steer",
		handler: (request, response) =>
			handleChatRequest(request, response, { isSteerRoute: true }),
	},
	{
		method: "POST",
		matches: (pathname) => pathname === "/api/chat/stop",
		handler: handleChatStopRequest,
	},
	{
		method: "GET",
		matches: (pathname) => /^\/api\/chat\/[^/]+\/stream$/.test(pathname),
		handler: handleChatReconnectRequest,
	},
	{
		method: "POST",
		matches: (pathname) => pathname === "/api/enhance-note",
		handler: handleEnhanceNoteRequest,
	},
	{
		method: "POST",
		matches: (pathname) => pathname === "/api/apply-template",
		handler: handleApplyTemplateRequest,
	},
	{
		method: "POST",
		matches: (pathname) => pathname === "/api/realtime-transcription-session",
		handler: handleRealtimeTranscriptionSessionRequest,
	},
];

const getRequestPathname = (url: string | undefined) =>
	url?.split("?")[0] ?? "";

const createChatMiddleware = (): Connect.NextHandleFunction => {
	return (request, response, next) => {
		const pathname = getRequestPathname(request.url);
		const route = chatApiRoutes.find((candidate) =>
			candidate.matches(pathname),
		);
		if (!route) {
			next();
			return;
		}

		if (request.method !== route.method) {
			response.statusCode = 405;
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ error: "Method not allowed." }));
			return;
		}

		void route
			.handler(request as IncomingMessage, response as ServerResponse)
			.catch((error: unknown) => {
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				response.statusCode = 500;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ error: message }));
			});
	};
};

export const graneriChatPlugin = (): Plugin => {
	const middleware = createChatMiddleware();

	return {
		name: "graneri-chat-api",
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		},
	};
};
