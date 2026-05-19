import { openai } from "@ai-sdk/openai";
import {
	consumeStream,
	convertToModelMessages,
	createIdGenerator,
	generateText,
	Output,
	smoothStream,
	stepCountIs,
	streamText,
	type UIMessage,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import {
	buildChatTitlePrompt,
	deriveFallbackChatTitle,
	finalizeGeneratedChatTitle,
} from "../packages/ai/src/chat-titles.mjs";
import {
	buildImageGenerationInstruction,
	createConvexGeneratedImageUploader,
	createImageGenerationTool,
} from "../packages/ai/src/image-generation-tool.mjs";
import { extractTextFromUIMessage } from "../packages/ai/src/local-path-references.mjs";
import {
	CHAT_SERVER_MODELS,
	CHAT_TITLE_MODEL_ID,
	getChatModelProviderOptions,
	NOTE_GENERATION_MODEL_ID,
	normalizeReasoningEffort,
} from "../packages/ai/src/models.mjs";
import { buildWorkspaceToolSet } from "../packages/ai/src/workspace-tool-registry.mjs";
import {
	parseTemplateStreamToStructuredNote,
	validateTemplateStream,
} from "../packages/ai/src/note-template-stream.mjs";
import {
	APPLY_TEMPLATE_SYSTEM_PROMPT,
	buildApplyTemplatePrompt,
	buildChatSystemPrompt,
	buildEnhancedNotePrompt,
	CHAT_TITLE_SYSTEM_PROMPT,
	ENHANCED_NOTE_SYSTEM_PROMPT,
} from "../packages/ai/src/prompts.mjs";
import {
	createDesktopRealtimeTranscriptionSession,
	normalizeTranscriptionLanguage,
} from "../packages/ai/src/transcription.mjs";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type ChatRequestBody = {
	id?: string;
	workspaceId?: string | null;
	message?: UIMessage;
	messages?: UIMessage[];
	model?: string;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	webSearchEnabled?: boolean;
	appsEnabled?: boolean;
	mentions?: string[];
	selectedSourceIds?: string[];
	convexToken?: string | null;
	recipeSlug?: string | null;
	noteContext?: {
		noteId?: string | null;
		title?: string;
		text?: string;
	};
};

type EnhanceNoteRequestBody = {
	title?: string;
	rawNotes?: string;
	transcript?: string;
	noteText?: string;
};

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

const MAX_CHAT_PREVIEW_LENGTH = 180;
const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_NOTE_CONTEXT_LENGTH = 16_000;
const APP_SOURCE_PREFIX = "app:";
const WORKSPACE_SOURCE_PREFIX = "workspace:";
const chatModels = CHAT_SERVER_MODELS;
const fallbackChatModel = chatModels[0];
const generateMessageId = createIdGenerator({
	prefix: "msg",
	size: 16,
});
const shouldEnableImageGeneration = (message: UIMessage | undefined) =>
	Boolean(
		message &&
			/\b(create|draw|generate|make|render)\b[\s\S]{0,80}\b(image|picture|photo|illustration|art|graphic|logo|avatar)\b/iu.test(
				extractTextFromUIMessage(message),
			),
	);
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

const jsonResponse = (status: number, payload: Record<string, unknown>) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});

const trim = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";

const deriveConvexUrlFromSiteUrl = (siteUrl: string) => {
	const url = new URL(siteUrl);

	if (!url.hostname.endsWith(".convex.site")) {
		throw new Error("Convex site URL is invalid.");
	}

	url.hostname = url.hostname.replace(/\.convex\.site$/u, ".convex.cloud");
	url.pathname = "/";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/u, "");
};

const getConvexUrlForRequest = (request: Request) =>
	deriveConvexUrlFromSiteUrl(new URL(request.url).origin);

const getConvexClient = (
	request: Request,
	convexToken: string | null | undefined,
) =>
	convexToken
		? new ConvexHttpClient(getConvexUrlForRequest(request), {
				auth: convexToken,
			})
		: null;

