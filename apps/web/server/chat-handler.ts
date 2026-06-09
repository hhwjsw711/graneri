import type { IncomingMessage, ServerResponse } from "node:http";
import {
	consumeStream,
	createAgentUIStream,
	type InferUITools,
	pipeUIMessageStreamToResponse,
	type ToolSet,
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
	createHostedActiveStreamKey,
	createHostedActiveStreamSession,
	HostedActiveChatStreamPersister,
	pipeHostedActiveStreamText,
} from "../../../packages/ai/src/hosted-chat-active-stream.mjs";
import { createHostedChatAgent } from "../../../packages/ai/src/hosted-chat-agent.mjs";
import {
	buildHostedChatRuntimePrompt,
	buildHostedChatSaveMessageArgs,
	buildHostedNotesContext,
	fromHostedStoredMessages,
	generateHostedChatMessageId,
	generateHostedChatTitle,
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
	getStoredHostedNoteContext,
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

const activeChatStreamControllers = new Map<string, AbortController>();
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

	const allSelectedSourceIds = selectedSourceIds ?? [];

	if (allSelectedSourceIds.length === 0) {
		return [];
	}

	const sourceIds = getSelectedAppSourceIds(selectedSourceIds);
	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const googleSources = await client
		.action(api.googleTools.listAvailableSources, {
			workspaceId: workspaceId as Id<"workspaces">,
		})
		.catch(() => []);

	if (sourceIds.length === 0) {
		return googleSources.filter((source) =>
			allSelectedSourceIds.includes(source.id),
		);
	}

	const connections = await client.action(
		api.appConnectionActions.getSelectedForChatWithFreshTokens,
		{
			workspaceId: workspaceId as Id<"workspaces">,
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
	if (!process.env.OPENAI_API_KEY) {
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
		sendJson(response, 400, {
			error: "message is required.",
		});
		return;
	}

	if (!convexToken || !resolvedWorkspaceId) {
		sendJson(response, 400, {
			error: "convexToken and workspaceId are required.",
		});
		return;
	}

	const convexClient = id
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
	const requestedModel = model ?? storedChat?.model ?? null;

	if (!requestedModel) {
		sendJson(response, 400, {
			error: "model is required.",
		});
		return;
	}

	const resolvedModel = findChatModel(requestedModel);

	if (!resolvedModel) {
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
	const storedChatMessages =
		convexClient && id && resolvedWorkspaceId
			? await convexClient
					.query(api.chats.getMessagesSnapshot, {
						workspaceId: resolvedWorkspaceId,
						chatId: id,
					})
					.catch(() => [])
			: [];
	logLatency("convex.messages_loaded", {
		messageCount: storedChatMessages.length,
	});
	const editedMessageId = messageId ?? message?.id;
	const editedMessageIndex = editedMessageId
		? storedChatMessages.findIndex(
				(storedMessage) => storedMessage.id === editedMessageId,
			)
		: -1;
	const baseStoredMessages =
		editedMessageIndex >= 0
			? storedChatMessages.slice(0, editedMessageIndex)
			: storedChatMessages;
	const incomingMessages =
		convexClient && id
			? [...fromHostedStoredMessages(baseStoredMessages), message]
			: [message];
	const shouldTruncateChatBranch =
		convexClient &&
		id &&
		resolvedWorkspaceId &&
		messageId &&
		((trigger === "submit-message" && editedMessageIndex >= 0) ||
			trigger === "regenerate-message");

	if (shouldTruncateChatBranch) {
		try {
			await convexClient.mutation(api.chats.truncateFromMessage, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				messageId,
			});
		} catch (error) {
			console.error(
				"Failed to truncate regenerated chat message branch",
				error,
			);
		}
	}
	logLatency("chat.branch_ready", {
		incomingMessageCount: incomingMessages.length,
		shouldTruncateChatBranch,
	});

	const notesContext = await getNotesContext({
		convexToken,
		mentions,
		workspaceId,
	});
	const attachedNoteContext =
		convexClient && resolvedNoteId && resolvedWorkspaceId
			? await getStoredNoteContext({
					client: convexClient,
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
		createAutomation:
			convexClient && resolvedWorkspaceId
				? async (automation) =>
						await convexClient.mutation(api.automations.create, {
							workspaceId: resolvedWorkspaceId,
							...automation,
						})
				: null,
		defaultModel: resolvedModel.model,
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
	const enabledTools: ToolSet = { ...coreToolPolicy.enabledTools };
	Object.assign(enabledTools, automationContext.tools);
	Object.assign(enabledTools, appTools);
	if (localFolderRoots.length > 0) {
		Object.assign(enabledTools, buildLocalFolderTools(localFolderRoots));
	}

	const { agent, finalizedToolSet, tools } = createHostedChatAgent({
		enabledTools,
		model: resolvedModel.model,
		prepareStep: coreToolPolicy.prepareStep,
		providerOptions,
		systemPrompt,
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
		messages: incomingMessages,
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
		convexClient &&
			id &&
			lastUserMessage &&
			(!storedChat || storedChat.title === "New chat"),
	);
	if (convexClient && id && resolvedWorkspaceId && lastUserMessage) {
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
			console.error("Failed to persist user chat message", error);
		}
	}
	logLatency("convex.user_message_saved", {
		attempted: Boolean(
			convexClient && id && resolvedWorkspaceId && lastUserMessage,
		),
	});

	const activeStreamSession =
		convexClient && id && resolvedWorkspaceId
			? createHostedActiveStreamSession({
					controllers: activeChatStreamControllers,
					streamKey: createHostedActiveStreamKey({
						workspaceId: resolvedWorkspaceId,
						chatId: id,
					}),
					persister: new HostedActiveChatStreamPersister({
						workspaceId: resolvedWorkspaceId,
						chatId: id,
						messageId: `stream-${crypto.randomUUID()}`,
						startActiveStream: (args) =>
							convexClient.mutation(api.chats.startActiveStream, args),
						appendActiveStreamText: (args) =>
							convexClient.mutation(api.chats.appendActiveStreamText, args),
						finishActiveStream: (args) =>
							convexClient.mutation(api.chats.finishActiveStream, args),
					}),
				})
			: null;

	if (activeStreamSession) {
		try {
			await activeStreamSession.start();
		} catch (error) {
			console.error("Failed to start active chat stream", error);
		}
	}
	logLatency("convex.active_stream_started", {
		enabled: Boolean(activeStreamSession),
	});

	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const streamLatencyTracker =
		createChatStreamLatencyTracker<UIMessageChunk>(logLatency);
	const stream = await createAgentUIStream({
		agent,
		uiMessages: chatMessages,
		abortSignal: activeStreamSession?.abortSignal,
		originalMessages: chatMessages,
		generateMessageId: generateHostedChatMessageId,
		sendReasoning: true,
		sendSources: true,
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
				await convexClient.mutation(
					api.chats.saveMessage,
					buildHostedChatSaveMessageArgs({
						workspaceId: resolvedWorkspaceId,
						chatId: id,
						title: generatedChatTitle,
						noteId: resolvedNoteId,
						model: resolvedModel.model,
						reasoningEffort: resolvedReasoningEffort,
						message: responseMessage,
					}),
				);
				await activeStreamSession?.finish("done");
			} catch (error) {
				console.error("Failed to persist assistant chat message", error);
				await activeStreamSession?.finish("error");
			} finally {
				activeStreamSession?.cleanup();
			}
		},
		onError: () => "Something went wrong.",
	});
	logLatency("ai.stream_created");
	const persistedStream = pipeHostedActiveStreamText({
		persister: activeStreamSession,
		stream: streamLatencyTracker.wrapStream(stream),
	});

	pipeUIMessageStreamToResponse({
		response,
		stream: persistedStream,
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

	const streamKey = createHostedActiveStreamKey({
		workspaceId: resolvedWorkspaceId,
		chatId: id,
	});
	activeChatStreamControllers.get(streamKey)?.abort("stopped");
	activeChatStreamControllers.delete(streamKey);

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});

	await convexClient
		.mutation(api.chats.stopActiveStream, {
			workspaceId: resolvedWorkspaceId,
			chatId: id,
		})
		.catch((error) => {
			console.error("Failed to stop active chat stream", error);
		});

	sendJson(response, 200, { ok: true });
};
