import type { IncomingMessage, ServerResponse } from "node:http";
import {
	consumeStream,
	type InferUITools,
	pipeUIMessageStreamToResponse,
	type UIMessage,
	type UIMessageChunk,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	getSelectedNoteSourceIds,
	loadSelectedAppSourceConnections,
} from "../../../packages/ai/src/capability-metadata.mjs";
import {
	createChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "../../../packages/ai/src/chat-latency-logger.mjs";
import {
	createHostedActiveStreamKey,
	type HostedActiveStreamSession,
} from "../../../packages/ai/src/hosted-chat-active-stream.mjs";
import { prepareHostedChatTurnBranch } from "../../../packages/ai/src/hosted-chat-branch-preparer.mjs";
import { getBearerTokenFromAuthorizationHeader } from "../../../packages/ai/src/hosted-chat-http.mjs";
import { stopOrphanedHostedAssistantRun } from "../../../packages/ai/src/hosted-chat-orphaned-run.mjs";
import { createHostedChatQueuedInput } from "../../../packages/ai/src/hosted-chat-queued-input.mjs";
import {
	buildHostedChatRunContext,
	getHostedChatLocalFolderReferencePaths,
} from "../../../packages/ai/src/hosted-chat-run-context.mjs";
import { createHostedAssistantRunFinalizer } from "../../../packages/ai/src/hosted-chat-run-finalizer.mjs";
import { startHostedChatRun } from "../../../packages/ai/src/hosted-chat-run-starter.mjs";
import {
	buildHostedNotesContext,
	getHostedChatConvexRouteError,
	getHostedChatInputValidationErrorResponse,
	getHostedChatSteerTelemetry,
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
import { resolveLocalFolderRoots } from "../../../packages/ai/src/local-folder-tools.mjs";
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
	continueRunId?: Id<"assistantRuns">;
	interruptActiveRun?: boolean;
	replayQueuedMessageId?: Id<"assistantQueuedMessages">;
	steerQueuedMessageId?: Id<"assistantQueuedMessages">;
	supersedeActiveRun?: boolean;
};

type AttachableAssistantRun = {
	_id: Id<"assistantRuns">;
	chatId: Id<"chats">;
	status?: string;
};

const activeChatStreamControllers = new Map<
	string,
	HostedActiveStreamSession
>();
const AI_LATENCY_DEBUG_ENABLED = process.env.GRANERI_AI_LATENCY_DEBUG === "1";

const canUseLocalFolderTools = () => process.env.GRANERI_ENV_MODE === "local";

const interruptActiveChatRun = async ({
	chatId,
	client,
	pendingInput = [],
	runId,
	workspaceId,
}: {
	chatId: string;
	client: ConvexHttpClient;
	pendingInput?: readonly unknown[];
	runId: Id<"assistantRuns">;
	workspaceId: Id<"workspaces">;
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
	headers?: Record<string, string> | null,
) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	for (const [header, value] of Object.entries(headers ?? {})) {
		response.setHeader(header, value);
	}
	response.end(JSON.stringify(payload));
};

const sendHostedChatConvexRouteError = (
	response: ServerResponse,
	error: unknown,
) => {
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
	options: { isSteerRoute?: boolean } = {},
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "chat.request",
		request,
	});
	let acceptedSteerTurnId: string | null = null;
	let wideEventEmitted = false;
	const emitWideEvent = (level: "error" | "info") => {
		if (wideEventEmitted) {
			return;
		}

		const steerTelemetry = getHostedChatSteerTelemetry({
			acceptedTurnId: acceptedSteerTurnId,
			errorCode:
				typeof wideEvent.error_code === "string" ? wideEvent.error_code : null,
			expectedTurnId:
				typeof wideEvent.continue_run_id === "string"
					? wideEvent.continue_run_id
					: null,
			isSteerRoute: wideEvent.is_steer_route === true,
			outcome:
				wideEvent.outcome === "success" || wideEvent.outcome === "error"
					? wideEvent.outcome
					: null,
			queuedMessageId:
				typeof wideEvent.steer_queued_message_id === "string"
					? wideEvent.steer_queued_message_id
					: null,
		});
		if (steerTelemetry) {
			Object.assign(wideEvent, steerTelemetry);
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
		continueRunId,
		replayQueuedMessageId,
		supersedeActiveRun = false,
		steerQueuedMessageId,
	} = await readJsonBody(request);
	wideEvent.chat_id = id ?? null;
	wideEvent.workspace_id = workspaceId ?? null;
	wideEvent.trigger = trigger ?? null;
	wideEvent.model = model ?? null;
	wideEvent.reasoning_effort = reasoningEffort ?? null;
	wideEvent.is_steer_route = options.isSteerRoute === true;
	wideEvent.continue_run_id = continueRunId ?? null;
	wideEvent.replay_queued_message_id = replayQueuedMessageId ?? null;
	wideEvent.steer_queued_message_id = steerQueuedMessageId ?? null;
	const steerRouteValidation = validateHostedChatSteerRoute({
		continueRunId,
		hasMessage: Boolean(message),
		isSteerRoute: options.isSteerRoute === true,
		replayQueuedMessageId,
		steerQueuedMessageId,
	});
	if (steerRouteValidation) {
		wideEvent.outcome = "error";
		wideEvent.status_code = steerRouteValidation.statusCode;
		wideEvent.error_code = steerRouteValidation.errorCode;
		emitWideEvent("error");
		sendJson(response, steerRouteValidation.statusCode, {
			error: steerRouteValidation.error,
			errorCode: steerRouteValidation.errorCode,
		});
		return;
	}
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

	const inputValidation = validateHostedChatRequestInput({
		message,
		replayQueuedMessageId,
		steerQueuedMessageId,
	});
	if (inputValidation) {
		wideEvent.outcome = "error";
		wideEvent.status_code = inputValidation.statusCode;
		wideEvent.error_code = inputValidation.errorCode;
		emitWideEvent("error");
		sendJson(response, inputValidation.statusCode, inputValidation.payload);
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
	let storedChat: {
		model?: string | null;
		noteId?: Id<"notes"> | null;
		reasoningEffort?: string | null;
		title?: string | null;
	} | null;
	try {
		storedChat = await convexClient.query(api.chats.getSession, {
			workspaceId: resolvedWorkspaceId,
			chatId: id,
		});
	} catch (error) {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			throw error;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = routeError.statusCode;
		wideEvent.error_code = routeError.errorCode;
		emitWideEvent("error");
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return;
	}
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
	let attachableRun: AttachableAssistantRun | null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			throw error;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = routeError.statusCode;
		wideEvent.error_code = routeError.errorCode;
		emitWideEvent("error");
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return;
	}
	const queuedInput = createHostedChatQueuedInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>({
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
	const cleanupClaimedSteerQueuedMessageForRoute = async (
		operation: string,
		options: { tolerateMissing?: boolean } = {},
	) => {
		const cleanupResult =
			await turnController.cleanupClaimedSteerQueuedMessage(options);
		if (cleanupResult.ok) {
			return true;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "steer_queue_cleanup_failed";
		recordServerError({
			details: {
				queued_message_ids: cleanupResult.queuedMessageIds,
			},
			error: cleanupResult.error,
			event: wideEvent,
			operation,
		});
		emitWideEvent("error");
		sendJson(response, 500, {
			error: "Failed to clean up claimed steered message.",
		});
		return false;
	};
	const failClaimedSteerPreparation = async (
		error: unknown,
		operation: string,
	) => {
		if (
			!(await cleanupClaimedSteerQueuedMessageForRoute(`${operation}_cleanup`))
		) {
			return;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "steer_preparation_failed";
		recordServerError({
			error,
			event: wideEvent,
			operation,
		});
		emitWideEvent("error");
		sendJson(response, 500, {
			error: "Failed to prepare steered assistant run.",
		});
	};
	const sendTurnControllerError = (turnError: {
		cause?: unknown;
		cleanupError?: unknown;
		error: string;
		errorCode?: string;
		logMessage?: string;
		phase: string;
		statusCode: 400 | 409 | 500;
	}) => {
		wideEvent.outcome = "error";
		wideEvent.status_code = turnError.statusCode;
		wideEvent.error_code = turnError.errorCode ?? turnError.phase;
		if (turnError.cleanupError) {
			recordServerError({
				error: turnError.cleanupError,
				event: wideEvent,
				operation: turnError.logMessage ?? turnError.phase,
			});
		} else if (turnError.cause || turnError.logMessage) {
			recordServerError({
				details: continueRunId ? { run_id: continueRunId } : undefined,
				error: turnError.cause,
				event: wideEvent,
				operation: turnError.logMessage ?? turnError.phase,
			});
		}
		emitWideEvent("error");
		sendJson(response, turnError.statusCode, {
			error: turnError.error,
			...(turnError.errorCode ? { errorCode: turnError.errorCode } : {}),
		});
	};
	let preparedTurnInput: Awaited<
		ReturnType<typeof turnController.prepareInput>
	>;
	try {
		preparedTurnInput = await turnController.prepareInput({
			continueRunId,
			message,
			replayQueuedMessageId,
			steerQueuedMessageId,
		});
	} catch (error) {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			throw error;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = routeError.statusCode;
		wideEvent.error_code = routeError.errorCode;
		emitWideEvent("error");
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return;
	}
	if (!preparedTurnInput.ok) {
		sendTurnControllerError(preparedTurnInput);
		return;
	}
	const { effectiveMessage, pendingSteerMessages, steeredUserMessages } =
		preparedTurnInput;
	const cleanupClaimedSteerQueuedMessage = async (
		operation: string,
		options: { tolerateMissing?: boolean } = {},
	) => await cleanupClaimedSteerQueuedMessageForRoute(operation, options);
	let preparedBranch: {
		incomingMessages: UIMessage[];
	};
	let selectedAppConnections: Awaited<
		ReturnType<typeof buildHostedChatRunContext>
	>["selectedAppConnections"];
	let localFolderRoots: Awaited<
		ReturnType<typeof buildHostedChatRunContext>
	>["localFolderRoots"];
	let agent: Awaited<ReturnType<typeof buildHostedChatRunContext>>["agent"];
	let finalizedToolSet: Awaited<
		ReturnType<typeof buildHostedChatRunContext>
	>["finalizedToolSet"];
	let systemPrompt: string;
	let tools: Awaited<ReturnType<typeof buildHostedChatRunContext>>["tools"];
	let chatMessages: UIMessage<unknown, never, InferUITools<typeof tools>>[];
	let lastUserMessage: UIMessage | undefined;
	let shouldGenerateChatTitle: boolean;
	let activeStreamSession: HostedActiveStreamSession | null = null;
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
			onTruncateError: async ({ error, messageId: truncateMessageId }) => {
				if (
					queuedInput.hasClaimed &&
					!(await cleanupClaimedSteerQueuedMessage(
						"steer_queue_branch_truncate_cleanup",
					))
				) {
					return true;
				}
				recordServerError({
					details: {
						message_id: truncateMessageId,
					},
					error,
					event: wideEvent,
					operation: "branch_truncate",
				});
				wideEvent.outcome = "error";
				wideEvent.status_code = 500;
				wideEvent.error_code = "branch_truncate_failed";
				emitWideEvent("error");
				sendJson(response, 500, {
					error: "Failed to prepare edited chat branch.",
				});
				return true;
			},
			pendingMessages: pendingSteerMessages,
			trigger,
			truncateFromMessage: (args) =>
				convexClient.mutation(api.chats.truncateFromMessage, args),
			workspaceId: resolvedWorkspaceId,
		});
		if (!branchResult.ok) {
			return;
		}
		preparedBranch = branchResult.preparedBranch;

		({
			agent,
			finalizedToolSet,
			localFolderRoots,
			selectedAppConnections,
			systemPrompt,
			tools,
		} = await buildHostedChatRunContext({
			appsEnabled,
			chatAttachmentsApi: api.chatAttachments,
			chatId: id,
			convexClient,
			createAutomation: async (automation) =>
				await convexClient.mutation(api.automations.create, {
					workspaceId: resolvedWorkspaceId,
					...automation,
				}),
			defaultModel: resolvedModel.model,
			defaultReasoningEffort: resolvedReasoningEffort,
			defaultTimezone: resolvedTimezone,
			getActiveStreamSession: () => activeStreamSession,
			getNotesContext: () =>
				getNotesContext({
					convexToken,
					mentions,
					workspaceId,
				}),
			getSelectedAppConnections: (args) =>
				getSelectedAppConnections({
					convexToken,
					selectedSourceIds: args.selectedSourceIds,
					workspaceId,
				}),
			getSelectedRecipe: (args) =>
				getSelectedRecipe({
					convexToken,
					recipeSlug: args.recipeSlug,
					workspaceId: args.workspaceId,
				}),
			getStoredNoteContext: () =>
				(async () => {
					if (!resolvedNoteId) {
						throw new Error("Stored note context requires a resolved note id.");
					}
					return await getStoredNoteContext({
						client: convexClient,
						noteId: resolvedNoteId,
						workspaceId: resolvedWorkspaceId,
					});
				})(),
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
				canUseLocalFolderTools()
					? resolveLocalFolderRoots(
							getHostedChatLocalFolderReferencePaths(folders),
						)
					: [],
			selectedSourceIds,
			webSearchEnabled,
			workspaceId: resolvedWorkspaceId,
		}));
		chatMessages = await validateUIMessages<
			UIMessage<unknown, never, InferUITools<typeof tools>>
		>({
			messages: preparedBranch.incomingMessages,
			tools,
		});
		logLatency("chat.messages_validated", {
			chatMessageCount: chatMessages.length,
		});
		lastUserMessage =
			effectiveMessage.role === "user"
				? effectiveMessage
				: [...chatMessages]
						.reverse()
						.find((currentMessage) => currentMessage.role === "user");
		shouldGenerateChatTitle = Boolean(
			lastUserMessage && (!storedChat || storedChat.title === "New chat"),
		);
	} catch (error) {
		if (queuedInput.hasClaimed) {
			await failClaimedSteerPreparation(error, "steer_run_prepare");
			return;
		}
		const routeError = getHostedChatConvexRouteError(error);
		if (routeError) {
			wideEvent.outcome = "error";
			wideEvent.status_code = routeError.statusCode;
			wideEvent.error_code = routeError.errorCode;
			emitWideEvent("error");
			sendJson(response, routeError.statusCode, {
				error: routeError.error,
				errorCode: routeError.errorCode,
			});
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
		wideEvent.outcome = "error";
		wideEvent.status_code = activeRunPolicyError.statusCode;
		wideEvent.error_code = activeRunPolicyError.errorCode;
		wideEvent.active_run_id = activeRunPolicyError.activeRunId;
		emitWideEvent("error");
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
	let pendingQueuedAcceptanceHeaders: Record<string, string> | null = null;
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
				model: resolvedModel.model,
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
			acceptedSteerTurnId = persistedUserMessage.acceptedSteerTurnId;
		} catch (error) {
			const routeError = isQueuedAccept
				? getHostedChatConvexRouteError(error)
				: null;
			if (
				!(await cleanupClaimedSteerQueuedMessage("steer_queue_cleanup", {
					tolerateMissing: Boolean(routeError),
				}))
			) {
				return;
			}
			if (routeError) {
				wideEvent.outcome = "error";
				wideEvent.status_code = routeError.statusCode;
				wideEvent.error_code = routeError.errorCode;
				emitWideEvent("error");
				sendJson(response, routeError.statusCode, {
					error: routeError.error,
					errorCode: routeError.errorCode,
				});
				return;
			}
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "user_message_persist_failed";
			recordServerError({
				details: {
					message_id: lastUserMessage.id,
				},
				error,
				event: wideEvent,
				operation: "user_message_persist",
			});
			emitWideEvent("error");
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
		model: resolvedModel.model,
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
			recordServerError({
				error: startedRun.terminalizationError,
				event: wideEvent,
				operation: "assistant_run_start_failure_terminalize",
			});
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "stream_start_failed";
		recordServerError({
			error: startedRun.error,
			event: wideEvent,
			operation: "stream_start",
		});
		emitWideEvent("error");
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
	wideEvent.assistant_run_id = assistantRun._id;
	wideEvent.assistant_message_id = assistantMessageId;
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});

	const streamLatencyTracker =
		createChatStreamLatencyTracker<UIMessageChunk>(logLatency);
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
		onStreamCreateError: (error) => {
			recordServerError({
				error,
				event: wideEvent,
				operation: "stream_create",
			});
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_create_failed";
			emitWideEvent("error");
		},
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
	wideEvent.tool_count = finalizedToolSet.toolCount;
	wideEvent.deferred_tool_count = finalizedToolSet.deferredToolCount;
	wideEvent.local_folder_root_count = localFolderRoots.length;
	wideEvent.app_connection_count = selectedAppConnections.length;
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

export const handleChatStopRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const {
		id,
		workspaceId,
		convexToken,
		interruptActiveRun = false,
	} = await readJsonBody(request);
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

	let attachableRun: AttachableAssistantRun | null;
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
	let attachableRun: AttachableAssistantRun | null;
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
		stream: activeSession.subscribe<UIMessageChunk>(),
		consumeSseStream: consumeStream,
	});
};
