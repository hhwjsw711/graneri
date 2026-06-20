import { createServer } from "node:http";
import {
	consumeStream,
	pipeUIMessageStreamToResponse,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import {
	getSelectedNoteSourceIds,
	loadSelectedAppSourceConnections,
} from "../../../packages/ai/src/capability-metadata.mjs";
import {
	createChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "../../../packages/ai/src/chat-latency-logger.mjs";
import { createHostedActiveStreamKey } from "../../../packages/ai/src/hosted-chat-active-stream.mjs";
import { prepareHostedChatTurnBranch } from "../../../packages/ai/src/hosted-chat-branch-preparer.mjs";
import { getBearerTokenFromAuthorizationHeader } from "../../../packages/ai/src/hosted-chat-http.mjs";
import { stopOrphanedHostedAssistantRun } from "../../../packages/ai/src/hosted-chat-orphaned-run.mjs";
import { createHostedChatQueuedInput } from "../../../packages/ai/src/hosted-chat-queued-input.mjs";
import {
	buildHostedChatRunContext,
	getHostedChatLocalFolderReferenceIds,
} from "../../../packages/ai/src/hosted-chat-run-context.mjs";
import { createHostedAssistantRunFinalizer } from "../../../packages/ai/src/hosted-chat-run-finalizer.mjs";
import { startHostedChatRun } from "../../../packages/ai/src/hosted-chat-run-starter.mjs";
import {
	buildHostedNotesContext,
	getHostedChatConvexRouteError,
	getHostedChatInputValidationErrorResponse,
	getStoredHostedNoteContext,
	validateHostedChatActiveRunPolicy,
	validateHostedChatInput,
	validateHostedChatRequestInput,
	validateHostedChatSteerRoute,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import { createHostedChatRunResponseStream } from "../../../packages/ai/src/hosted-chat-stream-lifecycle.mjs";
import { createHostedChatTurnController } from "../../../packages/ai/src/hosted-chat-turn-controller.mjs";
import {
	isHostedQueuedUserMessageAccept,
	persistHostedChatUserMessage,
} from "../../../packages/ai/src/hosted-chat-user-message-persistence.mjs";
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

const interruptActiveChatRun = async ({
	chatId,
	client,
	pendingInput = [],
	runId,
	workspaceId,
}) => {
	const streamKey = createHostedActiveStreamKey({
		workspaceId,
		chatId,
	});
	const activeSession = activeChatStreamControllers.get(streamKey);
	if (pendingInput.length > 0) {
		activeSession?.extendPendingInput([...pendingInput]);
	}
	const drainedPendingInput = activeSession?.takePendingInput() ?? [];
	activeSession?.abort("stopped");
	if (activeSession) {
		activeSession.cleanup();
	}

	await client.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId,
	});

	return drainedPendingInput;
};

const chatModels = CHAT_SERVER_MODELS;
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
	null;

const sendHostedChatConvexRouteError = (response, error) => {
	const routeError = getHostedChatConvexRouteError(error);
	if (!routeError) {
		return false;
	}
	sendJson(response, routeError.statusCode, {
		error: routeError.error,
		errorCode: routeError.errorCode,
	});
	return true;
};

const handleChatRequest = async ({
	createConvexClient = createDefaultConvexClient,
	getSharedLocalFolders,
	isSteerRoute = false,
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
		continueRunId,
		replayQueuedMessageId,
		steerQueuedMessageId,
		supersedeActiveRun = false,
	} = requestBody;
	const steerRouteValidation = validateHostedChatSteerRoute({
		continueRunId,
		hasMessage: Boolean(message),
		isSteerRoute,
		replayQueuedMessageId,
		steerQueuedMessageId,
	});
	if (steerRouteValidation) {
		sendJson(response, steerRouteValidation.statusCode, {
			error: steerRouteValidation.error,
			errorCode: steerRouteValidation.errorCode,
		});
		return;
	}
	if (shouldProxyHostedAiRequest()) {
		await proxyHostedAiRequest({
			path: isSteerRoute ? "/api/chat/steer" : "/api/chat",
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
	const inputValidation = validateHostedChatRequestInput({
		message,
		replayQueuedMessageId,
		steerQueuedMessageId,
	});
	if (inputValidation) {
		sendJson(response, inputValidation.statusCode, inputValidation.payload);
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
	if (model && !resolveChatModel(model)) {
		sendJson(response, 400, {
			error: `Unsupported model: ${model}.`,
		});
		return;
	}

	const convexClient = createConvexClient(convexToken);
	const sendConvexRouteError = (error) => {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			return false;
		}
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return true;
	};
	const storedChat = await convexClient.query(api.chats.getSession, {
		workspaceId: resolvedWorkspaceId,
		chatId: id,
	});
	logLatency("convex.session_loaded", {
		hasStoredChat: Boolean(storedChat),
	});
	const requestedModel = model ?? storedChat?.model ?? null;
	if (!requestedModel) {
		sendJson(response, 400, {
			error: "model is required.",
		});
		return;
	}

	const selectedModel = resolveChatModel(requestedModel);
	if (!selectedModel) {
		sendJson(response, 400, {
			error: `Unsupported model: ${requestedModel}.`,
		});
		return;
	}
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
	let attachableRun = null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		if (sendConvexRouteError(error)) {
			return;
		}
		throw error;
	}
	const queuedInput = createHostedChatQueuedInput({
		workspaceId: resolvedWorkspaceId,
		chatId: id,
		claimReadyForRun: (args) =>
			convexClient.mutation(api.assistantQueuedMessages.claimReadyForRun, args),
		discardClaimed: (args) =>
			convexClient.mutation(api.assistantQueuedMessages.discardClaimed, args),
		getClaimedForChat: (args) =>
			convexClient.query(api.assistantQueuedMessages.getClaimedForChat, args),
	});
	const turnController = createHostedChatTurnController({
		workspaceId: resolvedWorkspaceId,
		chatId: id,
		attachableRun,
		queuedInput,
		interruptActiveRun: (args) =>
			interruptActiveChatRun({ ...args, client: convexClient }),
		validateInput: (inputMessage) => {
			try {
				validateHostedChatInput(inputMessage);
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					...getHostedChatInputValidationErrorResponse(error).payload,
				};
			}
		},
	});
	const sendTurnControllerError = (turnError) => {
		if (turnError.cleanupError) {
			logError({
				error: turnError.cleanupError,
				message: turnError.logMessage,
			});
		} else if (turnError.cause || turnError.logMessage) {
			logError({
				error: turnError.cause,
				message: turnError.logMessage,
			});
		}
		sendJson(response, turnError.statusCode, {
			error: turnError.error,
			...(turnError.errorCode ? { errorCode: turnError.errorCode } : {}),
		});
	};
	let preparedTurnInput = null;
	try {
		preparedTurnInput = await turnController.prepareInput({
			continueRunId,
			message,
			replayQueuedMessageId,
			steerQueuedMessageId,
		});
	} catch (error) {
		if (sendConvexRouteError(error)) {
			return;
		}
		throw error;
	}
	if (!preparedTurnInput.ok) {
		sendTurnControllerError(preparedTurnInput);
		return;
	}
	const {
		effectiveMessage,
		pendingSteerMessages,
		steeredUserMessages,
		cleanupClaimedSteerQueuedMessage,
	} = preparedTurnInput;
	const cleanupClaimedSteerQueuedMessageForRoute = async (
		message,
		options = {},
	) => {
		const cleanupResult = await cleanupClaimedSteerQueuedMessage(options);
		if (cleanupResult.ok) {
			return true;
		}
		logError({
			error: cleanupResult.error,
			message,
		});
		sendJson(response, 500, {
			error: "Failed to clean up claimed steered message.",
		});
		return false;
	};
	const failClaimedSteerPreparation = async (error, message) => {
		if (!(await cleanupClaimedSteerQueuedMessageForRoute(message))) {
			return;
		}
		logError({
			error,
			message: "Failed to prepare steered assistant run",
		});
		sendJson(response, 500, {
			error: "Failed to prepare steered assistant run.",
		});
	};
	const shouldLoadStoredChatMessages = Boolean(effectiveMessage);
	let preparedBranch = null;
	let chatMessages = [];
	let lastUserMessage = null;
	let shouldGenerateChatTitle = false;
	try {
		const branchResult = await prepareHostedChatTurnBranch({
			attachableRunId: attachableRun?._id,
			chatId: id,
			continueRunId,
			getMessagesSnapshot: (args) =>
				convexClient.query(api.chats.getMessagesSnapshot, args),
			listRunEventsAfter: (args) =>
				convexClient.query(api.assistantRunEvents.listRunEventsAfter, args),
			logLatency,
			message: effectiveMessage,
			messageId,
			messages,
			onTruncateError: ({ error }) => {
				logError({
					error: error,
					message: "Failed to truncate regenerated chat message branch",
				});
				return false;
			},
			pendingMessages: pendingSteerMessages,
			shouldLoadStoredMessages: shouldLoadStoredChatMessages,
			trigger,
			truncateFromMessage: (args) =>
				convexClient.mutation(api.chats.truncateFromMessage, args),
			workspaceId: resolvedWorkspaceId,
		});
		if (!branchResult.ok) {
			return;
		}
		preparedBranch = branchResult.preparedBranch;
		chatMessages = await validateUIMessages({
			messages: preparedBranch.incomingMessages,
		});
		lastUserMessage =
			effectiveMessage?.role === "user"
				? effectiveMessage
				: [...chatMessages]
						.reverse()
						.find((currentMessage) => currentMessage.role === "user");
		shouldGenerateChatTitle = Boolean(
			lastUserMessage && (!storedChat || storedChat.title === "New chat"),
		);
		logLatency("chat.messages_validated", {
			chatMessageCount: chatMessages.length,
		});
	} catch (error) {
		if (queuedInput.hasClaimed) {
			await failClaimedSteerPreparation(
				error,
				"Failed to delete failed steered queue message after preparation failure",
			);
			return;
		}
		throw error;
	}

	const activeRunPolicyError = validateHostedChatActiveRunPolicy({
		attachableRun,
		continueRunId,
		supersedeActiveRun,
		trigger,
	});
	if (activeRunPolicyError) {
		sendJson(response, activeRunPolicyError.statusCode, {
			error: activeRunPolicyError.error,
		});
		return;
	}
	const sameActiveRun = await turnController.requireSameActiveRun({
		continueRunId,
	});
	if (!sameActiveRun.ok) {
		sendTurnControllerError(sameActiveRun);
		return;
	}
	let pendingQueuedAcceptanceHeaders = null;

	let agent = null;
	let finalizedToolSet = null;
	let systemPrompt = "";
	let activeStreamSession = null;
	try {
		({ agent, finalizedToolSet, systemPrompt } =
			await buildHostedChatRunContext({
				appsEnabled,
				automationActions: {
					createAutomation: async (automation) =>
						await convexClient.mutation(api.automations.create, {
							workspaceId: resolvedWorkspaceId,
							...automation,
						}),
					deleteAutomation: async (args) =>
						await convexClient.mutation(api.automations.remove, args),
					getAutomation: async (args) =>
						await convexClient.query(api.automations.get, args),
					listAutomations: async () =>
						await convexClient.query(api.automations.list, {
							workspaceId: resolvedWorkspaceId,
						}),
					runAutomationNow: async (args) =>
						await convexClient.mutation(api.automations.runNow, args),
					togglePaused: async (args) =>
						await convexClient.mutation(api.automations.togglePaused, args),
					updateAutomation: async (automation) =>
						await convexClient.mutation(api.automations.update, automation),
				},
				chatAttachmentsApi: api.chatAttachments,
				chatId: id,
				convexClient,
				defaultModel: selectedModel.model,
				defaultReasoningEffort: resolvedReasoningEffort,
				defaultTimezone: resolvedTimezone,
				getActiveStreamSession: () => activeStreamSession,
				getNotesContext: () =>
					getNotesContext({
						convexToken,
						mentions,
						workspaceId: resolvedWorkspaceId,
					}),
				getSelectedAppConnections: (args) =>
					getSelectedAppConnections({
						convexToken,
						selectedSourceIds: args.selectedSourceIds,
						workspaceId: args.workspaceId,
					}),
				getSelectedRecipe: (args) =>
					getSelectedRecipe({
						convexToken,
						recipeSlug: args.recipeSlug,
						workspaceId: args.workspaceId,
					}),
				getStoredNoteContext: (args) =>
					getStoredNoteContext({
						convexToken,
						noteId: args.noteId,
						workspaceId: args.workspaceId,
					}),
				getUserProfileContext: () =>
					convexClient.query(api.userPreferences.getAiProfileContext, {}),
				localFolders,
				logLatency,
				message: effectiveMessage,
				noteContext,
				noteId: resolvedNoteId,
				providerOptions,
				recipeSlug,
				resolveLocalFolderRoots: (folders) =>
					typeof getSharedLocalFolders === "function"
						? getSharedLocalFolders(
								getHostedChatLocalFolderReferenceIds(folders),
							)
						: [],
				selectedSourceIds,
				webSearchEnabled,
				workspaceId: resolvedWorkspaceId,
			}));
	} catch (error) {
		if (queuedInput.hasClaimed) {
			await failClaimedSteerPreparation(
				error,
				"Failed to delete failed steered queue message after preparation failure",
			);
			return;
		}
		throw error;
	}
	if (lastUserMessage) {
		const isQueuedAccept = isHostedQueuedUserMessageAccept({
			continueRunId,
			queuedInput,
			replayQueuedMessageId,
		});
		try {
			const persistedUserMessage = await persistHostedChatUserMessage({
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				noteId: resolvedNoteId,
				model: selectedModel.model,
				reasoningEffort: resolvedReasoningEffort,
				message: lastUserMessage,
				continueRunId,
				queuedInput,
				replayQueuedMessageId,
				steeredUserMessages,
				acceptQueuedUserMessage: (args) =>
					convexClient.mutation(api.chats.acceptQueuedUserMessage, args),
				acceptSteeredUserMessages: (args) =>
					convexClient.mutation(api.chats.acceptSteeredUserMessages, args),
				appendUserMessageToRun: (args) =>
					convexClient.mutation(
						api.assistantRuns.appendUserMessageToAssistantRun,
						args,
					),
				saveMessage: (args) =>
					convexClient.mutation(api.chats.saveMessage, args),
			});
			pendingQueuedAcceptanceHeaders =
				persistedUserMessage.pendingQueuedAcceptanceHeaders;
		} catch (error) {
			const routeError = isQueuedAccept
				? getHostedChatConvexRouteError(error)
				: null;
			if (
				!(await cleanupClaimedSteerQueuedMessageForRoute(
					"Failed to delete failed steered queue message",
					{ tolerateMissing: Boolean(routeError) },
				))
			) {
				return;
			}
			if (routeError) {
				sendJson(response, routeError.statusCode, {
					error: routeError.error,
					errorCode: routeError.errorCode,
				});
				return;
			}
			logError({
				error: error,
				message: "Failed to persist user chat message",
			});
			sendJson(response, 500, {
				error: "Failed to persist user chat message.",
			});
			return;
		}
	}
	logLatency("convex.user_message_saved", {
		attempted: Boolean(lastUserMessage),
	});
	const assistantMessageId = `stream-${crypto.randomUUID()}`;
	const startedRun = await startHostedChatRun({
		workspaceId: resolvedWorkspaceId,
		chatId: id,
		assistantMessageId,
		attachableRun,
		continueRunId,
		model: selectedModel.model,
		reasoningEffort: resolvedReasoningEffort,
		trigger,
		supersedeActiveRun,
		controllers: activeChatStreamControllers,
		startAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.startAssistantRun, args),
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		startActiveStream: (args) =>
			convexClient.mutation(api.chats.startActiveStream, args),
		appendActiveStreamText: (args) =>
			convexClient.mutation(api.chats.appendActiveStreamText, args),
		deleteActiveStreamSnapshot: (args) =>
			convexClient.mutation(api.chats.deleteActiveStreamSnapshot, args),
		startActiveStreamToolCall: (args) =>
			convexClient.mutation(api.chatToolCalls.startActiveStreamToolCall, args),
		finishActiveStreamToolCall: (args) =>
			convexClient.mutation(api.chatToolCalls.finishActiveStreamToolCall, args),
	});
	if (!startedRun.ok) {
		if (startedRun.terminalizationError) {
			logError({
				error: startedRun.terminalizationError,
				message:
					"Failed to terminalize assistant run after stream start failure",
			});
		}
		logError({
			error: startedRun.error,
			message: "Failed to start assistant stream",
		});
		sendJson(
			response,
			500,
			{
				error: "Failed to start assistant stream.",
			},
			pendingQueuedAcceptanceHeaders,
		);
		return;
	}
	const { assistantRun } = startedRun;
	activeStreamSession = startedRun.activeStreamSession;
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});
	const streamLatencyTracker = createChatStreamLatencyTracker(logLatency);
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
	const responseStreamResult = await createHostedChatRunResponseStream({
		activeStreamSession,
		agent,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		chatMessages,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finalizeAssistantRun,
		finalizedToolSet,
		logLatency,
		streamLatencyTracker,
		systemPrompt,
	});
	if (!responseStreamResult.ok) {
		if (pendingQueuedAcceptanceHeaders) {
			sendJson(
				response,
				500,
				{
					error: "Failed to create assistant stream.",
				},
				pendingQueuedAcceptanceHeaders,
			);
			return;
		}
		throw responseStreamResult.error;
	}
	if (pendingQueuedAcceptanceHeaders) {
		for (const [header, value] of Object.entries(
			pendingQueuedAcceptanceHeaders,
		)) {
			response.setHeader(header, value);
		}
	}

	pipeUIMessageStreamToResponse({
		response,
		stream: responseStreamResult.responseStream,
		consumeSseStream: consumeStream,
	});
};

