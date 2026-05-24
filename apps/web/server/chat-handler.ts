import type { IncomingMessage, ServerResponse } from "node:http";
import { openai } from "@ai-sdk/openai";
import {
	consumeStream,
	createAgentUIStream,
	createIdGenerator,
	generateText,
	type InferUITools,
	pipeUIMessageStreamToResponse,
	stepCountIs,
	ToolLoopAgent,
	type ToolSet,
	type UIMessage,
	type UIMessageChunk,
	validateUIMessages,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
	resolveLocalFolderRoots,
} from "../../../packages/ai/src/local-folder-tools.mjs";
import { extractTextFromUIMessage } from "../../../packages/ai/src/local-path-references.mjs";
import { addOpenAIToolSearch } from "../../../packages/ai/src/openai-tool-search.mjs";
import {
	buildChatSystemPrompt,
	CHAT_TITLE_SYSTEM_PROMPT,
} from "../../../packages/ai/src/prompts.mjs";
import {
	CHAT_TITLE_MODEL_ID,
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

const MAX_CHAT_PREVIEW_LENGTH = 180;
const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_NOTE_CONTEXT_LENGTH = 16000;
const generateMessageId = createIdGenerator({
	prefix: "msg",
	size: 16,
});
const ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;
const activeChatStreamControllers = new Map<string, AbortController>();
const AI_LATENCY_DEBUG_ENABLED = process.env.OPENGRAN_AI_LATENCY_DEBUG === "1";

const shouldEnableImageGeneration = (message: UIMessage) =>
	/\b(create|draw|generate|make|render)\b[\s\S]{0,80}\b(image|picture|photo|illustration|art|graphic|logo|avatar)\b/iu.test(
		extractTextFromUIMessage(message),
	);

const canUseLocalFolderTools = () => process.env.OPENGRAN_ENV_MODE === "local";

class ActiveChatStreamPersister {
	#buffer = "";
	#chatId: string;
	#convexClient: ConvexHttpClient;
	#flushPromise: Promise<void> | null = null;
	#flushTimer: ReturnType<typeof setTimeout> | null = null;
	#messageId: string;
	#workspaceId: Id<"workspaces">;

	constructor(
		convexClient: ConvexHttpClient,
		workspaceId: Id<"workspaces">,
		chatId: string,
		messageId: string,
	) {
		this.#chatId = chatId;
		this.#convexClient = convexClient;
		this.#messageId = messageId;
		this.#workspaceId = workspaceId;
	}

	get messageId() {
		return this.#messageId;
	}

	async start() {
		await this.#convexClient.mutation(api.chats.startActiveStream, {
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			messageId: this.#messageId,
		});
	}

	append(delta: string) {
		if (!delta) {
			return;
		}

		this.#buffer += delta;

		if (this.#flushTimer) {
			return;
		}

		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null;
			void this.flush();
		}, ACTIVE_STREAM_FLUSH_INTERVAL_MS);
	}

	async flush() {
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}

		while (this.#buffer) {
			const delta = this.#buffer;
			this.#buffer = "";
			const previousFlush = this.#flushPromise ?? Promise.resolve();
			const flushPromise = previousFlush
				.then(() =>
					this.#convexClient.mutation(api.chats.appendActiveStreamText, {
						workspaceId: this.#workspaceId,
						chatId: this.#chatId,
						messageId: this.#messageId,
						delta,
					}),
				)
				.then(() => undefined)
				.catch((error) => {
					console.error("Failed to persist active chat stream", error);
				});

			this.#flushPromise = flushPromise;
			await flushPromise;

			if (this.#flushPromise === flushPromise) {
				this.#flushPromise = null;
			}
		}

		await this.#flushPromise;
	}

	async finish(status: "done" | "error") {
		await this.flush();
		await this.#convexClient
			.mutation(api.chats.finishActiveStream, {
				workspaceId: this.#workspaceId,
				chatId: this.#chatId,
				messageId: this.#messageId,
				status,
			})
			.catch((error) => {
				console.error("Failed to finish active chat stream", error);
			});
	}
}

const getActiveChatStreamKey = (
	workspaceId: Id<"workspaces">,
	chatId: string,
) => `${workspaceId}:${chatId}`;

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

