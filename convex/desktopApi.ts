import { openai } from "@ai-sdk/openai";
import {
	consumeStream,
	createAgentUIStreamResponse,
	generateText,
	Output,
	smoothStream,
	streamText,
	type InferUITools,
	type ToolSet,
	tool,
	type UIMessage,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import {
	buildSelectedAppSourceInstructions,
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
} from "../packages/ai/src/capability-metadata.mjs";
import { buildCoreChatToolPolicy } from "../packages/ai/src/chat-tool-policy.mjs";
import { buildChatAutomationContext } from "../packages/ai/src/automation-tools.mjs";
import { buildConvexWorkspaceToolSet } from "../packages/ai/src/convex-workspace-tools.mjs";
import { createHostedChatAgent } from "../packages/ai/src/hosted-chat-agent.mjs";
import {
	buildHostedChatRuntimePrompt,
	buildHostedNotesContext,
	clampHostedNoteContext,
	generateHostedChatMessageId,
	generateHostedChatTitle,
	getHostedChatPreviewFromMessage,
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
	toHostedStoredMessage,
} from "../packages/ai/src/hosted-chat-runtime.mjs";
import {
	buildLocalFolderSystemContext,
	buildLocalFolderToolConfigs,
} from "../packages/ai/src/local-folder-tool-definitions.mjs";
import {
	CHAT_SERVER_MODELS,
	getChatModelProviderOptions,
	NOTE_GENERATION_MODEL_ID,
	normalizeReasoningEffort,
} from "../packages/ai/src/models.mjs";
import {
	parseTemplateStreamToStructuredNote,
	validateTemplateStream,
} from "../packages/ai/src/note-template-stream.mjs";
import {
	APPLY_TEMPLATE_SYSTEM_PROMPT,
	buildApplyTemplatePrompt,
	buildEnhancedNotePrompt,
	ENHANCED_NOTE_SYSTEM_PROMPT,
} from "../packages/ai/src/prompts.mjs";
import {
	createDesktopRealtimeTranscriptionSession,
	normalizeTranscriptionLanguage,
} from "../packages/ai/src/transcription.mjs";
import type { WorkspaceToolConnection } from "../packages/ai/src/capability-registry.mjs";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type ChatRequestBody = {
	id?: string;
	messageId?: string;
	workspaceId?: string | null;
	message?: UIMessage;
	messages?: UIMessage[];
	model?: string;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	webSearchEnabled?: boolean;
	appsEnabled?: boolean;
	mentions?: string[];
	selectedSourceIds?: string[];
	timezone?: string;
	localFolders?: Array<{ id?: string; name?: string; path?: string }>;
	convexToken?: string | null;
	recipeSlug?: string | null;
	noteContext?: {
		noteId?: string | null;
		title?: string;
		text?: string;
	};
};

type HostedChatUIMessage = UIMessage<unknown, never, InferUITools<ToolSet>>;

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

const chatModels = CHAT_SERVER_MODELS;
const fallbackChatModel = chatModels[0];
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

const getSharedLocalFolderRoots = (
	localFolders: ChatRequestBody["localFolders"],
) =>
	Array.isArray(localFolders)
		? localFolders
				.filter(
					(folder): folder is { id?: string; name: string; path: string } =>
						typeof folder?.name === "string" &&
						folder.name.length > 0 &&
						typeof folder?.path === "string" &&
						folder.path.length > 0,
				)
				.map((folder) => ({
					name: folder.name,
					path: folder.path,
				}))
		: [];

const buildDesktopLocalFolderClientTools = (
	roots: Array<{ name: string; path: string }>,
): ToolSet | undefined => {
	if (roots.length === 0) {
		return undefined;
	}

	const configs = buildLocalFolderToolConfigs(roots);

	return {
		list_local_directory: tool(configs.list_local_directory),
		read_local_file: tool(configs.read_local_file),
		transcribe_local_audio: tool(configs.transcribe_local_audio),
		inspect_local_image: tool(configs.inspect_local_image),
		search_local_images: tool(configs.search_local_images),
		search_local_files: tool(configs.search_local_files),
		run_local_bash: tool(configs.run_local_bash),
		get_shared_local_folders: tool(configs.get_shared_local_folders),
	};
};

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
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "mentions" | "workspaceId"> & {
	request: Request;
}) => {
	if (!convexToken || !workspaceId) {
		return "";
	}

	const client = getConvexClient(request, convexToken);

	if (!client) {
		return "";
	}

	const noteIds = getSelectedNoteSourceIds({ mentions }) as Id<"notes">[];
	const notes =
		noteIds.length > 0
			? await client.query(api.notes.getChatContext, {
					workspaceId: workspaceId as Id<"workspaces">,
					ids: noteIds,
				})
			: [];

	return buildHostedNotesContext(notes);
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
			? `Current note content:\n${clampHostedNoteContext(note.searchableText)}`
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
		messageId,
		message,
		messages = [],
		model,
		reasoningEffort,
		workspaceId,
		webSearchEnabled = false,
		appsEnabled = true,
		mentions,
		selectedSourceIds,
		timezone,
		localFolders = [],
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
	const resolvedTimezone = trim(timezone) || "UTC";
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
	const editedMessageId = trim(messageId);
	if (
		editedMessageId &&
		message &&
		convexClient &&
		id &&
		resolvedWorkspaceId
	) {
		try {
			await convexClient.mutation(api.chats.truncateFromMessage, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				messageId: editedMessageId,
			});
		} catch (error) {
			console.error("Failed to truncate edited chat branch", error);
			return jsonResponse(500, {
				error: "Failed to prepare edited chat message.",
			});
		}
	}
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
	const agentMessages = chatMessages as HostedChatUIMessage[];
	const lastUserMessage =
		message?.role === "user"
			? message
			: [...chatMessages]
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
				preview: getHostedChatPreviewFromMessage(lastUserMessage),
				model: selectedModel.model,
				reasoningEffort: resolvedReasoningEffort,
				message: toHostedStoredMessage(lastUserMessage),
			});
		} catch (error) {
			console.error("Failed to persist user chat message", error);
		}
	}

	const notesContext = await getNotesContext({
		request,
		convexToken,
		mentions,
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
					getInlineHostedNoteContext({
						title: noteContext?.title,
						text: noteContext?.text,
					}),
				)
			: getInlineHostedNoteContext({
					title: noteContext?.title,
					text: noteContext?.text,
				});
	const selectedRecipe = await getSelectedRecipe({
		request,
		convexToken,
		recipeSlug,
		workspaceId,
	});
	const recipeContext = getHostedChatRecipeContext(selectedRecipe);
	const appSourceIds = getSelectedAppSourceIds(selectedSourceIds);
	const appConnections =
		convexClient &&
		resolvedWorkspaceId &&
		appsEnabled &&
		appSourceIds.length > 0
			? await convexClient
					.action(api.appConnectionActions.getSelectedForChatWithFreshTokens, {
						workspaceId: resolvedWorkspaceId,
						sourceIds: appSourceIds,
					})
					.catch(() => [])
			: [];
	const workspaceToolConnections =
		appConnections as WorkspaceToolConnection[];
	const selectedAppSourceInstructions = buildSelectedAppSourceInstructions(
		workspaceToolConnections,
	);
	const appTools = appsEnabled
		? await buildConvexWorkspaceToolSet({
				connections: workspaceToolConnections,
				convexClient,
				workspaceId: resolvedWorkspaceId,
			})
		: {};
	const localFolderRoots = getSharedLocalFolderRoots(localFolders);
	const localFolderContext = buildLocalFolderSystemContext(localFolderRoots);
	const coreToolPolicy = buildCoreChatToolPolicy({
		chatAttachmentsApi: api.chatAttachments,
		convexClient,
		message: lastUserMessage,
		webSearchEnabled,
	});
	const automationContext = buildChatAutomationContext({
		appConnections: workspaceToolConnections,
		chatId: id,
		createAutomation:
			convexClient && resolvedWorkspaceId
				? async (automation) =>
						await convexClient.mutation(api.automations.create, {
							workspaceId: resolvedWorkspaceId,
							...automation,
						})
				: null,
		defaultModel: selectedModel.model,
		defaultReasoningEffort: resolvedReasoningEffort,
		defaultTimezone: resolvedTimezone,
		webSearchEnabled,
	});
	const enabledTools = {
		...coreToolPolicy.enabledTools,
		...automationContext.tools,
		...appTools,
	};

	const userProfileContext =
		convexClient &&
		(await convexClient
			.query(api.userPreferences.getAiProfileContext, {})
			.catch(() => null));
	const systemPrompt = buildHostedChatRuntimePrompt({
		notesContext,
		attachedNoteContext,
		recipeContext,
		userProfileContext: userProfileContext ?? undefined,
		webSearchEnabled,
		coreToolInstruction: coreToolPolicy.instruction,
		automationInstruction: automationContext.instruction,
		localFolderContext,
		selectedAppSourceInstructions,
	});
	const localFolderTools = buildDesktopLocalFolderClientTools(localFolderRoots);
	const { agent } = createHostedChatAgent({
		additionalAgentTools: localFolderTools,
		enabledTools,
		emptyToolsWhenNone: true,
		model: selectedModel.model,
		prepareStep: coreToolPolicy.prepareStep,
		providerOptions,
		systemPrompt,
	});

	return await createAgentUIStreamResponse({
		agent,
		uiMessages: agentMessages,
		originalMessages: agentMessages,
		generateMessageId: generateHostedChatMessageId,
		consumeSseStream: consumeStream,
		sendReasoning: true,
		onFinish: async ({ responseMessage }) => {
			if (!convexClient || !id || !resolvedWorkspaceId) {
				return;
			}

			try {
				const generatedChatTitle =
					shouldGenerateChatTitle && lastUserMessage
						? await generateHostedChatTitle({
								userMessage: lastUserMessage,
								assistantMessage: responseMessage,
							})
						: undefined;
				await convexClient.mutation(api.chats.saveMessage, {
					workspaceId: resolvedWorkspaceId,
					chatId: id,
					noteId: resolvedNoteId ?? undefined,
					title: generatedChatTitle,
					preview: getHostedChatPreviewFromMessage(responseMessage),
					model: selectedModel.model,
					reasoningEffort: resolvedReasoningEffort,
					message: toHostedStoredMessage(responseMessage),
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
