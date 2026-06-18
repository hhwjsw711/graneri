import { createServer } from "node:http";
import {
	consumeStream,
	createAgentUIStream,
	pipeUIMessageStreamToResponse,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { buildChatAutomationContext } from "../../../packages/ai/src/automation-tools.mjs";
import {
	buildSelectedAppSourceInstructions,
	getSelectedNoteSourceIds,
	loadSelectedAppSourceConnections,
} from "../../../packages/ai/src/capability-metadata.mjs";
import {
	createChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "../../../packages/ai/src/chat-latency-logger.mjs";
import { buildCoreChatToolPolicy } from "../../../packages/ai/src/chat-tool-policy.mjs";
import { buildConvexWorkspaceToolSet } from "../../../packages/ai/src/convex-workspace-tools.mjs";
import {
	createHostedActiveChatStreamSession,
	createHostedActiveStreamKey,
	pipeHostedActiveStreamText,
} from "../../../packages/ai/src/hosted-chat-active-stream.mjs";
import { getBearerTokenFromAuthorizationHeader } from "../../../packages/ai/src/hosted-chat-http.mjs";
import { stopOrphanedHostedAssistantRun } from "../../../packages/ai/src/hosted-chat-orphaned-run.mjs";
import { createHostedAssistantRunFinalizationQueue } from "../../../packages/ai/src/hosted-chat-run-finalization-queue.mjs";
import { createHostedAssistantRunFinalizer } from "../../../packages/ai/src/hosted-chat-run-finalizer.mjs";
import { buildHostedChatRunPlan } from "../../../packages/ai/src/hosted-chat-run-plan.mjs";
import {
	buildHostedChatSaveMessageArgs,
	buildHostedNotesContext,
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
	getStoredHostedNoteContext,
	prepareHostedChatBranch,
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
import { createAuthCallbackSuccessHtml } from "./local-server-auth-callback-page.mjs";
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
import {
	createWideEvent,
	emitWideEvent,
	logError,
	recordWideEventError,
} from "./logger.mjs";

const AI_LATENCY_DEBUG_ENABLED = process.env.GRANERI_AI_LATENCY_DEBUG === "1";
const activeChatStreamControllers = new Map();

const chatModels = CHAT_SERVER_MODELS;
const fallbackChatModel = chatModels[0];
const preferredLocalServerPorts = Array.from(
	{ length: 20 },
	(_value, index) => 42831 + index,
);

const emitLocalRequestWideEventOnCompletion = ({
	event,
	response,
	startedAt,
}) => {
	let emitted = false;

	const emit = (level) => {
		if (emitted) {
			return;
		}

		emitted = true;
		event.status_code ??= response.statusCode;
		event.outcome ??=
			typeof event.status_code === "number" && event.status_code >= 400
				? "error"
				: "success";
		emitWideEvent({ event, level, startedAt });
	};

	response.once("finish", () => {
		emit(event.outcome === "error" || event.errors?.length ? "error" : "info");
	});
	response.once("close", () => {
		if (response.writableEnded) {
			return;
		}

		event.outcome = "error";
		event.error_code = "client_connection_closed";
		emit("error");
	});

	return emit;
};

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const getConvexErrorCode = (error) => {
	if (!error || typeof error !== "object" || !("data" in error)) {
		return null;
	}

	const data = error.data;
	if (!data || typeof data !== "object" || !("code" in data)) {
		return null;
	}

	return typeof data.code === "string" ? data.code : null;
};

const isConvexErrorCode = (error, code) => getConvexErrorCode(error) === code;

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

	return buildHostedNotesContext(notes);
};

const getSelectedAppConnections = async ({
	convexToken,
	selectedSourceIds,
	workspaceId,
}) => {
	if (!convexToken || !workspaceId) {
		return [];
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });

	return await loadSelectedAppSourceConnections({
		selectedSourceIds,
		listGoogleSources: async () =>
			await client.action(api.googleTools.listAvailableSources, {
				workspaceId,
			}),
		getAppConnections: async (sourceIds) =>
			await client.action(
				api.appConnectionActions.getSelectedForChatWithFreshTokens,
				{
					workspaceId,
					sourceIds,
				},
			),
	});
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

	return getStoredHostedNoteContext(note);
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
		trigger,
		allowConcurrentRun = false,
		supersedeActiveRun = false,
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
	if (!id || !convexToken || !resolvedWorkspaceId) {
		sendJson(response, 400, {
			error: "chat id, convexToken, and workspaceId are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});
	const storedChat = await convexClient.query(api.chats.getSession, {
		workspaceId: resolvedWorkspaceId,
		chatId: id,
	});
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
	const storedChatMessages = message
		? await convexClient.query(api.chats.getMessagesSnapshot, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			})
		: [];
	const preparedBranch = prepareHostedChatBranch({
		message,
		messageId,
		messages,
		storedMessages: message ? storedChatMessages : [],
		trigger,
	});
	const shouldTruncateChatBranch = preparedBranch.shouldTruncateChatBranch;

	if (shouldTruncateChatBranch && preparedBranch.truncateMessageId) {
		try {
			await convexClient.mutation(api.chats.truncateFromMessage, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				messageId: preparedBranch.truncateMessageId,
			});
		} catch (error) {
			logError({
				error: error,
				message: "Failed to truncate regenerated chat message branch",
			});
		}
	}
	logLatency("chat.branch_ready", {
		incomingMessageCount: preparedBranch.incomingMessages.length,
		shouldTruncateChatBranch,
	});
	const chatMessages = await validateUIMessages({
		messages: preparedBranch.incomingMessages,
	});
	const lastUserMessage =
		message?.role === "user"
			? message
			: [...chatMessages]
					.reverse()
					.find((currentMessage) => currentMessage.role === "user");
	const shouldGenerateChatTitle = Boolean(
		lastUserMessage && (!storedChat || storedChat.title === "New chat"),
	);
	logLatency("chat.messages_validated", {
		chatMessageCount: chatMessages.length,
	});
	const attachableRun = await convexClient.query(
		api.assistantRuns.getAttachableRun,
		{
			workspaceId: resolvedWorkspaceId,
			chatId: id,
		},
	);

	if (
		trigger !== "regenerate-message" &&
		!allowConcurrentRun &&
		!supersedeActiveRun
	) {
		if (attachableRun) {
			sendJson(response, 409, {
				error: "Chat already has an active assistant run.",
			});
			return;
		}
	}
	if (lastUserMessage) {
		try {
			await convexClient.mutation(
				api.chats.saveMessage,
				buildHostedChatSaveMessageArgs({
					workspaceId: resolvedWorkspaceId,
					chatId: id,
					noteId: resolvedNoteId,
					model: selectedModel.model,
					reasoningEffort: resolvedReasoningEffort,
					message: lastUserMessage,
				}),
			);
		} catch (error) {
			logError({
				error: error,
				message: "Failed to persist user chat message",
			});
		}
	}
	logLatency("convex.user_message_saved", {
		attempted: Boolean(lastUserMessage),
	});

	const notesContext = await getNotesContext({
		convexToken,
		mentions,
		workspaceId: resolvedWorkspaceId,
	});
	const attachedNoteContext = resolvedNoteId
		? await getStoredNoteContext({
				convexToken,
				noteId: resolvedNoteId,
				workspaceId: resolvedWorkspaceId,
			})
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
	const userProfileContext = await convexClient.query(
		api.userPreferences.getAiProfileContext,
		{},
	);
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
		createAutomation: async (automation) =>
			await convexClient.mutation(api.automations.create, {
				workspaceId: resolvedWorkspaceId,
				...automation,
			}),
		defaultModel: selectedModel.model,
		defaultReasoningEffort: resolvedReasoningEffort,
		defaultTimezone: resolvedTimezone,
		webSearchEnabled,
	});
	const { agent, finalizedToolSet, systemPrompt } = buildHostedChatRunPlan({
		appTools,
		automationContext,
		context: {
			notesContext,
			attachedNoteContext,
			recipeContext,
			userProfileContext,
		},
		coreToolPolicy,
		localFolderContext,
		localFolderTools:
			localFolderRoots.length > 0
				? buildLocalFolderTools(localFolderRoots)
				: {},
		model: selectedModel.model,
		providerOptions,
		selectedAppSourceInstructions,
		webSearchEnabled,
	});
	logLatency("tools.finalized", {
		deferredToolCount: finalizedToolSet.deferredToolCount,
		hasEnabledTools: finalizedToolSet.hasTools,
		hasToolSearch: finalizedToolSet.hasToolSearch,
		toolCount: finalizedToolSet.toolCount,
	});
	const assistantMessageId = `stream-${crypto.randomUUID()}`;
	const assistantRun = await convexClient.mutation(
		api.assistantRuns.startAssistantRun,
		{
			workspaceId: resolvedWorkspaceId,
			chatId: id,
			assistantMessageId,
			model: selectedModel.model,
			reasoningEffort: resolvedReasoningEffort,
			policy:
				trigger === "regenerate-message" || supersedeActiveRun
					? "supersede"
					: allowConcurrentRun
						? "allow_concurrent"
						: "reject",
		},
	);

	const activeStreamSession = createHostedActiveChatStreamSession({
		controllers: activeChatStreamControllers,
		workspaceId: resolvedWorkspaceId,
		chatId: id,
		messageId: assistantMessageId,
		runId: assistantRun._id,
		callbacks: {
			startActiveStream: (args) =>
				convexClient.mutation(api.chats.startActiveStream, args),
			appendActiveStreamText: (args) =>
				convexClient.mutation(api.chats.appendActiveStreamText, args),
			finishActiveStream: (args) =>
				convexClient.mutation(api.chats.deleteActiveStreamSnapshot, args),
			startActiveStreamToolCall: (args) =>
				convexClient.mutation(
					api.chatToolCalls.startActiveStreamToolCall,
					args,
				),
			finishActiveStreamToolCall: (args) =>
				convexClient.mutation(
					api.chatToolCalls.finishActiveStreamToolCall,
					args,
				),
		},
	});

	if (allowConcurrentRun && attachableRun) {
		try {
			await convexClient.mutation(api.chats.deleteActiveStreamSnapshot, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				runId: attachableRun._id,
			});
		} catch (error) {
			if (!isConvexErrorCode(error, "ACTIVE_STREAM_NOT_FOUND")) {
				throw error;
			}
		}
	}

	await activeStreamSession.start();
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});
	let finalizationQueue = null;
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const streamLatencyTracker = createChatStreamLatencyTracker(logLatency);
	const stream = await (async () => {
		try {
			return await createAgentUIStream({
				agent,
				uiMessages: chatMessages,
				abortSignal: activeStreamSession.abortSignal,
				originalMessages: chatMessages,
				generateMessageId: () => assistantMessageId,
				onFinish: ({ isAborted, responseMessage }) => {
					logLatency("stream.finish", streamLatencyTracker.getFinishDetails());
					if (isAborted) {
						return;
					}

					finalizationQueue?.setTerminalization({
						responseMessage,
						status: "completed",
					});
				},
				onError: () => "Something went wrong.",
			});
		} catch (error) {
			await convexClient.mutation(api.assistantRuns.failAssistantRun, {
				runId: assistantRun._id,
				errorText: error instanceof Error ? error.message : "Unknown error",
			});
			activeStreamSession.cleanup();
			throw error;
		}
	})();
	logLatency("ai.stream_created");
	const finalizeAssistantRun = createHostedAssistantRunFinalizer({
		activeStreamSession,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		chatId: id,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finishAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.finishAssistantRun, args),
		lastUserMessage,
		logError: ({ error, terminalization }) => {
			logError({
				error,
				message:
					terminalization.status === "completed"
						? "Failed to persist assistant chat message"
						: "Failed to finalize assistant chat stream",
			});
		},
		logLatency,
		model: selectedModel.model,
		noteId: resolvedNoteId,
		onTitleGenerationError: ({ error }) => {
			logError({
				error,
				message: "Failed to generate chat title",
			});
		},
		reasoningEffort: resolvedReasoningEffort,
		saveAssistantMessageForRun: (args) =>
			convexClient.mutation(api.chats.saveAssistantMessageForRun, args),
		shouldGenerateChatTitle,
		updateChatTitle: (args) =>
			convexClient.mutation(api.chats.updateTitle, args),
		workspaceId: resolvedWorkspaceId,
	});
	finalizationQueue = createHostedAssistantRunFinalizationQueue({
		finalizeAssistantRun,
		logLatency,
		runId: assistantRun._id,
	});
	const persistedStream = pipeHostedActiveStreamText({
		onFlush: async () => {
			await finalizationQueue?.flushAfterClientStream();
		},
		persister: activeStreamSession,
		stream: streamLatencyTracker.wrapStream(stream),
	});
	const responseStream = activeStreamSession.startBroadcast(persistedStream);

	pipeUIMessageStreamToResponse({
		response,
		stream: responseStream,
		consumeSseStream: consumeStream,
	});
};

