import type { NoteTemplate } from "@/lib/note-templates";
import type { StructuredNote, StructuredNoteBody } from "@/lib/structured-note";

type NoteTemplateFetch = typeof fetch;

export type EnhancedStructuredNoteRequest = {
	title: string;
	rawNotes?: string;
	transcript?: string;
	noteText?: string;
};

export const requestEnhancedStructuredNote = async (
	body: EnhancedStructuredNoteRequest,
	{ fetcher = fetch }: { fetcher?: NoteTemplateFetch } = {},
) => {
	const response = await fetcher("/api/enhance-note", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const payload = (await response.json().catch(() => ({}))) as {
		error?: string;
		note?: StructuredNote;
	};

	if (!response.ok || !payload.note) {
		throw new Error(payload.error || "Failed to enhance note.");
	}

	return payload.note;
};

type TemplateRewriteEvent =
	| {
			type: "text-delta";
			delta?: string;
	  }
	| {
			type: "final-note";
			note?: StructuredNoteBody;
	  }
	| {
			type: "error";
			error?: string;
	  };

export const requestTemplateStructuredNote = async ({
	title,
	noteText,
	template,
	onMarkdown,
	fetcher = fetch,
}: {
	title: string;
	noteText: string;
	template: NoteTemplate;
	onMarkdown: (markdown: string) => void;
	fetcher?: NoteTemplateFetch;
}) => {
	const response = await fetcher("/api/apply-template", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/x-ndjson",
		},
		body: JSON.stringify({
			title,
			noteText,
			template,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(errorText || "Failed to apply template.");
	}

	const stream = response.body;
	if (!stream) {
		throw new Error("Template rewrite stream is not available.");
	}

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let finalNote: StructuredNoteBody | null = null;
	let responseError: string | null = null;
	let bufferedResponse = "";
	let streamedText = "";

	const handleEvent = (rawLine: string) => {
		const line = rawLine.trim();
		if (!line) {
			return;
		}

		const payload = JSON.parse(line) as TemplateRewriteEvent;

		if (payload.type === "text-delta") {
			streamedText += payload.delta ?? "";
			onMarkdown(streamedText);
			return;
		}

		if (payload.type === "final-note") {
			finalNote = payload.note ?? null;
			return;
		}

		responseError = payload.error ?? "Failed to apply template.";
	};

	let isDone = false;
	while (!isDone) {
		const { done, value } = await reader.read();
		isDone = done;
		bufferedResponse += decoder.decode(value ?? new Uint8Array(), {
			stream: !done,
		});

		const lines = bufferedResponse.split("\n");
		bufferedResponse = lines.pop() ?? "";
		for (const nextLine of lines) {
			handleEvent(nextLine);
		}
	}

	if (bufferedResponse.trim()) {
		handleEvent(bufferedResponse);
	}

	if (responseError) {
		throw new Error(responseError);
	}

	if (!finalNote) {
		throw new Error(
			"Template rewrite finished without a validated structured note.",
		);
	}

	return finalNote;
};