const getReferencedNoteIds = ({
	mentions,
	selectedSourceIds,
}: Pick<ChatRequestBody, "mentions" | "selectedSourceIds">): Id<"notes">[] =>
	[
		...(mentions ?? []),
		...((selectedSourceIds ?? []).filter(
			(value) =>
				!value.startsWith(APP_SOURCE_PREFIX) &&
				!value.startsWith(WORKSPACE_SOURCE_PREFIX),
		) as string[]),
	]
		.filter(
			(value, index, values): value is string =>
				Boolean(value) && values.indexOf(value) === index,
		)
		.map((value) => value as Id<"notes">);

const getSelectedAppSourceIds = (selectedSourceIds: string[] | undefined) =>
	(selectedSourceIds ?? []).filter((value) =>
		value.startsWith(APP_SOURCE_PREFIX),
	);

const hasWorkspaceSourceSelected = ({
	selectedSourceIds,
}: Pick<ChatRequestBody, "selectedSourceIds">) =>
	(selectedSourceIds ?? []).some((value) =>
		value.startsWith(WORKSPACE_SOURCE_PREFIX),
	);

const clampWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const clampNoteContext = (value: string) =>
	value.replace(/\r/g, "").trim().slice(0, MAX_NOTE_CONTEXT_LENGTH);

const getMessageText = (message: UIMessage) =>
	clampWhitespace(
		message.parts
			.filter(
				(
					part,
				): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
					part.type === "text" &&
					typeof part.text === "string" &&
					part.text.length > 0,
			)
			.map((part) => part.text)
			.join("\n\n"),
	);

const generateChatTitle = async ({
	userMessage,
	assistantMessage,
}: {
	userMessage: UIMessage;
	assistantMessage?: UIMessage;
}) => {
	const userText = getMessageText(userMessage);
	const assistantText = assistantMessage
		? getMessageText(assistantMessage)
		: "";

	if (!userText) {
		return "Quick chat";
	}

	try {
		const { text } = await generateText({
			model: openai(CHAT_TITLE_MODEL_ID),
			system: CHAT_TITLE_SYSTEM_PROMPT,
			prompt: buildChatTitlePrompt({
				userText,
				assistantText,
			}),
		});

		return finalizeGeneratedChatTitle({
			generatedTitle: text,
			userText,
			maxLength: MAX_CHAT_TITLE_LENGTH,
		});
	} catch (error) {
		console.error("Failed to generate chat title", error);
		return deriveFallbackChatTitle({
			userText,
			maxLength: MAX_CHAT_TITLE_LENGTH,
		});
	}
};

const getChatPreviewFromMessage = (message: UIMessage) =>
	truncate(getMessageText(message), MAX_CHAT_PREVIEW_LENGTH);

const toStoredMessage = (message: UIMessage) => ({
	id: message.id || generateMessageId(),
	role: message.role,
	partsJson: JSON.stringify(message.parts),
	metadataJson:
		message.metadata === undefined
			? undefined
			: JSON.stringify(message.metadata),
	text: getMessageText(message),
	createdAt: Date.now(),
});

const fromStoredMessages = (
	messages: Array<{
		id: string;
		role: "system" | "user" | "assistant";
		partsJson: string;
		metadataJson?: string;
	}>,
): UIMessage[] =>
	messages.map((message) => ({
		id: message.id,
		role: message.role,
		metadata: message.metadataJson
			? (JSON.parse(message.metadataJson) as UIMessage["metadata"])
			: undefined,
		parts: JSON.parse(message.partsJson) as UIMessage["parts"],
	}));

