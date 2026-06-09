import {
	createDesktopRealtimeClientSecret,
	DesktopRealtimeClientSecretError,
} from "./desktop-realtime-client-secret.mjs";
import {
	proxyHostedAiRequest,
	shouldProxyHostedAiRequest,
} from "./local-server-hosted-proxy.mjs";
import { readJsonBody, sendJson } from "./local-server-http.mjs";

export const handleRealtimeTranscriptionSessionRequest = async (
	request,
	response,
) => {
	if (shouldProxyHostedAiRequest()) {
		const { lang, source, speaker } = await readJsonBody(request);
		await proxyHostedAiRequest({
			path: "/api/realtime-transcription-session",
			request,
			response,
			bodyOverride: JSON.stringify({ lang, source, speaker }),
			headersOverride: {
				"content-type": "application/json",
				"content-length": null,
			},
		});
		return;
	}

	const { lang, source, speaker } = await readJsonBody(request);
	try {
		const clientSecret = await createDesktopRealtimeClientSecret({
			fetchImpl: fetch,
			getHostedConvexSiteUrl: () => process.env.CONVEX_SITE_URL?.trim(),
			getOpenAIApiKey: () => process.env.OPENAI_API_KEY,
			lang,
			logContext: "desktop.local_server.realtime.client_secret",
			source,
			speaker,
		});

		sendJson(response, 200, {
			clientSecret,
		});
	} catch (error) {
		sendJson(
			response,
			error instanceof DesktopRealtimeClientSecretError
				? error.statusCode
				: 500,
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to create realtime transcription session.",
			},
		);
	}
};
