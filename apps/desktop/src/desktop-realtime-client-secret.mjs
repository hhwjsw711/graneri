import { randomUUID } from "node:crypto";
import {
	createDesktopRealtimeTranscriptionSession,
	normalizeTranscriptionLanguage,
} from "../../../packages/ai/src/transcription.mjs";
import { logInfo } from "./logger.mjs";

export class DesktopRealtimeClientSecretError extends Error {
	constructor(message, { statusCode = 500 } = {}) {
		super(message);
		this.name = "DesktopRealtimeClientSecretError";
		this.statusCode = statusCode;
	}
}

const logOpenAiResponseMetadata = ({ context, requestId, response }) => {
	const openAiRequestId = response.headers.get("x-request-id");
	const processingMs = response.headers.get("openai-processing-ms");

	logInfo({
		message: "[openai]",
		details: {
			context,
			openAiRequestId,
			processingMs,
			requestId,
			status: response.status,
		},
	});
};

const createSessionConfig = ({ lang, source, speaker }) => {
	const language = normalizeTranscriptionLanguage(lang);
	return createDesktopRealtimeTranscriptionSession({
		language,
		source,
		speaker,
	});
};

export const createDesktopRealtimeClientSecret = async ({
	fetchImpl,
	getHostedConvexSiteUrl,
	getOpenAIApiKey,
	lang,
	logContext = "desktop.realtime.client_secret",
	source,
	speaker,
}) => {
	const openAIApiKey = getOpenAIApiKey();
	if (!openAIApiKey) {
		const baseUrl = getHostedConvexSiteUrl();

		if (!baseUrl) {
			throw new Error("CONVEX_SITE_URL is not configured.");
		}

		const response = await fetchImpl(
			new URL("/api/realtime-transcription-session", baseUrl),
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					lang,
					source,
					speaker,
				}),
			},
		);
		const payload = await response.json().catch(() => ({}));

		if (!response.ok) {
			throw new DesktopRealtimeClientSecretError(
				payload?.error?.message ||
					payload?.error ||
					"Failed to create realtime transcription session.",
				{ statusCode: response.status },
			);
		}

		const clientSecret = payload?.clientSecret;

		if (!clientSecret || typeof clientSecret !== "string") {
			throw new DesktopRealtimeClientSecretError(
				"OpenAI did not return a realtime client secret.",
			);
		}

		return clientSecret;
	}

	const requestId = randomUUID();
	const response = await fetchImpl(
		"https://api.openai.com/v1/realtime/client_secrets",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${openAIApiKey}`,
				"Content-Type": "application/json",
				"X-Client-Request-Id": requestId,
			},
			body: JSON.stringify({
				expires_after: {
					anchor: "created_at",
					seconds: 600,
				},
				session: createSessionConfig({
					lang,
					source,
					speaker,
				}),
			}),
		},
	);

	logOpenAiResponseMetadata({
		context: logContext,
		requestId,
		response,
	});

	const payload = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new DesktopRealtimeClientSecretError(
			payload?.error?.message ||
				"Failed to create realtime transcription session.",
			{ statusCode: response.status },
		);
	}

	const clientSecret = payload?.value;

	if (!clientSecret) {
		throw new DesktopRealtimeClientSecretError(
			"OpenAI did not return a realtime client secret.",
		);
	}

	return clientSecret;
};