const handleChatStopRequest = async (request, response) => {
	const { id, workspaceId, convexToken } = await readJsonBody(request);
	const resolvedWorkspaceId = workspaceId ?? null;

	if (!id || !resolvedWorkspaceId || !convexToken) {
		sendJson(response, 400, {
			error: "id, workspaceId, and convexToken are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});

	const attachableRun = await convexClient.query(
		api.assistantRuns.getAttachableRun,
		{
			workspaceId: resolvedWorkspaceId,
			chatId: id,
		},
	);

	if (!attachableRun) {
		sendJson(response, 200, { ok: true });
		return;
	}

	const stopIntentPromise =
		attachableRun.status === "stopping"
			? Promise.resolve()
			: convexClient.mutation(api.assistantRuns.requestStopAssistantRun, {
					runId: attachableRun._id,
					stopReason: "user_requested",
				});
	const streamKey = createHostedActiveStreamKey({
		workspaceId: resolvedWorkspaceId,
		chatId: id,
	});
	const activeSession = activeChatStreamControllers.get(streamKey);
	activeSession?.abort("stopped");
	if (activeSession) {
		activeSession.cleanup();
	}

	await Promise.all([
		stopIntentPromise,
		convexClient.mutation(api.chats.stopActiveStream, {
			workspaceId: resolvedWorkspaceId,
			chatId: id,
			runId: attachableRun._id,
		}),
	]);
	await convexClient.mutation(api.assistantRuns.finishStoppedAssistantRun, {
		runId: attachableRun._id,
	});

	sendJson(response, 200, { ok: true });
};

const handleChatReconnectRequest = async (request, response) => {
	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
	const match = /^\/api\/chat\/([^/]+)\/stream$/.exec(requestUrl.pathname);
	const id = match?.[1] ? decodeURIComponent(match[1]) : null;
	const workspaceId = requestUrl.searchParams.get("workspaceId");
	const convexToken = getBearerTokenFromAuthorizationHeader(
		request.headers.authorization,
	);

	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: requestUrl.pathname + requestUrl.search,
			request,
			response,
			responseMode: "stream",
		});
		return;
	}

	if (!id || !workspaceId || !convexToken) {
		sendJson(response, 400, {
			error: "chat id, workspaceId, and convexToken are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});
	const attachableRun = await convexClient.query(
		api.assistantRuns.getAttachableRun,
		{
			workspaceId,
			chatId: id,
		},
	);

	if (!attachableRun) {
		response.statusCode = 204;
		response.end();
		return;
	}

	const streamKey = createHostedActiveStreamKey({
		workspaceId,
		chatId: id,
	});
	const activeSession = activeChatStreamControllers.get(streamKey);

	if (!activeSession || activeSession.persister.runId !== attachableRun._id) {
		await stopOrphanedHostedAssistantRun({
			chatId: id,
			finishStoppedAssistantRun: (args) =>
				convexClient.mutation(
					api.assistantRuns.finishStoppedAssistantRun,
					args,
				),
			logLatency: createChatLatencyLogger({
				chatId: id,
				enabled: AI_LATENCY_DEBUG_ENABLED,
			}),
			requestStopAssistantRun: (args) =>
				convexClient.mutation(api.assistantRuns.requestStopAssistantRun, args),
			runId: attachableRun._id,
			stopActiveStream: (args) =>
				convexClient.mutation(api.chats.stopActiveStream, args),
			workspaceId,
		});
		response.statusCode = 204;
		response.end();
		return;
	}

	pipeUIMessageStreamToResponse({
		response,
		stream: activeSession.subscribe(),
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
		["/api/chat/stop", handleChatStopRequest],
		["/api/apply-template", handleApplyTemplateRequest],
		[
			"/api/realtime-transcription-session",
			handleRealtimeTranscriptionSessionRequest,
		],
		["/api/enhance-note", handleEnhanceNoteRequest],
	]);
	const server = createServer((request, response) => {
		const startedAt = Date.now();
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const requestPath = requestUrl.pathname;
		const localAppRouteHandler =
			localAppRoutes.get(requestPath) ??
			(/^\/api\/chat\/[^/]+\/stream$/.test(requestPath)
				? handleChatReconnectRequest
				: null);
		const isReconnectRoute =
			localAppRouteHandler === handleChatReconnectRequest;
		const allowedOrigins = [
			localServerOrigin,
			...(typeof getAllowedOrigins === "function" ? getAllowedOrigins() : []),
		];

		if (requestPath === "/auth/callback") {
			const wideEvent = createWideEvent({
				event: "desktop.auth_callback.request",
				request,
			});
			wideEvent.route = "auth_callback";
			emitLocalRequestWideEventOnCompletion({
				event: wideEvent,
				response,
				startedAt,
			});
			void Promise.resolve(onAuthCallback?.(requestUrl.toString()))
				.then(() => {
					wideEvent.outcome = "success";
					wideEvent.status_code = 200;
					response.statusCode = 200;
					response.setHeader("Content-Type", "text/html; charset=utf-8");
					response.end(createAuthCallbackSuccessHtml());
				})
				.catch((error) => {
					wideEvent.outcome = "error";
					wideEvent.status_code = 500;
					wideEvent.error_code = "auth_callback_failed";
					recordWideEventError({
						error,
						event: wideEvent,
						operation: "auth_callback",
					});
					const message =
						error instanceof Error ? error.message : "Authentication failed.";
					response.statusCode = 500;
					response.setHeader("Content-Type", "text/plain; charset=utf-8");
					response.end(message);
				});
			return;
		}

		if (localAppRouteHandler) {
			const wideEvent = createWideEvent({
				event: "desktop.local_api.request",
				request,
			});
			wideEvent.route = requestPath;
			wideEvent.is_reconnect_route = isReconnectRoute;
			wideEvent.request_origin = request.headers.origin ?? null;
			emitLocalRequestWideEventOnCompletion({
				event: wideEvent,
				response,
				startedAt,
			});

			if (request.method === "OPTIONS") {
				if (
					setCorsHeadersForLocalAppRequest(request, response, allowedOrigins)
				) {
					wideEvent.outcome = "success";
					wideEvent.status_code = 204;
					wideEvent.cors_preflight = true;
					response.statusCode = 204;
					response.end();
					return;
				}
			}

			if (!isAuthorizedLocalAppRequest(request, allowedOrigins)) {
				wideEvent.outcome = "error";
				wideEvent.status_code = 403;
				wideEvent.error_code = "forbidden_origin";
				sendJson(response, 403, {
					error: "Forbidden",
				});
				return;
			}

			setCorsHeadersForLocalAppRequest(request, response, allowedOrigins);

			if (isReconnectRoute && request.method !== "GET") {
				wideEvent.outcome = "error";
				wideEvent.status_code = 405;
				wideEvent.error_code = "method_not_allowed";
				sendJson(response, 405, { error: "Method not allowed." });
				return;
			}

			if (!isReconnectRoute && request.method !== "POST") {
				wideEvent.outcome = "error";
				wideEvent.status_code = 405;
				wideEvent.error_code = "method_not_allowed";
				sendJson(response, 405, { error: "Method not allowed." });
				return;
			}

			void localAppRouteHandler(request, response).catch((error) => {
				wideEvent.outcome = "error";
				wideEvent.status_code = 500;
				wideEvent.error_code = "route_handler_failed";
				recordWideEventError({
					error,
					event: wideEvent,
					operation: "route_handler",
				});
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				sendJson(response, 500, { error: message });
			});
			return;
		}

		const wideEvent = createWideEvent({
			event: "desktop.local_api.request",
			request,
		});
		wideEvent.route = requestPath;
		wideEvent.outcome = "error";
		wideEvent.status_code = 404;
		wideEvent.error_code = "route_not_found";
		emitLocalRequestWideEventOnCompletion({
			event: wideEvent,
			response,
			startedAt,
		});
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
