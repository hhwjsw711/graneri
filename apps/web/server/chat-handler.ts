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
import { createHostedChatQueuedInput } from "../../../packages/ai/src/hosted-chat-queued-input.mjs";
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
	getHostedChatSteerTelemetry,
	getInlineHostedNoteContext,
	getStoredHostedNoteContext,
	HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE,
	HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE,
	MAX_HOSTED_CHAT_INPUT_TEXT_CHARS,
	prepareHostedChatBranch,
	validateHostedChatInput,
	validateHostedChatSteerRoute,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import { createHostedChatTurnController } from "../../../packages/ai/src/hosted-chat-turn-controller.mjs";
import { createHostedWaitAgentTool } from "../../../packages/ai/src/hosted-chat-wait-agent-tool.mjs";
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

const getHostedChatInputValidationErrorResponse = (error: unknown) => {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE) {
		return {
			errorCode: HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE,
			payload: {
				error: "input must not be empty",
			},
		};
	}

	const actualChars =
		typeof (error as { actualChars?: unknown }).actualChars === "number"
			? (error as { actualChars: number }).actualChars
			: undefined;
	return {
		errorCode: HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE,
		payload: {
			error: `Input exceeds the maximum length of ${MAX_HOSTED_CHAT_INPUT_TEXT_CHARS} characters.`,
			input_error_code: HOSTED_CHAT_INPUT_TOO_LARGE_ERROR_CODE,
			max_chars: MAX_HOSTED_CHAT_INPUT_TEXT_CHARS,
			actual_chars: actualChars,
		},
	};
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

	if (!message && !steerQueuedMessageId && !replayQueuedMessageId) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "message_missing";
		emitWideEvent("error");
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
			wideEvent.outcome = "error";
			wideEvent.status_code = 400;
			wideEvent.error_code = validationError.errorCode;
			emitWideEvent("error");
			sendJson(response, 400, validationError.payload);
			return;
		}
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
	type HostedChatBranchInput = Parameters<typeof prepareHostedChatBranch>[0] & {
		pendingMessages?: UIMessage[];
	};
	let storedChatMessages: NonNullable<HostedChatBranchInput["storedMessages"]>;
	let preparedBranch: ReturnType<typeof prepareHostedChatBranch>;
	let shouldTruncateChatBranch: boolean;
	let notesContext: string;
	let attachedNoteContext: string;
	let recipeContext: string;
	let userProfileContext: unknown;
	let selectedAppConnections: Awaited<
		ReturnType<typeof getSelectedAppConnections>
	>;
	let selectedAppSourceInstructions: string;
	let appTools: Awaited<ReturnType<typeof buildConvexWorkspaceToolSet>>;
	let localFolderRoots: Awaited<ReturnType<typeof resolveLocalFolderRoots>>;
	let localFolderContext: string;
	let coreToolPolicy: ReturnType<typeof buildCoreChatToolPolicy>;
	let automationContext: ReturnType<typeof buildChatAutomationContext>;
	let agent: ReturnType<typeof buildHostedChatRunPlan>["agent"];
	let finalizedToolSet: ReturnType<
		typeof buildHostedChatRunPlan
	>["finalizedToolSet"];
	let systemPrompt: string;
	let tools: ReturnType<typeof buildHostedChatRunPlan>["tools"];
	let chatMessages: UIMessage<unknown, never, InferUITools<typeof tools>>[];
	let lastUserMessage: UIMessage | undefined;
	let shouldGenerateChatTitle: boolean;
	let activeStreamSession: HostedActiveStreamSession | null = null;
	try {
		storedChatMessages = await convexClient.query(
			api.chats.getMessagesSnapshot,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);
		const runEvents =
			continueRunId && attachableRun?._id === continueRunId
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
		logLatency("convex.messages_loaded", {
			messageCount: storedChatMessages.length,
		});
		const branchInput: HostedChatBranchInput = {
			interruptedAssistantMessageIds,
			message: effectiveMessage,
			messageId,
			pendingMessages: pendingSteerMessages,
			storedMessages: storedChatMessages,
			trigger,
		};
		preparedBranch = prepareHostedChatBranch(branchInput);
		shouldTruncateChatBranch = preparedBranch.shouldTruncateChatBranch;

		if (shouldTruncateChatBranch && preparedBranch.truncateMessageId) {
			try {
				await convexClient.mutation(api.chats.truncateFromMessage, {
					workspaceId: resolvedWorkspaceId,
					chatId: id,
					messageId: preparedBranch.truncateMessageId,
				});
			} catch (error) {
				if (
					queuedInput.hasClaimed &&
					!(await cleanupClaimedSteerQueuedMessage(
						"steer_queue_branch_truncate_cleanup",
					))
				) {
					return;
				}
				recordServerError({
					details: {
						message_id: preparedBranch.truncateMessageId,
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
				return;
			}
		}
		logLatency("chat.branch_ready", {
			incomingMessageCount: preparedBranch.incomingMessages.length,
			shouldTruncateChatBranch,
		});

		notesContext = await getNotesContext({
			convexToken,
			mentions,
			workspaceId,
		});
		attachedNoteContext = resolvedNoteId
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
		recipeContext = getHostedChatRecipeContext(selectedRecipe);
		userProfileContext = await convexClient.query(
			api.userPreferences.getAiProfileContext,
			{},
		);
		selectedAppConnections = appsEnabled
			? await getSelectedAppConnections({
					convexToken,
					selectedSourceIds,
					workspaceId,
				})
			: [];
		selectedAppSourceInstructions = buildSelectedAppSourceInstructions(
			selectedAppConnections,
		);
		logLatency("context.sources_loaded", {
			appConnectionCount: selectedAppConnections.length,
			hasAttachedNoteContext: attachedNoteContext.length > 0,
			hasNotesContext: notesContext.length > 0,
			hasRecipeContext: recipeContext.length > 0,
			hasUserProfileContext: Boolean(userProfileContext),
		});
		appTools = await buildConvexWorkspaceToolSet({
			connections: selectedAppConnections,
			convexClient,
			workspaceId: resolvedWorkspaceId,
		});
		localFolderRoots = canUseLocalFolderTools()
			? await resolveLocalFolderRoots(
					localFolders.reduce<string[]>((paths, folder) => {
						if (typeof folder?.path === "string" && folder.path.length > 0) {
							paths.push(folder.path);
						}
						return paths;
					}, []),
				)
			: [];
		localFolderContext = buildLocalFolderSystemContext(localFolderRoots);
		logLatency("tools.workspace_ready", {
			appToolCount: Object.keys(appTools).length,
			localFolderCount: localFolderRoots.length,
		});
		coreToolPolicy = buildCoreChatToolPolicy({
			chatAttachmentsApi: api.chatAttachments,
			convexClient,
			message: effectiveMessage,
			webSearchEnabled,
		});
		automationContext = buildChatAutomationContext({
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
		({ agent, finalizedToolSet, systemPrompt, tools } = buildHostedChatRunPlan({
			additionalAgentTools: {
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
			model: resolvedModel.model,
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

	if (
		trigger !== "regenerate-message" &&
		!continueRunId &&
		!supersedeActiveRun
	) {
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
	const sameActiveRun = await turnController.requireSameActiveRun({
		continueRunId,
	});
	if (!sameActiveRun.ok) {
		sendTurnControllerError(sameActiveRun);
		return;
	}
	let pendingQueuedAcceptanceHeaders: Record<string, string> | null = null;
	if (lastUserMessage) {
		const isQueuedAccept = Boolean(
			(continueRunId && queuedInput.hasClaimed) ||
				(replayQueuedMessageId && !continueRunId),
		);
		try {
			const saveMessageArgs = buildHostedChatSaveMessageArgs({
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				noteId: resolvedNoteId,
				model: resolvedModel.model,
				reasoningEffort: resolvedReasoningEffort,
				message: lastUserMessage,
			});
			if (continueRunId && queuedInput.hasClaimed) {
				const acceptedQueuedMessageId = queuedInput.claimedQueuedMessageId;
				if (!acceptedQueuedMessageId) {
					throw new Error("Claimed steered queued message is missing.");
				}
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
						queuedMessageId: queuedInput.claimedQueuedMessageIds[index],
						message: buildHostedChatSaveMessageArgs({
							workspaceId: resolvedWorkspaceId,
							chatId: id,
							noteId: resolvedNoteId,
							model: resolvedModel.model,
							reasoningEffort: resolvedReasoningEffort,
							message: steeredMessage,
						}).message,
					})),
				});
				pendingQueuedAcceptanceHeaders = getHostedChatSteerAcceptanceHeaders({
					queuedMessageId: acceptedQueuedMessageId,
					queuedMessageIds: queuedInput.claimedQueuedMessageIds,
					turnId: continueRunId,
				});
				acceptedSteerTurnId = continueRunId;
				queuedInput.clearClaimed();
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
	let assistantRun: {
		_id: Id<"assistantRuns">;
		chatId: Id<"chats">;
	} | null = null;
	try {
		assistantRun =
			continueRunId && attachableRun?._id === continueRunId
				? attachableRun
				: await convexClient.mutation(api.assistantRuns.startAssistantRun, {
						workspaceId: resolvedWorkspaceId,
						chatId: id,
						assistantMessageId,
						model: resolvedModel.model,
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
					recordServerError({
						error: failError,
						event: wideEvent,
						operation: "assistant_run_start_failure_terminalize",
					});
				});
		}
		activeStreamSession?.cleanup();
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "stream_start_failed";
		recordServerError({
			error,
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
	if (!assistantRun || !activeStreamSession) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "stream_start_failed";
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
		stream: responseStream,
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
