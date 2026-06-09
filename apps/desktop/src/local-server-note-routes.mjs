import { openai } from "@ai-sdk/openai";
import { generateText, Output, smoothStream, streamText } from "ai";
import { z } from "zod";
import { NOTE_GENERATION_MODEL_ID } from "../../../packages/ai/src/models.mjs";
import {
	parseTemplateStreamToStructuredNote,
	validateTemplateStream,
} from "../../../packages/ai/src/note-template-stream.mjs";
import {
	APPLY_TEMPLATE_SYSTEM_PROMPT,
	buildApplyTemplatePrompt,
	buildEnhancedNotePrompt,
	ENHANCED_NOTE_SYSTEM_PROMPT,
} from "../../../packages/ai/src/prompts.mjs";
import {
	proxyHostedAiRequest,
	shouldProxyHostedAiRequest,
} from "./local-server-hosted-proxy.mjs";
import { readJsonBody, sendJson } from "./local-server-http.mjs";

const structuredNoteSchema = z.object({
	title: z.string().min(1),
	overview: z.array(z.string()),
	sections: z
		.array(
			z.object({
				title: z.string().min(1),
				items: z.array(z.string()).min(1),
			}),
		)
		.min(1),
});

const createTemplateSections = (template) =>
	(template?.sections ?? [])
		.map((section) => ({
			title: section?.title?.trim() ?? "",
			prompt: section?.prompt?.trim() ?? "",
		}))
		.filter((section) => section.title);

export const handleEnhanceNoteRequest = async (request, response) => {
	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: "/api/enhance-note",
			request,
			response,
			responseMode: "bufferedJson",
		});
		return;
	}

	const {
		title = "",
		rawNotes = "",
		transcript = "",
		noteText = "",
	} = await readJsonBody(request);

	const trimmedTranscript = transcript.trim();
	const trimmedNoteText = noteText.trim();

	if (!trimmedTranscript && !trimmedNoteText) {
		sendJson(response, 400, {
			error: "Transcript or note text is required.",
		});
		return;
	}

	const { output } = await generateText({
		model: openai(NOTE_GENERATION_MODEL_ID),
		system: ENHANCED_NOTE_SYSTEM_PROMPT,
		output: Output.object({
			schema: structuredNoteSchema,
		}),
		prompt: buildEnhancedNotePrompt({
			title,
			rawNotes,
			transcript: trimmedTranscript,
			noteText: trimmedNoteText,
		}),
	});

	sendJson(response, 200, {
		note: output,
	});
};

export const handleApplyTemplateRequest = async (request, response) => {
	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: "/api/apply-template",
			request,
			response,
		});
		return;
	}

	if (!process.env.OPENAI_API_KEY) {
		sendJson(response, 500, {
			error: "OPENAI_API_KEY is not configured.",
		});
		return;
	}

	const { title = "", noteText = "", template } = await readJsonBody(request);

	if (!noteText.trim()) {
		sendJson(response, 400, {
			error: "Note text is required.",
		});
		return;
	}

	if (!template?.name || !Array.isArray(template.sections)) {
		sendJson(response, 400, {
			error: "A valid template is required.",
		});
		return;
	}

	const templateSections = createTemplateSections(template);

	if (templateSections.length === 0) {
		sendJson(response, 400, {
			error: "The selected template does not have usable sections.",
		});
		return;
	}

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

	const writeEvent = (payload) => {
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
		response.end();
	} catch (error) {
		writeEvent({
			type: "error",
			error:
				error instanceof Error
					? error.message
					: "Failed to apply note template rewrite.",
		});
		response.end();
	}
};