const handleChatStopRequest = async ({
	createConvexClient = createDefaultConvexClient,
	request,
	response,
}) => {
	const {
		id,
		workspaceId,
		convexToken,
		interruptActiveRun = false,
	} = await readJsonBody(request);
	const resolvedWorkspaceId = workspaceId ?? null;

	if (!id || !resolvedWorkspaceId || !convexToken) {
		sendJson(response, 400, {
			error: "id, workspaceId, and convexToken are required.",
		});
		return;
	}

	const convexClient = createConvexClient(convexToken);

	let attachableRun = null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		if (sendHostedChatConvexRouteError(response, error)) {
			return;
		}
		throw error;
	}

	if (!attachableRun) {
		sendJson(response, 200, { ok: true });
		return;
	}

	if (!interruptActiveRun && attachableRun.status !== "stopping") {
		await convexClient.mutation(api.assistantRuns.requestStopAssistantRun, {
			runId: attachableRun._id,
			stopReason: "user_requested",
		});
	}

	try {
		await interruptActiveChatRun({
			workspaceId: resolvedWorkspaceId,
			chatId: id,
			client: convexClient,
			runId: attachableRun._id,
		});
	} finally {
		if (!interruptActiveRun) {
			await convexClient.mutation(api.assistantRuns.finishStoppedAssistantRun, {
				runId: attachableRun._id,
			});
		}
	}

	sendJson(response, 200, { ok: true });
};

