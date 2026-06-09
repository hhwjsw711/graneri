import { createServer } from "node:http";
import { openai } from "@ai-sdk/openai";
import {
	consumeStream,
	createAgentUIStream,
	pipeUIMessageStreamToResponse,
	stepCountIs,
	ToolLoopAgent,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { buildChatAutomationContext } from "../../../packages/ai/src/automation-tools.mjs";
import {
	buildSelectedAppSourceInstructions,
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
} from "../../../packages/ai/src/capability-metadata.mjs";
import {
	createChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "../../../packages/ai/src/chat-latency-logger.mjs";
import { buildCoreChatToolPolicy } from "../../../packages/ai/src/chat-tool-policy.mjs";
import { buildConvexWorkspaceToolSet } from "../../../packages/ai/src/convex-workspace-tools.mjs";
import {
	buildHostedChatRuntimePrompt,
	clampHostedNoteContext,
	generateHostedChatMessageId,
	generateHostedChatTitle,
	getHostedChatPreviewFromMessage,
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
	toHostedStoredMessage,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import {
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
} from "../../../packages/ai/src/local-folder-tools.mjs";
import {
	CHAT_SERVER_MODELS,
	getChatModelProviderOptions,
	normalizeReasoningEffort,
} from "../../../packages/ai/src/models.mjs";
import { finalizeOpenAIToolSet } from "../../../packages/ai/src/openai-tool-search.mjs";
import {
	proxyHostedAiRequest,
	shouldProxyHostedAiRequest,
} from "./local-server-hosted-proxy.mjs";
import {
	isAuthorizedLocalAppRequest,
	readJsonBody,
	sendJson,
	setCorsHeadersForLocalAppRequest,
} from "./local-server-http.mjs";
import { createLocalFolderToolRouteHandler } from "./local-server-local-folder-route.mjs";
import {
	handleApplyTemplateRequest,
	handleEnhanceNoteRequest,
} from "./local-server-note-routes.mjs";
import { handleRealtimeTranscriptionSessionRequest } from "./local-server-realtime-route.mjs";

const AI_LATENCY_DEBUG_ENABLED = process.env.GRANERI_AI_LATENCY_DEBUG === "1";

const chatModels = CHAT_SERVER_MODELS;
const fallbackChatModel = chatModels[0];
const preferredLocalServerPorts = Array.from(
	{ length: 20 },
	(_value, index) => 42831 + index,
);
const GRANERI_MARK_SVG = `
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
		<title>Graneri</title>
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
			<div class="mark">${GRANERI_MARK_SVG}</div>
			<h1>Authentication complete</h1>
			<p>Return to Graneri to continue. You can close this window if it stays open.</p>
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
			? `Current note content:\n${clampHostedNoteContext(note.searchableText)}`
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

const handleChatRequest = async ({
	getSharedLocalFolders,
	request,
	response,
}) => {
	const requestBody = await readJsonBody(request);
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
	} = requestBody;
	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: "/api/chat",
			request,
			response,
			bodyOverride: JSON.stringify(requestBody),
			headersOverride: {
				"content-type": "application/json",
				"content-length": null,
			},
		});
		return;
	}

	if (!process.env.OPENAI_API_KEY) {
		sendJson(response, 500, {
			error: "OPENAI_API_KEY is not configured.",
		});
		return;
	}
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
	logLatency("chat.messages_validated", {
		chatMessageCount: chatMessages.length,
	});
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
		convexToken,
		recipeSlug,
		workspaceId: resolvedWorkspaceId,
	});
	const recipeContext = getHostedChatRecipeContext(selectedRecipe);
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
	const coreToolPolicy = buildCoreChatToolPolicy({
		chatAttachmentsApi: api.chatAttachments,
		convexClient,
		message,
		webSearchEnabled,
	});
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
	const enabledTools = {
		...coreToolPolicy.enabledTools,
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
		prepareStep: coreToolPolicy.prepareStep,
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
		generateMessageId: generateHostedChatMessageId,
		onFinish: async ({ responseMessage }) => {
			logLatency("stream.finish", streamLatencyTracker.getFinishDetails());

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
	logLatency("ai.stream_created");
	const timedStream = streamLatencyTracker.wrapStream(stream);

	pipeUIMessageStreamToResponse({
		response,
		stream: timedStream,
		consumeSseStream: consumeStream,
	});
};

export const startLocalServer = async ({
	getAllowedOrigins,
	getSharedLocalFolders,
	onAuthCallback,
} = {}) => {
	let localServerOrigin = null;
	const localAppRoutes = new Map([
		[
			"/api/local-folder-tool",
			createLocalFolderToolRouteHandler({
				getSharedLocalFolders,
			}),
		],
		[
			"/api/chat",
			(request, response) =>
				handleChatRequest({
					getSharedLocalFolders,
					request,
					response,
				}),
		],
		["/api/apply-template", handleApplyTemplateRequest],
		[
			"/api/realtime-transcription-session",
			handleRealtimeTranscriptionSessionRequest,
		],
		["/api/enhance-note", handleEnhanceNoteRequest],
	]);
	const server = createServer((request, response) => {
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const requestPath = requestUrl.pathname;
		const localAppRouteHandler = localAppRoutes.get(requestPath);
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

		if (localAppRouteHandler) {
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

			if (request.method !== "POST") {
				sendJson(response, 405, { error: "Method not allowed." });
				return;
			}

			void localAppRouteHandler(request, response).catch((error) => {
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				sendJson(response, 500, { error: message });
			});
			return;
		}

		response.statusCode = 404;
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ error: "Not found." }));
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
