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

const isChatRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/chat");
const isChatStopRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/chat/stop");
const isChatReconnectRoute = (url: string | undefined) =>
	Boolean(url && /^\/api\/chat\/[^/]+\/stream$/.test(url.split("?")[0] ?? ""));
const isEnhanceNoteRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/enhance-note");
const isApplyTemplateRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/apply-template");
const isRealtimeTranscriptionSessionRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/realtime-transcription-session");

const createChatMiddleware = (): Connect.NextHandleFunction => {
	return (request, response, next) => {
		if (
			!isChatRoute(request.url) &&
			!isChatStopRoute(request.url) &&
			!isChatReconnectRoute(request.url) &&
			!isEnhanceNoteRoute(request.url) &&
			!isApplyTemplateRoute(request.url) &&
			!isRealtimeTranscriptionSessionRoute(request.url)
		) {
			next();
			return;
		}

		if (isChatReconnectRoute(request.url) && request.method !== "GET") {
			response.statusCode = 405;
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ error: "Method not allowed." }));
			return;
		}

		if (!isChatReconnectRoute(request.url) && request.method !== "POST") {
			response.statusCode = 405;
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ error: "Method not allowed." }));
			return;
		}

		const handler = isChatRoute(request.url)
			? handleChatRequest
			: isChatStopRoute(request.url)
				? handleChatStopRequest
				: isChatReconnectRoute(request.url)
					? handleChatReconnectRequest
					: isEnhanceNoteRoute(request.url)
						? handleEnhanceNoteRequest
						: isApplyTemplateRoute(request.url)
							? handleApplyTemplateRequest
							: handleRealtimeTranscriptionSessionRequest;

		void handler(request as IncomingMessage, response as ServerResponse).catch(
			(error: unknown) => {
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				response.statusCode = 500;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ error: message }));
			},
		);
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