const getNotesContext = async ({
	request,
	convexToken,
	mentions,
	selectedSourceIds,
	workspaceId,
}: Pick<
	ChatRequestBody,
	"convexToken" | "mentions" | "selectedSourceIds" | "workspaceId"
> & {
	request: Request;
}) => {
	if (!convexToken || !workspaceId) {
		return "";
	}

	const client = getConvexClient(request, convexToken);

	if (!client) {
		return "";
	}

	const noteIds = getReferencedNoteIds({ mentions, selectedSourceIds });
	const shouldUseWorkspaceScope =
		noteIds.length === 0 &&
		((selectedSourceIds ?? []).length === 0 ||
			hasWorkspaceSourceSelected({ selectedSourceIds }));
	const notes =
		noteIds.length > 0
			? await client.query(api.notes.getChatContext, {
					workspaceId: workspaceId as Id<"workspaces">,
					ids: noteIds,
				})
			: shouldUseWorkspaceScope
				? await client.query(api.notes.getWorkspaceChatContext, {
						workspaceId: workspaceId as Id<"workspaces">,
					})
				: [];

	if (notes.length === 0) {
		return "";
	}

	return [
		"Attached notes are available below. Use them when they are relevant to the user's request.",
		...notes.map((note, index) =>
			[
				`Note ${index + 1}: ${note.title}`,
				note.searchableText || "(empty note)",
			].join("\n"),
		),
	].join("\n\n");
};

const getInlineNoteContext = ({
	title,
	text,
}: {
	title?: string;
	text?: string;
}) => {
	const noteTitle = title?.trim() ?? "";
	const noteText = clampNoteContext(text ?? "");

	if (!noteTitle && !noteText) {
		return "";
	}

	return [
		"The current note is attached below. Use it as the primary context for this chat.",
		noteTitle ? `Current note title: ${noteTitle}` : "",
		noteText
			? `Current note content:\n${noteText}`
			: "Current note content: (empty note)",
	]
		.filter(Boolean)
		.join("\n\n");
};

const getStoredNoteContext = async ({
	request,
	convexToken,
	noteId,
	workspaceId,
}: {
	request: Request;
	convexToken: string;
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
}) => {
	const client = getConvexClient(request, convexToken);

	if (!client) {
		return "";
	}

	const notes = await client.query(api.notes.getChatContext, {
		workspaceId,
		ids: [noteId],
	});
	const note = notes[0];

	if (!note) {
		return "";
	}

	return [
		"The current note is attached below. Use it as the primary context for this chat.",
		`Current note title: ${note.title}`,
		note.searchableText
			? `Current note content:\n${clampNoteContext(note.searchableText)}`
			: "Current note content: (empty note)",
	].join("\n\n");
};