const createDefaultConvexClient = (convexToken) =>
	new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});

const handleChatReconnectRequest = async ({
	createConvexClient = createDefaultConvexClient,
	request,
	response,
}) => {
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

	const convexClient = createConvexClient(convexToken);
	let attachableRun = null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		if (sendHostedChatConvexRouteError(response, error)) {
			return;
		}
		throw error;
	}

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
	createConvexClient,
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
					createConvexClient,
					getSharedLocalFolders,
					request,
					response,
				}),
		],
		[
			"/api/chat/steer",
			(request, response) =>
				handleChatRequest({
					createConvexClient,
					getSharedLocalFolders,
					isSteerRoute: true,
					request,
					response,
				}),
		],
		[
			"/api/chat/stop",
			(request, response) =>
				handleChatStopRequest({
					createConvexClient,
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
		const startedAt = Date.now();
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const requestPath = requestUrl.pathname;
		const localAppRouteHandler =
			localAppRoutes.get(requestPath) ??
			(/^\/api\/chat\/[^/]+\/stream$/.test(requestPath)
				? (request, response) =>
						handleChatReconnectRequest({
							createConvexClient,
							request,
							response,
						})
				: null);
		const isReconnectRoute = /^\/api\/chat\/[^/]+\/stream$/.test(requestPath);
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
