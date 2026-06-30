import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	createRealtimeTranscriptionSession,
	createRealtimeTranscriptionSessionOptions,
	normalizeTranscriptionLanguage,
} from "../../../packages/ai/src/transcription.mjs";
import { createServerWideEvent, emitServerWideEvent } from "./server-logger.js";

const sendJson = (
	response: ServerResponse,
	statusCode: number,
	payload: Record<string, string | number | null>,
) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(payload));
};

const readJsonBody = async (request: IncomingMessage) => {
	const chunks: Uint8Array[] = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}

	const rawBody = Buffer.concat(chunks).toString("utf8");

	if (!rawBody) {
		return {};
	}

	return JSON.parse(rawBody) as {
		lang?: string;
		speaker?: string;
		source?: string;
	};
};

const trim = (value: unknown) =>
	typeof value === "string" ? value.trim() : undefined;

export const handleRealtimeTranscriptionSessionRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "realtime_transcription_session.request",
		request,
	});

	if (!process.env.OPENAI_API_KEY) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "openai_api_key_missing";
		emitServerWideEvent({ event: wideEvent, level: "error", startedAt });
		sendJson(response, 500, {
			error: "OPENAI_API_KEY is not configured.",
		});
		return;
	}

	const { lang, source, speaker: rawSpeaker } = await readJsonBody(request);
	const language = normalizeTranscriptionLanguage(lang);
	const requestId = randomUUID();
	const speaker = trim(rawSpeaker);
	const normalizedSource = trim(source);
	wideEvent.request_id = requestId;
	wideEvent.language = language;
	wideEvent.has_speaker = Boolean(speaker);
	wideEvent.source = normalizedSource ?? null;

	const sessionResponse = await fetch(
		"https://api.openai.com/v1/realtime/client_secrets",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
				"X-Client-Request-Id": requestId,
			},
			body: JSON.stringify({
				expires_after: {
					anchor: "created_at",
					seconds: 600,
				},
				session: createRealtimeTranscriptionSession(
					createRealtimeTranscriptionSessionOptions({
						language,
						source: normalizedSource,
						speaker,
					}),
				),
			}),
		},
	);

	wideEvent.openai_request_id = sessionResponse.headers.get("x-request-id");
	wideEvent.openai_processing_ms = sessionResponse.headers.get(
		"openai-processing-ms",
	);
	wideEvent.openai_status_code = sessionResponse.status;

	const payload = (await sessionResponse.json().catch(() => ({}))) as {
		error?: {
			message?: string;
		};
		value?: string;
	};

	if (!sessionResponse.ok) {
		wideEvent.outcome = "error";
		wideEvent.status_code = sessionResponse.status;
		wideEvent.error_message =
			payload.error?.message ||
			"Failed to create realtime transcription session.";
		emitServerWideEvent({ event: wideEvent, level: "error", startedAt });
		sendJson(response, sessionResponse.status, {
			error:
				payload.error?.message ||
				"Failed to create realtime transcription session.",
		});
		return;
	}

	const clientSecret = payload.value;

	if (!clientSecret) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "client_secret_missing";
		emitServerWideEvent({ event: wideEvent, level: "error", startedAt });
		sendJson(response, 500, {
			error: "OpenAI did not return a client secret.",
		});
		return;
	}

	wideEvent.outcome = "success";
	wideEvent.status_code = 200;
	emitServerWideEvent({ event: wideEvent, startedAt });
	sendJson(response, 200, {
		clientSecret,
	});
};
