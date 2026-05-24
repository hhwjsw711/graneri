import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { openai } from "@ai-sdk/openai";
import {
	consumeStream,
	createAgentUIStream,
	createIdGenerator,
	generateText,
	Output,
	pipeUIMessageStreamToResponse,
	smoothStream,
	stepCountIs,
	streamText,
	ToolLoopAgent,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../../convex/_generated/api.js";
import {
	buildSelectedAppSourceInstructions,
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
} from "../../../packages/ai/src/app-source-providers.mjs";
import { buildChatAutomationContext } from "../../../packages/ai/src/automation-tools.mjs";
import {
	createChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "../../../packages/ai/src/chat-latency-logger.mjs";
import {
	buildChatTitlePrompt,
	deriveFallbackChatTitle,
	finalizeGeneratedChatTitle,
} from "../../../packages/ai/src/chat-titles.mjs";
import { buildConvexWorkspaceToolSet } from "../../../packages/ai/src/convex-workspace-tools.mjs";
import {
	buildImageGenerationInstruction,
	createConvexGeneratedImageUploader,
	createImageGenerationTool,
} from "../../../packages/ai/src/image-generation-tool.mjs";
import {
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
} from "../../../packages/ai/src/local-folder-tools.mjs";
import { extractTextFromUIMessage } from "../../../packages/ai/src/local-path-references.mjs";
import {
	CHAT_SERVER_MODELS,
	CHAT_TITLE_MODEL_ID,
	getChatModelProviderOptions,
	NOTE_GENERATION_MODEL_ID,
	normalizeReasoningEffort,
} from "../../../packages/ai/src/models.mjs";
import {
	parseTemplateStreamToStructuredNote,
	validateTemplateStream,
} from "../../../packages/ai/src/note-template-stream.mjs";
import { finalizeOpenAIToolSet } from "../../../packages/ai/src/openai-tool-search.mjs";
import {
	APPLY_TEMPLATE_SYSTEM_PROMPT,
	buildApplyTemplatePrompt,
	buildChatSystemPrompt,
	buildEnhancedNotePrompt,
	CHAT_TITLE_SYSTEM_PROMPT,
	ENHANCED_NOTE_SYSTEM_PROMPT,
} from "../../../packages/ai/src/prompts.mjs";
import {
	createDesktopRealtimeTranscriptionSession,
	normalizeTranscriptionLanguage,
} from "../../../packages/ai/src/transcription.mjs";

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(runtimeDir, "../../web/dist");
const AI_LATENCY_DEBUG_ENABLED = process.env.OPENGRAN_AI_LATENCY_DEBUG === "1";

const mimeTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

const MAX_CHAT_PREVIEW_LENGTH = 180;
const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_NOTE_CONTEXT_LENGTH = 16_000;
const chatModels = CHAT_SERVER_MODELS;
const fallbackChatModel = chatModels[0];
const preferredLocalServerPorts = Array.from(
	{ length: 20 },
	(_value, index) => 42831 + index,
);
const generateMessageId = createIdGenerator({
	prefix: "msg",
	size: 16,
});

const shouldEnableImageGeneration = (message) =>
	/\b(create|draw|generate|make|render)\b[\s\S]{0,80}\b(image|picture|photo|illustration|art|graphic|logo|avatar)\b/iu.test(
		extractTextFromUIMessage(message),
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
const OPEN_GRAN_MARK_SVG = `
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
	<path
		d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>`;

const createAuthCallbackSuccessHtml = () => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>OpenGran</title>
		<style>
			* {
				box-sizing: border-box;
			}

			body {
				margin: 0;
				min-height: 100vh;
				display: grid;
				place-items: center;
				background: #0a0a0a;
				color: #fafafa;
				font-family: ui-sans-serif, system-ui, sans-serif;
			}

			.shell {
				width: min(calc(100vw - 48px), 24rem);
				text-align: center;
				padding: 24px;
			}

			.mark {
				width: 24px;
				height: 24px;
				margin: 0 auto 16px;
				display: flex;
				align-items: center;
				justify-content: center;
				border: 1px solid rgba(255, 255, 255, 0.1);
				border-radius: 6px;
				background: #18181b;
				color: #fafafa;
			}

			.mark svg {
				width: 16px;
				height: 16px;
				display: block;
			}

			h1 {
				margin: 0 0 8px;
				font-size: 20px;
				line-height: 1.75rem;
				font-weight: 600;
			}

			p {
				margin: 0;
				font-size: 14px;
				line-height: 1.25rem;
				color: #a1a1aa;
			}

			p + p {
				margin-top: 8px;
			}
		</style>
	</head>
	<body>
		<main class="shell">
			<div class="mark">${OPEN_GRAN_MARK_SVG}</div>
			<h1>Authentication complete</h1>
			<p>Return to OpenGran to continue. You can close this window if it stays open.</p>
		</main>
	</body>
</html>`;

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const logOpenAiResponseMetadata = ({ context, requestId, response }) => {
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

const getHostedApiBaseUrl = () =>
	process.env.CONVEX_SITE_URL?.trim() || process.env.SITE_URL?.trim() || "";

const shouldProxyHostedAiRequest = () =>
	!process.env.OPENAI_API_KEY && Boolean(getHostedApiBaseUrl());

const getNotesContext = async ({ convexToken, mentions, workspaceId }) => {
	if (!convexToken || !workspaceId) {
		return "";
	}

	const noteIds = getSelectedNoteSourceIds({ mentions });
	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const notes =
		noteIds.length > 0
			? await client.query(api.notes.getChatContext, {
					workspaceId,
					ids: noteIds,
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

const getSelectedAppConnections = async ({
	convexToken,
	selectedSourceIds,
	workspaceId,
}) => {
	if (!convexToken || !workspaceId) {
		return [];
	}

	const allSelectedSourceIds = selectedSourceIds ?? [];

	if (allSelectedSourceIds.length === 0) {
		return [];
	}

	const sourceIds = getSelectedAppSourceIds(selectedSourceIds);
	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const googleSources = await client
		.action(api.googleTools.listAvailableSources, { workspaceId })
		.catch(() => []);

	if (sourceIds.length === 0) {
		return googleSources.filter((source) =>
			allSelectedSourceIds.includes(source.id),
		);
	}

	const connections = await client.action(
		api.appConnectionActions.getSelectedForChatWithFreshTokens,
		{
			workspaceId,
			sourceIds,
		},
	);

	return [
		...connections,
		...googleSources.filter((source) =>
			allSelectedSourceIds.includes(source.id),
		),
	];
};

const clampWhitespace = (value) => value.replace(/\s+/g, " ").trim();

const clampNoteContext = (value) =>
	value.replace(/\r/g, "").trim().slice(0, MAX_NOTE_CONTEXT_LENGTH);

const truncate = (value, maxLength) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const getInlineNoteContext = ({ title, text }) => {
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

const getStoredNoteContext = async ({ convexToken, noteId, workspaceId }) => {
	if (!convexToken || !noteId || !workspaceId) {
		return "";
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
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

const getSelectedRecipe = async ({ convexToken, recipeSlug, workspaceId }) => {
	if (!convexToken || !recipeSlug || !workspaceId) {
		return null;
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const recipes = await client.query(api.recipes.list, {
		workspaceId,
	});

	return recipes.find((recipe) => recipe.slug === recipeSlug) ?? null;
};

const getRecipeContext = (selectedRecipe) => {
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

const getMessageText = (message) =>
	clampWhitespace(
		message.parts
			.filter(
				(part) =>
					part.type === "text" &&
					typeof part.text === "string" &&
					part.text.length > 0,
			)
			.map((part) => part.text)
			.join("\n\n"),
	);

const generateChatTitle = async ({ userMessage, assistantMessage }) => {
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

const getChatPreviewFromMessage = (message) =>
	truncate(getMessageText(message), MAX_CHAT_PREVIEW_LENGTH);

const toStoredMessage = (message) => ({
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

const fromStoredMessages = (messages) =>
	messages.map((message) => ({
		id: message.id,
		role: message.role,
		metadata:
			message.metadataJson === undefined
				? undefined
				: JSON.parse(message.metadataJson),
		parts: JSON.parse(message.partsJson),
	}));

const resolveChatModel = (value) =>
	chatModels.find((model) => model.id === value || model.model === value) ??
	fallbackChatModel;

const readJsonBody = async (request) => {
	const chunks = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}

	const rawBody = Buffer.concat(chunks).toString("utf8");

	if (!rawBody) {
		return {};
	}

	return JSON.parse(rawBody);
};

const createTemplateSections = (template) =>
	(template?.sections ?? [])
		.map((section) => ({
			title: section?.title?.trim() ?? "",
			prompt: section?.prompt?.trim() ?? "",
		}))
		.filter((section) => section.title);

const sendJson = (response, statusCode, payload) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(payload));
};

const proxyHostedAiRequest = async ({
	path,
	request,
	response,
	bodyOverride,
	headersOverride,
}) => {
	const baseUrl = getHostedApiBaseUrl();

	if (!baseUrl) {
		throw new Error("CONVEX_SITE_URL is not configured.");
	}

	const proxyHeaders = new Headers();

	for (const [key, value] of Object.entries(request.headers)) {
		if (value == null || key.toLowerCase() === "host") {
			continue;
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				proxyHeaders.append(key, entry);
			}
			continue;
		}

		proxyHeaders.set(key, value);
	}

	for (const [key, value] of Object.entries(headersOverride ?? {})) {
		if (value == null) {
			proxyHeaders.delete(key);
			continue;
		}

		proxyHeaders.set(key, value);
	}

	const proxyResponse = await fetch(new URL(path, baseUrl), {
		method: request.method,
		headers: proxyHeaders,
		body:
			bodyOverride ??
			(request.method === "GET" || request.method === "HEAD"
				? undefined
				: Readable.toWeb(request)),
		duplex: "half",
	});

	response.statusCode = proxyResponse.status;

	for (const [key, value] of proxyResponse.headers.entries()) {
		response.setHeader(key, value);
	}

	if (!proxyResponse.body) {
		response.end();
		return;
	}

	Readable.fromWeb(proxyResponse.body).pipe(response);
};

const getRequestOrigin = (request) => {
	const originHeader = request.headers.origin;
	if (typeof originHeader === "string" && originHeader.length > 0) {
		return originHeader.replace(/\/$/, "");
	}

	const refererHeader = request.headers.referer;
	if (typeof refererHeader !== "string" || refererHeader.length === 0) {
		return null;
	}

	try {
		return new URL(refererHeader).origin;
	} catch {
		return null;
	}
};

const getAllowedLocalAppOrigins = (allowedOrigins) =>
	new Set(
		allowedOrigins
			.map((origin) => (typeof origin === "string" ? origin.trim() : ""))
			.filter(Boolean)
			.map((origin) => origin.replace(/\/$/, "")),
	);

const isAuthorizedLocalAppRequest = (request, allowedOrigins) => {
	const origins = getAllowedLocalAppOrigins(allowedOrigins);
	if (origins.size === 0) {
		return false;
	}

	const requestOrigin = getRequestOrigin(request);
	return requestOrigin !== null && origins.has(requestOrigin);
};

const setCorsHeadersForLocalAppRequest = (
	request,
	response,
	allowedOrigins,
) => {
	const origins = getAllowedLocalAppOrigins(allowedOrigins);
	const requestOrigin = getRequestOrigin(request);

	if (requestOrigin === null || !origins.has(requestOrigin)) {
		return false;
	}

	response.setHeader("Access-Control-Allow-Origin", requestOrigin);
	response.setHeader("Vary", "Origin");
	response.setHeader("Access-Control-Allow-Credentials", "true");
	response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	response.setHeader(
		"Access-Control-Allow-Headers",
		request.headers["access-control-request-headers"] ?? "content-type",
	);
	return true;
};

const handleChatRequest = async ({
	getSharedLocalFolders,
	request,
	response,
}) => {
	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: "/api/chat",
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
		timezone,
		localFolders = [],
		convexToken,
		recipeSlug,
		noteContext,
	} = await readJsonBody(request);
	const logLatency = createChatLatencyLogger({
		chatId: id,
		enabled: AI_LATENCY_DEBUG_ENABLED,
		model,
		reasoningEffort,
	});
	logLatency("request.body_read", {
		appsEnabled,
		hasMessage: Boolean(message),
		hasNoteContext: Boolean(noteContext),
		webSearchEnabled,
	});

	if (!Array.isArray(messages)) {
		sendJson(response, 400, {
			error: "Invalid chat payload.",
		});
		return;
	}

	const resolvedWorkspaceId = workspaceId ?? null;
	const resolvedTimezone = timezone?.trim() || "UTC";
	const convexClient =
		convexToken && id && resolvedWorkspaceId
			? new ConvexHttpClient(getConvexUrl(), { auth: convexToken })
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
	logLatency("convex.session_loaded", {
		hasStoredChat: Boolean(storedChat),
	});
	const selectedModel = resolveChatModel(model ?? storedChat?.model);
	const resolvedReasoningEffort = normalizeReasoningEffort(
		reasoningEffort ?? storedChat?.reasoningEffort,
	);
	const providerOptions = getChatModelProviderOptions(selectedModel.model, {
		reasoningEffort: resolvedReasoningEffort,
	});
	logLatency("chat.model_resolved", {
		hasProviderOptions: Boolean(providerOptions),
		model: selectedModel.model,
		reasoningEffort: resolvedReasoningEffort,
	});
	const resolvedNoteId = noteContext?.noteId ?? storedChat?.noteId ?? null;
	const chatMessages = await validateUIMessages({
		messages:
			message && convexClient && id && resolvedWorkspaceId
				? [
						...fromStoredMessages(
							await convexClient.query(api.chats.getMessages, {
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
	logLatency("chat.messages_validated", {
		chatMessageCount: chatMessages.length,
	});
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
	logLatency("convex.user_message_saved", {
		attempted: Boolean(
			convexClient && id && resolvedWorkspaceId && lastUserMessage,
		),
	});

	const notesContext = await getNotesContext({
		convexToken,
		mentions,
		workspaceId: resolvedWorkspaceId,
	});
	const attachedNoteContext =
		convexToken && resolvedNoteId && resolvedWorkspaceId
			? await getStoredNoteContext({
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
		convexToken,
		recipeSlug,
		workspaceId: resolvedWorkspaceId,
	});
	const recipeContext = getRecipeContext(selectedRecipe);
	const userProfileContext = convexClient
		? await convexClient
				.query(api.userPreferences.getAiProfileContext, {})
				.catch(() => null)
		: null;
	const selectedAppConnections = appsEnabled
		? await getSelectedAppConnections({
				convexToken,
				selectedSourceIds,
				workspaceId: resolvedWorkspaceId,
			})
		: [];
	const selectedAppSourceInstructions = buildSelectedAppSourceInstructions(
		selectedAppConnections,
	);
	logLatency("context.sources_loaded", {
		appConnectionCount: selectedAppConnections.length,
		hasAttachedNoteContext: attachedNoteContext.length > 0,
		hasNotesContext: notesContext.length > 0,
		hasRecipeContext: recipeContext.length > 0,
		hasUserProfileContext: Boolean(userProfileContext),
	});
	const appTools = await buildConvexWorkspaceToolSet({
		connections: selectedAppConnections,
		convexClient,
		workspaceId: resolvedWorkspaceId,
	});
	const localFolderRoots =
		typeof getSharedLocalFolders === "function"
			? getSharedLocalFolders(
					(localFolders ?? [])
						.map((folder) => folder?.id)
						.filter((id) => typeof id === "string" && id),
				)
			: [];
	const localFolderContext = buildLocalFolderSystemContext(localFolderRoots);
	logLatency("tools.workspace_ready", {
		appToolCount: Object.keys(appTools).length,
		localFolderCount: localFolderRoots.length,
	});
	const imageGenerationEnabled = Boolean(
		convexClient && message && shouldEnableImageGeneration(message),
	);
	const automationContext = buildChatAutomationContext({
		appConnections: selectedAppConnections,
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
	const systemPrompt = `${buildChatSystemPrompt({
		notesContext,
		attachedNoteContext,
		recipeContext,
		userProfileContext: userProfileContext ?? undefined,
		webSearchEnabled,
	})}${imageGenerationEnabled ? `\n\n${buildImageGenerationInstruction()}` : ""}${
		automationContext.instruction ? `\n\n${automationContext.instruction}` : ""
	}${localFolderContext ? `\n\n${localFolderContext}` : ""}${
		selectedAppSourceInstructions ? `\n\n${selectedAppSourceInstructions}` : ""
	}${
		localFolderContext
			? "\n\nLocal folder priority: if the user's request is about a local path, shared folder, local file, local audio, local video, local transcript, or local recording, use the local folder tools first and do not use connected app tools unless the user explicitly asks for connected app data."
			: ""
	}`;
	const enabledTools = {
		...(webSearchEnabled
			? {
					web_search: openai.tools.webSearch({
						searchContextSize: "medium",
						userLocation: {
							type: "approximate",
							country: "US",
						},
					}),
				}
			: {}),
		...(imageGenerationEnabled
			? {
					generate_image: createImageGenerationTool({
						uploadGeneratedImage: createConvexGeneratedImageUploader({
							chatAttachmentsApi: api.chatAttachments,
							client: convexClient,
						}),
					}),
				}
			: {}),
		...automationContext.tools,
		...appTools,
		...(localFolderRoots.length > 0
			? buildLocalFolderTools(localFolderRoots)
			: {}),
	};
	const finalizedToolSet = finalizeOpenAIToolSet(enabledTools);
	const { tools } = finalizedToolSet;
	logLatency("tools.finalized", {
		deferredToolCount: finalizedToolSet.deferredToolCount,
		hasEnabledTools: finalizedToolSet.hasTools,
		hasToolSearch: finalizedToolSet.hasToolSearch,
		toolCount: finalizedToolSet.toolCount,
	});
	const agent = new ToolLoopAgent({
		model: openai(selectedModel.model),
		providerOptions,
		instructions: systemPrompt,
		tools: finalizedToolSet.hasTools ? tools : undefined,
		stopWhen: finalizedToolSet.hasTools ? stepCountIs(5) : undefined,
	});
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const streamLatencyTracker = createChatStreamLatencyTracker(logLatency);
	const stream = await createAgentUIStream({
		agent,
		uiMessages: chatMessages,
		originalMessages: chatMessages,
		generateMessageId,
		onFinish: async ({ responseMessage }) => {
			logLatency("stream.finish", streamLatencyTracker.getFinishDetails());

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
	logLatency("ai.stream_created");
	const timedStream = streamLatencyTracker.wrapStream(stream);

	pipeUIMessageStreamToResponse({
		response,
		stream: timedStream,
		consumeSseStream: consumeStream,
	});
};

const handleRealtimeTranscriptionSessionRequest = async (request, response) => {
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
	const language = normalizeTranscriptionLanguage(lang);
	const requestId = crypto.randomUUID();

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
		context: "desktop.local_server.realtime.client_secret",
		requestId,
		response: sessionResponse,
	});

	const payload = await sessionResponse.json().catch(() => ({}));

	if (!sessionResponse.ok) {
		sendJson(response, sessionResponse.status, {
			error:
				payload?.error?.message ||
				"Failed to create realtime transcription session.",
		});
		return;
	}

	const clientSecret = payload?.value;

	if (!clientSecret) {
		sendJson(response, 500, {
			error: "OpenAI did not return a client secret.",
		});
		return;
	}

	sendJson(response, 200, {
		clientSecret,
	});
};

const handleEnhanceNoteRequest = async (request, response) => {
	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: "/api/enhance-note",
			request,
			response,
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

const handleApplyTemplateRequest = async (request, response) => {
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

const resolveAssetPath = (requestPath, distDir, basePath = "/") => {
	const normalizedBasePath =
		basePath === "/" ? "/" : `/${basePath.replace(/^\/+|\/+$/g, "")}`;
	const relativePath =
		normalizedBasePath === "/"
			? requestPath
			: requestPath.startsWith(normalizedBasePath)
				? requestPath.slice(normalizedBasePath.length) || "/"
				: requestPath;
	const normalizedPath =
		relativePath === "/"
			? "index.html"
			: normalize(relativePath)
					.replace(/^[/\\]+/, "")
					.replace(/^(\.\.[/\\])+/, "");
	const candidatePath = join(distDir, normalizedPath);
	const safePath = resolve(candidatePath);

	if (!safePath.startsWith(distDir)) {
		return null;
	}

	return safePath;
};

const serveFile = (response, filePath) => {
	response.statusCode = 200;
	response.setHeader(
		"Content-Type",
		mimeTypes[extname(filePath)] ?? "application/octet-stream",
	);
	createReadStream(filePath).pipe(response);
};

const serveStaticAsset = async (request, response, options = {}) => {
	const {
		distDir = webDistDir,
		basePath = "/",
		missingBundleMessage = "Desktop renderer bundle is missing.",
	} = options;

	if (!existsSync(distDir)) {
		sendJson(response, 500, {
			error: missingBundleMessage,
		});
		return;
	}

	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
	const assetPath = resolveAssetPath(requestUrl.pathname, distDir, basePath);

	if (!assetPath) {
		response.statusCode = 403;
		response.end("Forbidden");
		return;
	}

	try {
		const assetStats = await stat(assetPath);
		if (assetStats.isFile()) {
			serveFile(response, assetPath);
			return;
		}
	} catch {}

	serveFile(response, join(distDir, "index.html"));
};

export const startLocalServer = async ({
	getAllowedOrigins,
	getSharedLocalFolders,
	onAuthCallback,
} = {}) => {
	let localServerOrigin = null;
	const server = createServer((request, response) => {
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const requestPath = requestUrl.pathname;
		const allowedOrigins = [
			localServerOrigin,
			...(typeof getAllowedOrigins === "function" ? getAllowedOrigins() : []),
		];

		if (requestPath === "/auth/callback") {
			void Promise.resolve(onAuthCallback?.(requestUrl.toString()))
				.then(() => {
					response.statusCode = 200;
					response.setHeader("Content-Type", "text/html; charset=utf-8");
					response.end(createAuthCallbackSuccessHtml());
				})
				.catch((error) => {
					const message =
						error instanceof Error ? error.message : "Authentication failed.";
					response.statusCode = 500;
					response.setHeader("Content-Type", "text/plain; charset=utf-8");
					response.end(message);
				});
			return;
		}

		if (
			requestPath === "/api/chat" ||
			requestPath === "/api/apply-template" ||
			requestPath === "/api/realtime-transcription-session" ||
			requestPath === "/api/enhance-note"
		) {
			if (request.method === "OPTIONS") {
				if (
					setCorsHeadersForLocalAppRequest(request, response, allowedOrigins)
				) {
					response.statusCode = 204;
					response.end();
					return;
				}
			}

			if (!isAuthorizedLocalAppRequest(request, allowedOrigins)) {
				sendJson(response, 403, {
					error: "Forbidden",
				});
				return;
			}

			setCorsHeadersForLocalAppRequest(request, response, allowedOrigins);
		}

		if (requestPath === "/api/chat") {
			if (request.method !== "POST") {
				response.statusCode = 405;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ error: "Method not allowed." }));
				return;
			}

			void handleChatRequest({
				getSharedLocalFolders,
				request,
				response,
			}).catch((error) => {
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				sendJson(response, 500, { error: message });
			});
			return;
		}

		if (requestPath === "/api/apply-template") {
			if (request.method !== "POST") {
				response.statusCode = 405;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ error: "Method not allowed." }));
				return;
			}

			void handleApplyTemplateRequest(request, response).catch((error) => {
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				sendJson(response, 500, { error: message });
			});
			return;
		}

		if (requestPath === "/api/realtime-transcription-session") {
			if (request.method !== "POST") {
				response.statusCode = 405;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ error: "Method not allowed." }));
				return;
			}

			void handleRealtimeTranscriptionSessionRequest(request, response).catch(
				(error) => {
					const message =
						error instanceof Error ? error.message : "Unexpected server error.";
					sendJson(response, 500, { error: message });
				},
			);
			return;
		}

		if (requestPath === "/api/enhance-note") {
			if (request.method !== "POST") {
				response.statusCode = 405;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ error: "Method not allowed." }));
				return;
			}

			void handleEnhanceNoteRequest(request, response).catch((error) => {
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				sendJson(response, 500, { error: message });
			});
			return;
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			response.statusCode = 405;
			response.end("Method not allowed");
			return;
		}

		void serveStaticAsset(request, response).catch((error) => {
			const message =
				error instanceof Error ? error.message : "Unexpected server error.";
			response.statusCode = 500;
			response.end(message);
		});
	});

	let lastListenError = null;

	for (const port of preferredLocalServerPorts) {
		try {
			await new Promise((resolvePromise, rejectPromise) => {
				server.once("error", rejectPromise);
				server.listen(port, "127.0.0.1", () => {
					server.off("error", rejectPromise);
					resolvePromise();
				});
			});
			lastListenError = null;
			break;
		} catch (error) {
			server.removeAllListeners("error");
			lastListenError = error;
		}
	}

	if (lastListenError !== null && !server.listening) {
		await new Promise((resolvePromise, rejectPromise) => {
			server.once("error", rejectPromise);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", rejectPromise);
				resolvePromise();
			});
		});
	}

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Local desktop server did not expose a TCP port.");
	}

	localServerOrigin = `http://127.0.0.1:${address.port}`;

	return {
		origin: localServerOrigin,
		close: () =>
			new Promise((resolvePromise, rejectPromise) => {
				server.close((error) => {
					if (error) {
						rejectPromise(error);
						return;
					}

					resolvePromise();
				});
			}),
	};
};
