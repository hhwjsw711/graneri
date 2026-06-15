import type { IncomingMessage, ServerResponse } from "node:http";
import { openai } from "@ai-sdk/openai";
import { smoothStream, streamText } from "ai";
import { NOTE_GENERATION_MODEL_ID } from "../../../packages/ai/src/models.mjs";
import {
	APPLY_TEMPLATE_SYSTEM_PROMPT,
	buildApplyTemplatePrompt,
} from "../../../packages/ai/src/prompts.mjs";
import {
	parseTemplateStreamToStructuredNote,
	validateTemplateStream,
} from "../src/lib/note-template-stream";
import {
	createServerWideEvent,
	emitServerWideEvent,
	recordServerError,
} from "./server-logger";

type ApplyTemplateRequestBody = {
	title?: string;
	noteText?: string;
	template?: {
		slug?: string;
		name?: string;
		meetingContext?: string;
		sections?: Array<{
			id?: string;
			title?: string;
			prompt?: string;
		}>;
	};
};

class ApplyTemplateRequestError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);
		this.statusCode = statusCode;
	}
}

const readJsonBody = async (request: IncomingMessage) => {
	const chunks: Uint8Array[] = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}

	const rawBody = Buffer.concat(chunks).toString("utf8");

	if (!rawBody) {
		return {};
	}

	return JSON.parse(rawBody) as ApplyTemplateRequestBody;
};

const sendJson = (
	response: ServerResponse,
	statusCode: number,
	payload: Record<string, unknown>,
) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(payload));
};

const getApplyTemplatePayload = async (request: IncomingMessage) => {
	const { title = "", noteText = "", template } = await readJsonBody(request);

	if (!noteText.trim()) {
		throw new ApplyTemplateRequestError("Note text is required.", 400);
	}

	if (!template?.name || !template.sections || template.sections.length === 0) {
		throw new ApplyTemplateRequestError("A valid template is required.", 400);
	}

	const templateSections = template.sections.flatMap((section) => {
		const title = section.title?.trim() ?? "";
		return title
			? [
					{
						title,
						prompt: section.prompt?.trim() ?? "",
					},
				]
			: [];
	});

	if (templateSections.length === 0) {
		throw new ApplyTemplateRequestError(
			"The selected template does not have usable sections.",
			400,
		);
	}

	return { noteText, template, templateSections, title };
};

export const handleApplyTemplateRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "apply_template.request",
		request,
	});
	let wideEventEmitted = false;
	const emitWideEvent = (level: "error" | "info") => {
		if (wideEventEmitted) {
			return;
		}

		wideEventEmitted = true;
		emitServerWideEvent({ event: wideEvent, level, startedAt });
	};

	if (!process.env.OPENAI_API_KEY) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "openai_api_key_missing";
		emitWideEvent("error");
		sendJson(response, 500, {
			error: "OPENAI_API_KEY is not configured.",
		});
		return;
	}

	let payload: Awaited<ReturnType<typeof getApplyTemplatePayload>>;
	try {
		payload = await getApplyTemplatePayload(request);
	} catch (error) {
		if (error instanceof ApplyTemplateRequestError) {
			wideEvent.outcome = "error";
			wideEvent.status_code = error.statusCode;
			wideEvent.error_code = "invalid_request";
			emitWideEvent("error");
			sendJson(response, error.statusCode, {
				error: error.message,
			});
			return;
		}

		recordServerError({
			error,
			event: wideEvent,
			operation: "request_parse",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "request_parse_failed";
		emitWideEvent("error");
		throw error;
	}

	const { title, noteText, template, templateSections } = payload;
	wideEvent.template_slug = template.slug ?? null;
	wideEvent.template_name = template.name ?? null;
	wideEvent.template_section_count = templateSections.length;
	wideEvent.note_text_length = noteText.length;
	wideEvent.has_title = Boolean(title.trim());

	response.statusCode = 200;
	response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
	response.setHeader("Cache-Control", "no-cache, no-transform");
	response.flushHeaders?.();

	const result = streamText({
		model: openai(NOTE_GENERATION_MODEL_ID),
		system: APPLY_TEMPLATE_SYSTEM_PROMPT,
		prompt: buildApplyTemplatePrompt({
			title,
			templateName: template.name,
			meetingContext: template.meetingContext,
			templateSections,
			noteText,
		}),
		experimental_transform: smoothStream({
			chunking: "line",
		}),
	});

	const writeEvent = (payload: Record<string, unknown>) => {
		response.write(`${JSON.stringify(payload)}\n`);
	};

	try {
		let streamedText = "";

		for await (const delta of result.textStream) {
			streamedText += delta;
			writeEvent({
				type: "text-delta",
				delta,
			});
		}

		const parsed = parseTemplateStreamToStructuredNote({
			text: streamedText,
			template: {
				sections: templateSections,
			},
			isFinal: true,
		});
		const validationError = validateTemplateStream({
			template: {
				sections: templateSections,
			},
			parsed,
		});

		if (validationError) {
			wideEvent.outcome = "error";
			wideEvent.status_code = 422;
			wideEvent.error_code = "template_stream_validation_failed";
			emitWideEvent("error");
			writeEvent({
				type: "error",
				error: validationError,
			});
			response.end();
			return;
		}

		writeEvent({
			type: "final-note",
			note: parsed.note,
		});
		wideEvent.outcome = "success";
		wideEvent.status_code = 200;
		emitWideEvent("info");
		response.end();
	} catch (error) {
		recordServerError({
			error,
			event: wideEvent,
			operation: "template_stream",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "template_stream_failed";
		emitWideEvent("error");
		const message =
			error instanceof Error
				? error.message
				: "Failed to apply note template rewrite.";
		writeEvent({
			type: "error",
			error: message,
		});
		response.end();
	}
};
