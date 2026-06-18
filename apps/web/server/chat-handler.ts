import type { IncomingMessage, ServerResponse } from "node:http";
import {
	consumeStream,
	createAgentUIStream,
	type InferUITools,
	pipeUIMessageStreamToResponse,
	type UIMessage,
	type UIMessageChunk,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
	type HostedActiveStreamSession,
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
	generateHostedChatMessageId,
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
	getStoredHostedNoteContext,
	prepareHostedChatBranch,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import {
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
	resolveLocalFolderRoots,
} from "../../../packages/ai/src/local-folder-tools.mjs";
import {
	findChatModel,
	getChatModelProviderOptions,
	normalizeReasoningEffort,
} from "../src/lib/ai/models";
import {
	createServerWideEvent,
	emitServerWideEvent,
	recordServerError,
} from "./server-logger";

type ChatRequestBody = {
	id?: string;
	workspaceId?: string | null;
	trigger?: "submit-message" | "regenerate-message";
	messageId?: string;
	message?: UIMessage;
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

const activeChatStreamControllers = new Map<
	string,
	HostedActiveStreamSession
>();
const AI_LATENCY_DEBUG_ENABLED = process.env.GRANERI_AI_LATENCY_DEBUG === "1";

const canUseLocalFolderTools = () => process.env.GRANERI_ENV_MODE === "local";

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const getNotesContext = async ({
	convexToken,
	mentions,
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "mentions" | "workspaceId">) => {
	if (!convexToken || !workspaceId) {
		return "";
	}

	const noteIds = getSelectedNoteSourceIds({ mentions }) as Id<"notes">[];
	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const notes =
		noteIds.length > 0
			? await client.query(api.notes.getChatContext, {
					workspaceId: workspaceId as Id<"workspaces">,
					ids: noteIds,
				})
			: [];

	return buildHostedNotesContext(notes);
};

const getSelectedAppConnections = async ({
	convexToken,
	selectedSourceIds,
	workspaceId,
}: Pick<
	ChatRequestBody,
	"convexToken" | "selectedSourceIds" | "workspaceId"
>) => {
	if (!convexToken || !workspaceId) {
		return [];
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });

	return await loadSelectedAppSourceConnections({
		selectedSourceIds,
		listGoogleSources: async () =>
			await client.action(api.googleTools.listAvailableSources, {
				workspaceId: workspaceId as Id<"workspaces">,
			}),
		getAppConnections: async (sourceIds) =>
			await client.action(
				api.appConnectionActions.getSelectedForChatWithFreshTokens,
				{
					workspaceId: workspaceId as Id<"workspaces">,
					sourceIds,
				},
			),
	});
};

const getSelectedRecipe = async ({
	convexToken,
	recipeSlug,
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "recipeSlug" | "workspaceId">) => {
	if (!convexToken || !recipeSlug || !workspaceId) {
		return null;
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const recipes = await client.query(api.recipes.list, {
		workspaceId: workspaceId as Id<"workspaces">,
	});

	return recipes.find((recipe) => recipe.slug === recipeSlug) ?? null;
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

	return JSON.parse(rawBody) as ChatRequestBody;
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

const getStoredNoteContext = async ({
	client,
	noteId,
	workspaceId,
}: {
	client: ConvexHttpClient;
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
}) => {
	const notes = await client.query(api.notes.getChatContext, {
		workspaceId,
		ids: [noteId],
	});
	const note = notes[0];

	return getStoredHostedNoteContext(note);
};

export const handleChatRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "chat.request",
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

	const {
		id,
		trigger,
		messageId,
		message,
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
	wideEvent.chat_id = id ?? null;
	wideEvent.workspace_id = workspaceId ?? null;
	wideEvent.trigger = trigger ?? null;
	wideEvent.model = model ?? null;
	wideEvent.reasoning_effort = reasoningEffort ?? null;
	wideEvent.web_search_enabled = webSearchEnabled;
	wideEvent.apps_enabled = appsEnabled;
	wideEvent.mention_count = mentions?.length ?? 0;
	wideEvent.selected_source_count = selectedSourceIds?.length ?? 0;
	wideEvent.local_folder_count = localFolders.length;
	wideEvent.has_note_context = Boolean(noteContext);
	wideEvent.has_recipe = Boolean(recipeSlug);
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

	const resolvedWorkspaceId =
		(workspaceId as Id<"workspaces"> | null | undefined) ?? null;
	const resolvedTimezone = timezone?.trim() || "UTC";

	if (!message) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "message_missing";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "message is required.",
		});
		return;
	}

	if (!id || !convexToken || !resolvedWorkspaceId) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "chat_auth_context_missing";
		emitWideEvent("error");
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
	const requestedModel = model ?? storedChat?.model ?? null;

	if (!requestedModel) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "model_missing";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "model is required.",
		});
		return;
	}

	const resolvedModel = findChatModel(requestedModel);

	if (!resolvedModel) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "model_unsupported";
		wideEvent.requested_model = requestedModel;
		emitWideEvent("error");
		sendJson(response, 400, {
			error: `Unsupported model: ${requestedModel}.`,
		});
		return;
	}
	const requestedReasoningEffort =
		reasoningEffort ?? storedChat?.reasoningEffort ?? undefined;
	const resolvedReasoningEffort = normalizeReasoningEffort(
		requestedReasoningEffort,
	);
	const providerOptions = getChatModelProviderOptions(resolvedModel.model, {
		reasoningEffort: resolvedReasoningEffort,
	});
	logLatency("chat.model_resolved", {
		hasProviderOptions: Boolean(providerOptions),
		model: resolvedModel.model,
		reasoningEffort: resolvedReasoningEffort,
	});

	const resolvedNoteId =
		(noteContext?.noteId as Id<"notes"> | null | undefined) ??
		storedChat?.noteId ??
		null;
	const storedChatMessages = await convexClient.query(
		api.chats.getMessagesSnapshot,
		{
			workspaceId: resolvedWorkspaceId,
			chatId: id,
		},
	);
	logLatency("convex.messages_loaded", {
		messageCount: storedChatMessages.length,
	});
	const preparedBranch = prepareHostedChatBranch({
		message,
		messageId,
		storedMessages: storedChatMessages,
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
			recordServerError({
				details: {
					message_id: preparedBranch.truncateMessageId,
				},
				error,
				event: wideEvent,
				operation: "branch_truncate",
			});
		}
	}
	logLatency("chat.branch_ready", {
		incomingMessageCount: preparedBranch.incomingMessages.length,
		shouldTruncateChatBranch,
	});

	const notesContext = await getNotesContext({
		convexToken,
		mentions,
		workspaceId,
	});
	const attachedNoteContext = resolvedNoteId
		? await getStoredNoteContext({
				client: convexClient,
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
				workspaceId,
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
	const localFolderRoots = canUseLocalFolderTools()
		? await resolveLocalFolderRoots(
				localFolders.reduce<string[]>((paths, folder) => {
					if (typeof folder?.path === "string" && folder.path.length > 0) {
						paths.push(folder.path);
					}
					return paths;
				}, []),
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
		defaultModel: resolvedModel.model,
		defaultReasoningEffort: resolvedReasoningEffort,
		defaultTimezone: resolvedTimezone,
		webSearchEnabled,
	});
	const { agent, finalizedToolSet, systemPrompt, tools } =
		buildHostedChatRunPlan({
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
			model: resolvedModel.model,
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
	const chatMessages = await validateUIMessages<
		UIMessage<unknown, never, InferUITools<typeof tools>>
	>({
		messages: preparedBranch.incomingMessages,
		tools,
	});
	logLatency("chat.messages_validated", {
		chatMessageCount: chatMessages.length,
	});
	const lastUserMessage =
		message.role === "user"
			? message
			: [...chatMessages]
					.reverse()
					.find((currentMessage) => currentMessage.role === "user");
	const shouldGenerateChatTitle = Boolean(
		lastUserMessage && (!storedChat || storedChat.title === "New chat"),
	);
	if (trigger !== "regenerate-message") {
		const attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);

		if (attachableRun) {
			wideEvent.outcome = "error";
			wideEvent.status_code = 409;
			wideEvent.error_code = "active_run_exists";
			wideEvent.active_run_id = attachableRun._id;
			emitWideEvent("error");
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
					model: resolvedModel.model,
					reasoningEffort: resolvedReasoningEffort,
					message: lastUserMessage,
				}),
			);
		} catch (error) {
			recordServerError({
				details: {
					message_id: lastUserMessage.id,
				},
				error,
				event: wideEvent,
				operation: "user_message_persist",
			});
		}
	}
	logLatency("convex.user_message_saved", {
		attempted: Boolean(lastUserMessage),
	});

	const assistantMessageId = `stream-${crypto.randomUUID()}`;
	const assistantRun = await convexClient.mutation(
		api.assistantRuns.startAssistantRun,
		{
			workspaceId: resolvedWorkspaceId,
			chatId: id,
			assistantMessageId,
			model: resolvedModel.model,
			reasoningEffort: resolvedReasoningEffort,
			policy: trigger === "regenerate-message" ? "supersede" : "reject",
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

	await activeStreamSession.start();
	wideEvent.assistant_run_id = assistantRun._id;
	wideEvent.assistant_message_id = assistantMessageId;
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});

	let finalizationQueue: ReturnType<
		typeof createHostedAssistantRunFinalizationQueue
	> | null = null;
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const streamLatencyTracker =
		createChatStreamLatencyTracker<UIMessageChunk>(logLatency);
	const stream = await (async () => {
		try {
			return await createAgentUIStream({
				agent,
				uiMessages: chatMessages,
				abortSignal: activeStreamSession.abortSignal,
				originalMessages: chatMessages,
				generateMessageId: generateHostedChatMessageId,
				sendReasoning: true,
				sendSources: true,
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
			recordServerError({
				error,
				event: wideEvent,
				operation: "stream_create",
			});
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_create_failed";
			emitWideEvent("error");
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
		assistantRunId: assistantRun._id,
		chatId: id,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finishAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.finishAssistantRun, args),
		lastUserMessage,
		logError: ({ error, terminalization }) => {
			recordServerError({
				details:
					terminalization.status === "completed"
						? {
								message_id: terminalization.responseMessage.id,
								run_id: assistantRun._id,
							}
						: { run_id: assistantRun._id },
				error,
				event: wideEvent,
				operation:
					terminalization.status === "completed"
						? "assistant_message_persist"
						: "stream_finalize",
			});
		},
		logLatency,
		model: resolvedModel.model,
		noteId: resolvedNoteId,
		onCompleted: () => {
			wideEvent.outcome = "success";
			wideEvent.status_code = 200;
			emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		},
		onFailed: () => {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "assistant_run_failed";
			emitWideEvent("error");
		},
		onFinalizeError: () => {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_finalize_failed";
			emitWideEvent("error");
		},
		onTitleGenerationError: ({ error, responseMessage }) => {
			recordServerError({
				details: {
					message_id: responseMessage.id,
					run_id: assistantRun._id,
				},
				error,
				event: wideEvent,
				operation: "chat_title_generate",
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
			await finalizationQueue?.flush();
		},
		persister: activeStreamSession,
		stream: streamLatencyTracker.wrapStream(stream),
	});
	const responseStream = activeStreamSession.startBroadcast(persistedStream);
	wideEvent.tool_count = finalizedToolSet.toolCount;
	wideEvent.deferred_tool_count = finalizedToolSet.deferredToolCount;
	wideEvent.local_folder_root_count = localFolderRoots.length;
	wideEvent.app_connection_count = selectedAppConnections.length;

	pipeUIMessageStreamToResponse({
		response,
		stream: responseStream,
		consumeSseStream: consumeStream,
	});
};

export const handleChatStopRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const { id, workspaceId, convexToken } = await readJsonBody(request);
	const resolvedWorkspaceId =
		(workspaceId as Id<"workspaces"> | null | undefined) ?? null;

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

export const handleChatReconnectRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
	const match = /^\/api\/chat\/([^/]+)\/stream$/.exec(requestUrl.pathname);
	const id = match?.[1] ? decodeURIComponent(match[1]) : null;
	const workspaceId = requestUrl.searchParams.get(
		"workspaceId",
	) as Id<"workspaces"> | null;
	const convexToken = getBearerTokenFromAuthorizationHeader(
		request.headers.authorization,
	);

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
		stream: activeSession.subscribe<UIMessageChunk>(),
		consumeSseStream: consumeStream,
	});
};