const getRecipeContext = (
	selectedRecipe:
		| {
				slug: string;
				name: string;
				prompt: string;
		  }
		| null
		| undefined,
) => {
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

const clampWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const clampNoteContext = (value: string) =>
	value.replace(/\r/g, "").trim().slice(0, MAX_NOTE_CONTEXT_LENGTH);

const getMessageText = (message: UIMessage) =>
	clampWhitespace(
		message.parts
			.flatMap((part) =>
				part.type === "text" &&
				typeof part.text === "string" &&
				part.text.length > 0
					? [part.text]
					: [],
			)
			.join("\n\n"),
	);

const generateChatTitle = async ({
	userMessage,
	assistantMessage,
}: {
	userMessage: UIMessage;
	assistantMessage?: UIMessage;
}) => {
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

const getChatPreviewFromMessage = (message: UIMessage) =>
	truncate(getMessageText(message), MAX_CHAT_PREVIEW_LENGTH);

const toStoredMessage = (message: UIMessage) => ({
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

const parseStoredMessagePartsForModelInput = (
	partsJson: string,
): UIMessage["parts"] => {
	try {
		const parts = JSON.parse(partsJson) as UIMessage["parts"];
		if (!Array.isArray(parts)) {
			return [];
		}

		return parts.flatMap((part) =>
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0
				? [{ type: "text" as const, text: part.text }]
				: [],
		);
	} catch {
		return [];
	}
};

const fromStoredMessages = (
	messages: Array<{
		id: string;
		role: "system" | "user" | "assistant";
		partsJson: string;
		metadataJson?: string;
	}>,
): UIMessage[] =>
	messages.flatMap((message) => {
		const parts = parseStoredMessagePartsForModelInput(message.partsJson);

		if (parts.length === 0) {
			return [];
		}

		return [
			{
				id: message.id,
				role: message.role,
				metadata: message.metadataJson
					? (JSON.parse(message.metadataJson) as UIMessage["metadata"])
					: undefined,
				parts,
			},
		];
	});

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

const getInlineNoteContext = ({
	title,
	text,
}: {
	title?: string;
	text?: string;
}) => {
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
			? [...fromStoredMessages(baseStoredMessages), message]
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
	const imageGenerationEnabled = Boolean(
		convexClient && shouldEnableImageGeneration(message),
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
		defaultModel: resolvedModel.model,
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
	const enabledTools: ToolSet = {};

	if (webSearchEnabled) {
		enabledTools.web_search = openai.tools.webSearch({
			searchContextSize: "medium",
			userLocation: {
				type: "approximate",
				country: "US",
			},
		});
	}

	if (imageGenerationEnabled && convexClient) {
		enabledTools.generate_image = createImageGenerationTool({
			uploadGeneratedImage: createConvexGeneratedImageUploader({
				chatAttachmentsApi: api.chatAttachments,
				client: convexClient,
			}),
		});
	}

	Object.assign(enabledTools, automationContext.tools);
	Object.assign(enabledTools, appTools);
	if (localFolderRoots.length > 0) {
		Object.assign(enabledTools, buildLocalFolderTools(localFolderRoots));
	}

	const tools = addOpenAIToolSearch(enabledTools);
	const hasEnabledTools = Object.keys(tools).length > 0;
	logLatency("tools.finalized", {
		hasEnabledTools,
		toolCount: Object.keys(tools).length,
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
			await convexClient.mutation(api.chats.saveMessage, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				noteId: resolvedNoteId ?? undefined,
				preview: getChatPreviewFromMessage(lastUserMessage),
				model: resolvedModel.model,
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

	const activeStreamPersister =
		convexClient && id && resolvedWorkspaceId
			? new ActiveChatStreamPersister(
					convexClient,
					resolvedWorkspaceId,
					id,
					`stream-${crypto.randomUUID()}`,
				)
			: null;
	const activeStreamAbortController = activeStreamPersister
		? new AbortController()
		: null;
	const activeStreamKey =
		activeStreamPersister && id && resolvedWorkspaceId
			? getActiveChatStreamKey(resolvedWorkspaceId, id)
			: null;

	if (activeStreamPersister) {
		try {
			if (activeStreamKey && activeStreamAbortController) {
				activeChatStreamControllers.get(activeStreamKey)?.abort("superseded");
				activeChatStreamControllers.set(
					activeStreamKey,
					activeStreamAbortController,
				);
			}
			await activeStreamPersister.start();
		} catch (error) {
			console.error("Failed to start active chat stream", error);
		}
	}
	logLatency("convex.active_stream_started", {
		enabled: Boolean(activeStreamPersister),
	});

	const agent = new ToolLoopAgent({
		model: openai(resolvedModel.model),
		providerOptions,
		instructions: systemPrompt,
		tools: hasEnabledTools ? tools : undefined,
		stopWhen: hasEnabledTools ? stepCountIs(5) : undefined,
	});
	logLatency("ai.agent_created", {
		hasEnabledTools,
		systemPromptLength: systemPrompt.length,
	});

	const streamLatencyTracker =
		createChatStreamLatencyTracker<UIMessageChunk>(logLatency);
	const stream = await createAgentUIStream({
		agent,
		uiMessages: chatMessages,
		abortSignal: activeStreamAbortController?.signal,
		originalMessages: chatMessages,
		generateMessageId,
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
					model: resolvedModel.model,
					reasoningEffort: resolvedReasoningEffort,
					message: toStoredMessage(responseMessage),
				});
				await activeStreamPersister?.finish("done");
			} catch (error) {
				console.error("Failed to persist assistant chat message", error);
				await activeStreamPersister?.finish("error");
			} finally {
				if (
					activeStreamKey &&
					activeStreamAbortController &&
					activeChatStreamControllers.get(activeStreamKey) ===
						activeStreamAbortController
				) {
					activeChatStreamControllers.delete(activeStreamKey);
				}
			}
		},
		onError: () => "Something went wrong.",
	});
	logLatency("ai.stream_created");
	const persistedStream = streamLatencyTracker.wrapStream(stream).pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (chunk.type === "text-delta") {
					activeStreamPersister?.append(chunk.delta);
				}

				controller.enqueue(chunk);
			},
		}),
	);

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

	const streamKey = getActiveChatStreamKey(resolvedWorkspaceId, id);
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