const getSelectedRecipe = async ({
	request,
	convexToken,
	recipeSlug,
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "recipeSlug" | "workspaceId"> & {
	request: Request;
}) => {
	if (!convexToken || !recipeSlug || !workspaceId) {
		return null;
	}

	const client = getConvexClient(request, convexToken);

	if (!client) {
		return null;
	}

	const recipes = await client.query(api.recipes.list, {
		workspaceId: workspaceId as Id<"workspaces">,
	});
	return recipes.find((recipe) => recipe.slug === recipeSlug) ?? null;
};

const getRecipeContext = (
	selectedRecipe:
		| {
				slug: string;
				name: string;
				prompt: string;
		  }
		| null
		| undefined,
) => {
	if (!selectedRecipe) {
		return "";
	}

	return [
		"A recipe is selected for this note chat.",
		"Treat the selected recipe as the active task framing for the conversation.",
		"Treat the attached note and any other provided note context as the source material to work from.",
		"If the user's request is ambiguous, interpret it through the selected recipe first.",
		"If the user explicitly asks for something else, follow the user's latest instruction instead.",
		"If there is not enough source material to complete the recipe well, ask a focused follow-up question.",
		`Selected recipe: ${selectedRecipe.name}`,
		`Recipe prompt:\n${selectedRecipe.prompt.trim()}`,
	].join("\n\n");
};

const resolveChatModel = (value?: string | null) =>
	chatModels.find((model) => model.id === value || model.model === value) ??
	fallbackChatModel;

const createTemplateSections = (
	template: ApplyTemplateRequestBody["template"],
) =>
	(template?.sections ?? [])
		.map((section) => ({
			title: section?.title?.trim() ?? "",
			prompt: section?.prompt?.trim() ?? "",
		}))
		.filter((section) => section.title);

const logOpenAiResponseMetadata = ({
	context,
	requestId,
	response,
}: {
	context: string;
	requestId: string;
	response: Response;
}) => {
	const openAiRequestId = response.headers.get("x-request-id");
	const processingMs = response.headers.get("openai-processing-ms");

	console.info("[openai]", {
		context,
		openAiRequestId,
		processingMs,
		requestId,
		status: response.status,
	});
};

export const handleChatRequest = async (request: Request) => {
	if (!process.env.OPENAI_API_KEY) {
		return jsonResponse(500, {
			error: "OPENAI_API_KEY is not configured.",
		});
	}

	const {
		id,
		message,
		messages = [],
		model,
		reasoningEffort,
		workspaceId,
		webSearchEnabled = false,
		appsEnabled = true,
		mentions,
		selectedSourceIds,
		convexToken,
		recipeSlug,
		noteContext,
	} = (await request.json().catch(() => ({}))) as ChatRequestBody;

	if (!Array.isArray(messages)) {
		return jsonResponse(400, {
			error: "Invalid chat payload.",
		});
	}

	const resolvedWorkspaceId =
		(workspaceId as Id<"workspaces"> | null | undefined) ?? null;
	if (convexToken && !resolvedWorkspaceId) {
		return jsonResponse(400, {
			error: "workspaceId is required.",
		});
	}

	const convexClient =
		convexToken && id && resolvedWorkspaceId
			? getConvexClient(request, convexToken)
			: null;
	const storedChat =
		convexClient && id && resolvedWorkspaceId
			? await convexClient
					.query(api.chats.getSession, {
						workspaceId: resolvedWorkspaceId,
						chatId: id,
					})
					.catch(() => null)
			: null;
	const selectedModel = resolveChatModel(model ?? storedChat?.model);
	const requestedReasoningEffort =
		reasoningEffort ?? storedChat?.reasoningEffort ?? undefined;
	const resolvedReasoningEffort = normalizeReasoningEffort(
		requestedReasoningEffort,
	);
	const providerOptions = getChatModelProviderOptions(selectedModel.model, {
		reasoningEffort: resolvedReasoningEffort,
	});
	const resolvedNoteId =
		(noteContext?.noteId as Id<"notes"> | null | undefined) ??
		storedChat?.noteId ??
		null;
	const chatMessages = await validateUIMessages({
		messages:
			message && convexClient && id && resolvedWorkspaceId
				? [
						...fromStoredMessages(
							await convexClient.query(api.chats.getMessagesSnapshot, {
								workspaceId: resolvedWorkspaceId,
								chatId: id,
							}),
						),
						message,
					]
				: message
					? [message]
					: messages,
	});
	const lastUserMessage =
		message ??
		[...chatMessages]
			.reverse()
			.find((currentMessage) => currentMessage.role === "user");
	const shouldGenerateChatTitle = Boolean(
		convexClient &&
			id &&
			resolvedWorkspaceId &&
			lastUserMessage &&
			(!storedChat || storedChat.title === "New chat"),
	);
	if (convexClient && id && resolvedWorkspaceId && lastUserMessage) {
		try {
			await convexClient.mutation(api.chats.saveMessage, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				noteId: resolvedNoteId ?? undefined,
				preview: getChatPreviewFromMessage(lastUserMessage),
				model: selectedModel.model,
				reasoningEffort: resolvedReasoningEffort,
				message: toStoredMessage(lastUserMessage),
			});
		} catch (error) {
			console.error("Failed to persist user chat message", error);
		}
	}

	const notesContext = await getNotesContext({
		request,
		convexToken,
		mentions,
		selectedSourceIds,
		workspaceId,
	});
	const attachedNoteContext =
		convexToken && resolvedNoteId && resolvedWorkspaceId
			? await getStoredNoteContext({
					request,
					convexToken,
					noteId: resolvedNoteId,
					workspaceId: resolvedWorkspaceId,
				}).catch(() =>
					getInlineNoteContext({
						title: noteContext?.title,
						text: noteContext?.text,
					}),
				)
			: getInlineNoteContext({
					title: noteContext?.title,
					text: noteContext?.text,
				});
	const selectedRecipe = await getSelectedRecipe({
		request,
		convexToken,
		recipeSlug,
		workspaceId,
	});
	const recipeContext = getRecipeContext(selectedRecipe);
	const appSourceIds = getSelectedAppSourceIds(selectedSourceIds);
	const appConnections =
		convexClient && resolvedWorkspaceId && appsEnabled
			? selectedSourceIds?.length === 0
				? await convexClient
						.query(api.appConnections.getAllForChat, {
							workspaceId: resolvedWorkspaceId,
						})
						.catch(() => [])
				: appSourceIds.length > 0
					? await convexClient
							.query(api.appConnections.getSelectedForChat, {
								workspaceId: resolvedWorkspaceId,
								sourceIds: appSourceIds,
							})
							.catch(() => [])
					: []
			: [];
	const appTools = appsEnabled
		? await buildWorkspaceToolSet(appConnections)
		: {};
	const imageGenerationRequested = shouldEnableImageGeneration(lastUserMessage);
	const imageGenerationEnabled = Boolean(
		convexClient && imageGenerationRequested,
	);
	const tools = {
		...(webSearchEnabled
			? {
					web_search: openai.tools.webSearch({
						searchContextSize: "medium",
						userLocation: {
							type: "approximate" as const,
							country: "US" as const,
						},
					}),
				}
			: {}),
		...(convexClient && imageGenerationRequested
			? {
					generate_image: createImageGenerationTool({
						uploadGeneratedImage: createConvexGeneratedImageUploader({
							chatAttachmentsApi: api.chatAttachments,
							client: convexClient,
						}),
					}),
				}
			: {}),
		...appTools,
	};

	const userProfileContext =
		convexClient &&
		(await convexClient
			.query(api.userPreferences.getAiProfileContext, {})
			.catch(() => null));
	const systemPrompt = `${buildChatSystemPrompt({
		notesContext,
		attachedNoteContext,
		recipeContext,
		userProfileContext: userProfileContext ?? undefined,
		webSearchEnabled,
	})}${imageGenerationEnabled ? `\n\n${buildImageGenerationInstruction()}` : ""}`;
	const result = streamText({
		model: openai(selectedModel.model),
		providerOptions,
		system: systemPrompt,
		messages: await convertToModelMessages(chatMessages),
		tools: Object.keys(tools).length > 0 ? tools : undefined,
		stopWhen: Object.keys(tools).length > 0 ? stepCountIs(5) : undefined,
	});

	return result.toUIMessageStreamResponse({
		originalMessages: chatMessages,
		generateMessageId,
		consumeSseStream: consumeStream,
		sendReasoning: true,
		onFinish: async ({ responseMessage }) => {
			if (!convexClient || !id || !resolvedWorkspaceId) {
				return;
			}

			try {
				const generatedChatTitle =
					shouldGenerateChatTitle && lastUserMessage
						? await generateChatTitle({
								userMessage: lastUserMessage,
								assistantMessage: responseMessage,
							})
						: undefined;
				await convexClient.mutation(api.chats.saveMessage, {
					workspaceId: resolvedWorkspaceId,
					chatId: id,
					noteId: resolvedNoteId ?? undefined,
					title: generatedChatTitle,
					preview: getChatPreviewFromMessage(responseMessage),
					model: selectedModel.model,
					reasoningEffort: resolvedReasoningEffort,
					message: toStoredMessage(responseMessage),
				});
			} catch (error) {
				console.error("Failed to persist assistant chat message", error);
			}
		},
		onError: () => "Something went wrong.",
	});
};

