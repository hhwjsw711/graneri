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
import {
	createHostedMultiAgentRuntime,
	createHostedMultiAgentTools,
} from "../../../packages/ai/src/hosted-chat-multi-agent-tools.mjs";
import { stopOrphanedHostedAssistantRun } from "../../../packages/ai/src/hosted-chat-orphaned-run.mjs";
import { createHostedAssistantRunFinalizationQueue } from "../../../packages/ai/src/hosted-chat-run-finalization-queue.mjs";
import { createHostedAssistantRunFinalizer } from "../../../packages/ai/src/hosted-chat-run-finalizer.mjs";
import { buildHostedChatRunPlan } from "../../../packages/ai/src/hosted-chat-run-plan.mjs";
import {
	buildHostedChatSaveMessageArgs,
	buildHostedNotesContext,
	getHostedChatConvexRouteError,
	getHostedChatRecipeContext,
	getHostedChatReplayAcceptanceHeaders,
	getHostedChatSteerAcceptanceHeaders,
	getInlineHostedNoteContext,
	getStoredHostedNoteContext,
	HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE,
	HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE,
	MAX_HOSTED_CHAT_INPUT_TEXT_CHARS,
	prepareHostedChatBranch,
	toHostedQueuedUserMessage,
	validateHostedChatInput,
	validateHostedChatSteerRoute,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import { createHostedWaitAgentTool } from "../../../packages/ai/src/hosted-chat-wait-agent-tool.mjs";
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

const isPendingUserMessage = (input) =>
	input &&
	typeof input === "object" &&
	typeof input.id === "string" &&
	input.role === "user" &&
	Array.isArray(input.parts);

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

const getHostedChatInputValidationErrorResponse = (error) => {
	const code = error && typeof error === "object" ? error.code : undefined;
	if (code === HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE) {
		return {
			errorCode: HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE,
			payload: {
				error: "input must not be empty",
			},
		};
	}

	return {
		errorCode: HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE,
		payload: {
			error: `Input exceeds the maximum length of ${MAX_HOSTED_CHAT_INPUT_TEXT_CHARS} characters.`,
			input_error_code: HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE,
			max_chars: MAX_HOSTED_CHAT_INPUT_TEXT_CHARS,
			actual_chars:
				error && typeof error === "object" && "actualChars" in error
					? error.actualChars
					: undefined,
		},
	};
};

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
	if (!message && !steerQueuedMessageId && !replayQueuedMessageId) {
		sendJson(response, 400, {
			error: "message is required.",
		});
		return;
	}
	if (message && !steerQueuedMessageId && !replayQueuedMessageId) {
		try {
			validateHostedChatInput(message);
		} catch (error) {
			const validationError = getHostedChatInputValidationErrorResponse(error);
			sendJson(response, 400, validationError.payload);
			return;
		}
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
	let claimedSteerQueuedMessageId = null;
	let claimedSteerQueuedMessageIds = [];
	let steeredUserMessages = [];
	let steeredUserMessage = null;
	let replayedUserMessage = null;
	let interruptedPendingInput = [];
	const cleanupClaimedSteerQueuedMessage = async (message) => {
		const queuedMessageIds =
			claimedSteerQueuedMessageIds.length > 0
				? claimedSteerQueuedMessageIds
				: claimedSteerQueuedMessageId
					? [claimedSteerQueuedMessageId]
					: [];
		if (queuedMessageIds.length === 0) {
			return true;
		}
		try {
			await Promise.all(
				queuedMessageIds.map((queuedMessageId) =>
					convexClient.mutation(api.assistantQueuedMessages.discardClaimed, {
						workspaceId: resolvedWorkspaceId,
						chatId: id,
						queuedMessageId,
					}),
				),
			);
			claimedSteerQueuedMessageId = null;
			claimedSteerQueuedMessageIds = [];
			return true;
		} catch (cleanupError) {
			logError({
				error: cleanupError,
				message,
			});
			sendJson(response, 500, {
				error: "Failed to clean up claimed steered message.",
			});
			return false;
		}
	};
	const failClaimedSteerPreparation = async (error, message) => {
		if (!(await cleanupClaimedSteerQueuedMessage(message))) {
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
	if (steerQueuedMessageId) {
		if (!continueRunId || attachableRun?._id !== continueRunId) {
			sendJson(response, 409, {
				error:
					"Active assistant run changed before the queued message could steer.",
			});
			return;
		}

		let claimedSteerMessages = [];
		try {
			claimedSteerMessages = await convexClient.mutation(
				api.assistantQueuedMessages.claimReadyForRun,
				{
					runId: continueRunId,
					queuedMessageId: steerQueuedMessageId,
				},
			);
		} catch (error) {
			if (sendConvexRouteError(error)) {
				return;
			}
			throw error;
		}

		if (claimedSteerMessages.length === 0) {
			sendJson(response, 409, {
				error: "Queued message is no longer available.",
			});
			return;
		}

		claimedSteerQueuedMessageId = claimedSteerMessages[0]?._id ?? null;
		claimedSteerQueuedMessageIds = claimedSteerMessages.map(
			(queuedMessage) => queuedMessage._id,
		);
		steeredUserMessages = claimedSteerMessages.map((queuedMessage) =>
			toHostedQueuedUserMessage(queuedMessage),
		);
		steeredUserMessage =
			steeredUserMessages[steeredUserMessages.length - 1] ?? null;
		if (attachableRun.status === "running") {
			try {
				interruptedPendingInput = await interruptActiveChatRun({
					chatId: id,
					client: convexClient,
					pendingInput: steeredUserMessages,
					runId: continueRunId,
					workspaceId: resolvedWorkspaceId,
				});
			} catch (error) {
				if (
					!(await cleanupClaimedSteerQueuedMessage(
						"Failed to delete failed steered queue message after active run interrupt failure",
					))
				) {
					return;
				}
				logError({
					error: error,
					message: "Failed to interrupt active assistant run",
				});
				sendJson(response, 500, {
					error: "Failed to interrupt active assistant run.",
				});
				return;
			}
		}
	}
	if (replayQueuedMessageId && !continueRunId) {
		let claimedReplayMessage = null;
		try {
			claimedReplayMessage = await convexClient.query(
				api.assistantQueuedMessages.getClaimedForChat,
				{
					workspaceId: resolvedWorkspaceId,
					chatId: id,
					queuedMessageId: replayQueuedMessageId,
				},
			);
		} catch (error) {
			if (sendConvexRouteError(error)) {
				return;
			}
			throw error;
		}

		if (!claimedReplayMessage) {
			sendJson(response, 409, {
				error: "Queued message is no longer available.",
			});
			return;
		}

		replayedUserMessage = toHostedQueuedUserMessage(claimedReplayMessage);
	}
	const effectiveMessage = steeredUserMessage ?? replayedUserMessage ?? message;
	const shouldLoadStoredChatMessages = Boolean(effectiveMessage);
	if (!effectiveMessage) {
		if (
			!(await cleanupClaimedSteerQueuedMessage(
				"Failed to delete failed steered queue message after missing input",
			))
		) {
			return;
		}
		sendJson(response, 400, {
			error: "message is required.",
		});
		return;
	}
	try {
		validateHostedChatInput(effectiveMessage);
	} catch (error) {
		if (
			!(await cleanupClaimedSteerQueuedMessage(
				"Failed to delete failed steered queue message after input size validation",
			))
		) {
			return;
		}
		const validationError = getHostedChatInputValidationErrorResponse(error);
		sendJson(response, 400, validationError.payload);
		return;
	}
	let preparedBranch = null;
	let shouldTruncateChatBranch = false;
	let chatMessages = [];
	let lastUserMessage = null;
	let shouldGenerateChatTitle = false;
	try {
		const storedChatMessages = shouldLoadStoredChatMessages
			? await convexClient.query(api.chats.getMessagesSnapshot, {
					workspaceId: resolvedWorkspaceId,
					chatId: id,
				})
			: [];
		const runEvents =
			shouldLoadStoredChatMessages &&
			continueRunId &&
			attachableRun?._id === continueRunId
				? await convexClient.query(api.assistantRunEvents.listRunEventsAfter, {
						runId: continueRunId,
						limit: 500,
					})
				: [];
		const interruptedAssistantMessageIds = runEvents.flatMap((runEvent) =>
			runEvent.event.type === "assistant.message.interrupted"
				? [runEvent.event.assistantMessageId]
				: [],
		);
		const pendingSteerMessages =
			interruptedPendingInput.length > 0
				? interruptedPendingInput.filter(isPendingUserMessage)
				: steeredUserMessages;
		preparedBranch = prepareHostedChatBranch({
			interruptedAssistantMessageIds,
			message: effectiveMessage,
			messageId,
			messages,
			pendingMessages: pendingSteerMessages,
			storedMessages: effectiveMessage ? storedChatMessages : [],
			trigger,
		});
		shouldTruncateChatBranch = preparedBranch.shouldTruncateChatBranch;

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
				throw error;
			}
		}
		logLatency("chat.branch_ready", {
			incomingMessageCount: preparedBranch.incomingMessages.length,
			shouldTruncateChatBranch,
		});
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
		if (claimedSteerQueuedMessageId) {
			await failClaimedSteerPreparation(
				error,
				"Failed to delete failed steered queue message after preparation failure",
			);
			return;
		}
		throw error;
	}

	if (
		trigger !== "regenerate-message" &&
		!continueRunId &&
		!supersedeActiveRun
	) {
		if (attachableRun) {
			sendJson(response, 409, {
				error: "Chat already has an active assistant run.",
			});
			return;
		}
	}
	if (continueRunId && attachableRun?._id !== continueRunId) {
		if (
			!(await cleanupClaimedSteerQueuedMessage(
				"Failed to delete failed steered queue message after active run mismatch",
			))
		) {
			return;
		}
		sendJson(response, 409, {
			error:
				"Active assistant run changed before the queued message could steer.",
		});
		return;
	}
	let pendingQueuedAcceptanceHeaders = null;

	let agent = null;
	let finalizedToolSet = null;
	let systemPrompt = "";
	let activeStreamSession = null;
	let multiAgentRuntime = null;
	const durableAgentIdsByPath = new Map();
	try {
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
			message: effectiveMessage,
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
		({ agent, finalizedToolSet, systemPrompt } = buildHostedChatRunPlan({
			additionalAgentTools: {
				...createHostedMultiAgentTools({
					getRuntime: () => {
						if (!multiAgentRuntime) {
							throw new Error(
								"multi-agent tools require an active assistant turn.",
							);
						}
						return multiAgentRuntime;
					},
				}),
				wait_agent: createHostedWaitAgentTool({
					getActiveStreamSession: () => activeStreamSession,
				}),
			},
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
		}));
		logLatency("tools.finalized", {
			deferredToolCount: finalizedToolSet.deferredToolCount,
			hasEnabledTools: finalizedToolSet.hasTools,
			hasToolSearch: finalizedToolSet.hasToolSearch,
			toolCount: finalizedToolSet.toolCount,
		});
	} catch (error) {
		if (claimedSteerQueuedMessageId) {
			await failClaimedSteerPreparation(
				error,
				"Failed to delete failed steered queue message after preparation failure",
			);
			return;
		}
		throw error;
	}
	if (lastUserMessage) {
		const isQueuedAccept = Boolean(
			(continueRunId && claimedSteerQueuedMessageId) ||
				(replayQueuedMessageId && !continueRunId),
		);
		try {
			const saveMessageArgs = buildHostedChatSaveMessageArgs({
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				noteId: resolvedNoteId,
				model: selectedModel.model,
				reasoningEffort: resolvedReasoningEffort,
				message: lastUserMessage,
			});
			if (continueRunId && claimedSteerQueuedMessageId) {
				const acceptedQueuedMessageId = claimedSteerQueuedMessageId;
				await convexClient.mutation(api.chats.acceptSteeredUserMessages, {
					workspaceId: saveMessageArgs.workspaceId,
					chatId: saveMessageArgs.chatId,
					noteId: saveMessageArgs.noteId,
					title: saveMessageArgs.title,
					preview: saveMessageArgs.preview,
					model: saveMessageArgs.model,
					reasoningEffort: saveMessageArgs.reasoningEffort,
					runId: continueRunId,
					messages: steeredUserMessages.map((steeredMessage, index) => ({
						queuedMessageId: claimedSteerQueuedMessageIds[index],
						message: buildHostedChatSaveMessageArgs({
							workspaceId: resolvedWorkspaceId,
							chatId: id,
							noteId: resolvedNoteId,
							model: selectedModel.model,
							reasoningEffort: resolvedReasoningEffort,
							message: steeredMessage,
						}).message,
					})),
				});
				pendingQueuedAcceptanceHeaders = getHostedChatSteerAcceptanceHeaders({
					queuedMessageId: acceptedQueuedMessageId,
					queuedMessageIds: claimedSteerQueuedMessageIds,
					turnId: continueRunId,
				});
				claimedSteerQueuedMessageId = null;
				claimedSteerQueuedMessageIds = [];
			} else if (replayQueuedMessageId && !continueRunId) {
				await convexClient.mutation(api.chats.acceptQueuedUserMessage, {
					...saveMessageArgs,
					queuedMessageId: replayQueuedMessageId,
				});
				pendingQueuedAcceptanceHeaders = getHostedChatReplayAcceptanceHeaders({
					queuedMessageId: replayQueuedMessageId,
				});
			} else {
				await convexClient.mutation(api.chats.saveMessage, saveMessageArgs);
				if (continueRunId) {
					await convexClient.mutation(
						api.assistantRuns.appendUserMessageToAssistantRun,
						{
							runId: continueRunId,
							messageId: lastUserMessage.id,
						},
					);
				}
			}
		} catch (error) {
			if (
				!(await cleanupClaimedSteerQueuedMessage(
					"Failed to delete failed steered queue message",
				))
			) {
				return;
			}
			if (isQueuedAccept && sendConvexRouteError(error)) {
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
	let assistantRun = null;
	try {
		assistantRun =
			continueRunId && attachableRun?._id === continueRunId
				? attachableRun
				: await convexClient.mutation(api.assistantRuns.startAssistantRun, {
						workspaceId: resolvedWorkspaceId,
						chatId: id,
						assistantMessageId,
						model: selectedModel.model,
						reasoningEffort: resolvedReasoningEffort,
						policy:
							trigger === "regenerate-message" || supersedeActiveRun
								? "supersede"
								: "reject",
					});
		activeStreamSession = createHostedActiveChatStreamSession({
			controllers: activeChatStreamControllers,
			workspaceId: resolvedWorkspaceId,
			chatId: id,
			messageId: assistantMessageId,
			runId: assistantRun._id,
			callbacks: {
				startActiveStream: (args) =>
					convexClient.mutation(api.chats.startActiveStream, {
						...args,
						assistantMessageId,
					}),
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
	} catch (error) {
		if (assistantRun) {
			await convexClient
				.mutation(api.assistantRuns.failAssistantRun, {
					runId: assistantRun._id,
					errorText:
						error instanceof Error
							? error.message
							: "Unknown stream start error",
				})
				.catch((failError) => {
					logError({
						error: failError,
						message:
							"Failed to terminalize assistant run after stream start failure",
					});
				});
		}
		activeStreamSession?.cleanup();
		logError({
			error,
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
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});
	multiAgentRuntime = createHostedMultiAgentRuntime({
		activeStreamSession,
		baseTools: finalizedToolSet.tools,
		model: selectedModel.model,
		onAgentCompleted: async ({ durableAgentId, message, path }) => {
			if (!durableAgentId) {
				return;
			}
			const parentPath = path.slice(0, path.lastIndexOf("/")) || "/root";
			await convexClient.mutation(api.assistantAgents.markAgentCompleted, {
				agentId: durableAgentId,
				message,
				notifyAgentId: durableAgentIdsByPath.get(parentPath),
			});
		},
		onAgentCreated: async ({ message, parentPath, path }) => {
			const created = await convexClient.mutation(
				api.assistantAgents.createAgent,
				{
					workspaceId: resolvedWorkspaceId,
					rootChatId: assistantRun.chatId,
					parentAgentId: parentPath
						? durableAgentIdsByPath.get(parentPath)
						: undefined,
					agentPath: path,
					model: selectedModel.model,
					reasoningEffort: resolvedReasoningEffort,
					initialTaskMessage: message,
				},
			);
			durableAgentIdsByPath.set(path, created.agentId);
			return {
				durableAgentId: created.agentId,
			};
		},
		onAgentErrored: async ({ durableAgentId, errorText, path }) => {
			if (!durableAgentId) {
				return;
			}
			const parentPath = path.slice(0, path.lastIndexOf("/")) || "/root";
			await convexClient.mutation(api.assistantAgents.markAgentErrored, {
				agentId: durableAgentId,
				errorText,
				notifyAgentId: durableAgentIdsByPath.get(parentPath),
			});
		},
		onAgentInterrupted: async ({ durableAgentId, path }) => {
			if (!durableAgentId) {
				return;
			}
			await convexClient.mutation(api.assistantAgents.interruptAgent, {
				rootChatId: assistantRun.chatId,
				targetAgentPath: path,
			});
		},
		onAgentRunning: async ({ activeRunId, durableAgentId }) => {
			if (!durableAgentId) {
				return;
			}
			await convexClient.mutation(api.assistantAgents.markAgentRunning, {
				agentId: durableAgentId,
				activeRunId,
			});
		},
		providerOptions,
		systemPrompt,
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
			await convexClient.mutation(api.assistantRuns.failAssistantRun, {
				runId: assistantRun._id,
				errorText: error instanceof Error ? error.message : "Unknown error",
			});
			activeStreamSession.cleanup();
			if (pendingQueuedAcceptanceHeaders) {
				sendJson(
					response,
					500,
					{
						error: "Failed to create assistant stream.",
					},
					pendingQueuedAcceptanceHeaders,
				);
				return null;
			}
			throw error;
		}
	})();
	if (!stream) {
		return;
	}
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
		onError: async (error) => {
			finalizationQueue?.setTerminalization({
				errorText:
					error instanceof Error
						? error.message
						: "Unknown active stream persistence error",
				status: "failed",
			});
			await finalizationQueue?.flushAfterClientStream();
		},
		onFlush: async () => {
			await finalizationQueue?.flushAfterClientStream();
		},
		persister: activeStreamSession,
		stream: streamLatencyTracker.wrapStream(stream),
	});
	const responseStream = activeStreamSession.startBroadcast(persistedStream);
	if (pendingQueuedAcceptanceHeaders) {
		for (const [header, value] of Object.entries(
			pendingQueuedAcceptanceHeaders,
		)) {
			response.setHeader(header, value);
		}
	}

	pipeUIMessageStreamToResponse({
		response,
		stream: responseStream,
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
