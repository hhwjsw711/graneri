import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { handleApplyTemplateRequest } from "./apply-template-handler";
import { handleChatRequest, handleChatStopRequest } from "./chat-handler";
import { handleEnhanceNoteRequest } from "./enhance-note-handler";
import { handleRealtimeTranscriptionSessionRequest } from "./realtime-transcription-session-handler";

const isChatRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/chat");
const isChatStopRoute = (url: string | undefined) =>
	Boolean(url && url.split("?")[0] === "/api/chat/stop");
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
			!isEnhanceNoteRoute(request.url) &&
			!isApplyTemplateRoute(request.url) &&
			!isRealtimeTranscriptionSessionRoute(request.url)
		) {
			next();
			return;
		}

		if (request.method !== "POST") {
			response.statusCode = 405;
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ error: "Method not allowed." }));
			return;
		}

		const handler = isChatRoute(request.url)
			? handleChatRequest
			: isChatStopRoute(request.url)
				? handleChatStopRequest
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

export const openGranChatPlugin = (): Plugin => {
	const middleware = createChatMiddleware();

	return {
		name: "opengran-chat-api",
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		},
	};
};