export const handleRealtimeTranscriptionSessionRequest = async (
	request: Request,
) => {
	if (!process.env.OPENAI_API_KEY) {
		return jsonResponse(500, {
			error: "OPENAI_API_KEY is not configured.",
		});
	}

	const body = (await request.json().catch(() => ({}))) as {
		lang?: string;
		speaker?: string;
		source?: string;
	};
	const language = normalizeTranscriptionLanguage(body.lang);
	const requestId = crypto.randomUUID();
	const speaker = trim(body.speaker);
	const source = trim(body.source);
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
				session: createDesktopRealtimeTranscriptionSession({
					language,
					source,
					speaker,
				}),
			}),
		},
	);

	logOpenAiResponseMetadata({
		context: "convex.http.realtime.client_secret",
		requestId,
		response: sessionResponse,
	});

	const payload = (await sessionResponse.json().catch(() => ({}))) as {
		error?: {
			message?: string;
		};
		value?: string;
	};

	if (!sessionResponse.ok) {
		return jsonResponse(sessionResponse.status, {
			error:
				payload.error?.message ||
				"Failed to create realtime transcription session.",
		});
	}

	if (!payload.value) {
		return jsonResponse(500, {
			error: "OpenAI did not return a client secret.",
		});
	}

	return jsonResponse(200, {
		clientSecret: payload.value,
	});
};

export const handleEnhanceNoteRequest = async (request: Request) => {
	if (!process.env.OPENAI_API_KEY) {
		return jsonResponse(500, {
			error: "OPENAI_API_KEY is not configured.",
		});
	}

	const {
		title = "",
		rawNotes = "",
		transcript = "",
		noteText = "",
	} = (await request.json().catch(() => ({}))) as EnhanceNoteRequestBody;

	const trimmedTranscript = transcript.trim();
	const trimmedNoteText = noteText.trim();

	if (!trimmedTranscript && !trimmedNoteText) {
		return jsonResponse(400, {
			error: "Transcript or note text is required.",
		});
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

	return jsonResponse(200, {
		note: output,
	});
};

export const handleApplyTemplateRequest = async (request: Request) => {
	if (!process.env.OPENAI_API_KEY) {
		return jsonResponse(500, {
			error: "OPENAI_API_KEY is not configured.",
		});
	}

	const {
		title = "",
		noteText = "",
		template,
	} = (await request.json().catch(() => ({}))) as ApplyTemplateRequestBody;

	if (!noteText.trim()) {
		return jsonResponse(400, {
			error: "Note text is required.",
		});
	}

	if (!template?.name || !Array.isArray(template.sections)) {
		return jsonResponse(400, {
			error: "A valid template is required.",
		});
	}

	const templateSections = createTemplateSections(template);

	if (templateSections.length === 0) {
		return jsonResponse(400, {
			error: "The selected template does not have usable sections.",
		});
	}

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

	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream({
			async start(controller) {
				try {
					let streamedText = "";

					for await (const delta of result.textStream) {
						streamedText += delta;
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify({
									type: "text-delta",
									delta,
								})}\n`,
							),
						);
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
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify({
									type: "error",
									error: validationError,
								})}\n`,
							),
						);
						controller.close();
						return;
					}

					controller.enqueue(
						encoder.encode(
							`${JSON.stringify({
								type: "final-note",
								note: parsed.note,
							})}\n`,
						),
					);
					controller.close();
				} catch (error) {
					controller.enqueue(
						encoder.encode(
							`${JSON.stringify({
								type: "error",
								error:
									error instanceof Error
										? error.message
										: "Failed to apply note template rewrite.",
							})}\n`,
						),
					);
					controller.close();
				}
			},
		}),
		{
			status: 200,
			headers: {
				"Cache-Control": "no-cache, no-transform",
				"Content-Type": "application/x-ndjson; charset=utf-8",
			},
		},
	);
};
