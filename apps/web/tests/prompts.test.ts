import { describe, expect, it } from "vitest";
import { deriveFallbackChatTitle } from "../../../packages/ai/src/chat-titles.mjs";
import { buildHostedChatAgentToolSet } from "../../../packages/ai/src/hosted-chat-agent.mjs";
import {
	buildHostedChatRuntimePrompt,
	buildHostedChatSaveMessageArgs,
	buildHostedNotesContext,
	fromHostedStoredMessages,
	getHostedChatConvexRouteError,
	getHostedChatReplayAcceptanceHeaders,
	getHostedChatSteerAcceptanceHeaders,
	getHostedChatSteerTelemetry,
	getStoredHostedNoteContext,
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerTurnIdHeader,
	prepareHostedChatBranch,
	toHostedQueuedUserMessage,
	validateHostedChatActiveRunPolicy,
	validateHostedChatRequestInput,
	validateHostedChatSteerRoute,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import {
	buildApplyTemplatePrompt,
	buildChatSystemPrompt,
	buildEnhancedNotePrompt,
	CHAT_TITLE_SYSTEM_PROMPT,
} from "../../../packages/ai/src/prompts.mjs";

describe("prompt helpers", () => {
	it("keeps wait_agent without exposing subagent tools", () => {
		const { agentTools } = buildHostedChatAgentToolSet({
			additionalAgentTools: {
				wait_agent: {
					description: "Wait for active-turn input.",
				},
			},
			enabledTools: {},
		});

		expect(agentTools).toHaveProperty("wait_agent");
		for (const removedTool of [
			"followup_task",
			"interrupt_agent",
			"list_agents",
			"send_message",
			"spawn_agent",
		]) {
			expect(agentTools).not.toHaveProperty(removedTool);
		}
	});

	it("skips nullable user profile fields in the chat system prompt", () => {
		expect(() =>
			buildChatSystemPrompt({
				userProfileContext: {
					name: null,
					jobTitle: null,
					companyName: null,
				},
			}),
		).not.toThrow();
	});

	it("accepts nullable note fields in note prompts", () => {
		expect(() =>
			buildEnhancedNotePrompt({
				title: null,
				rawNotes: null,
				transcript: null,
				noteText: null,
			}),
		).not.toThrow();
		expect(() =>
			buildApplyTemplatePrompt({
				title: null,
				templateName: null,
				meetingContext: null,
				templateSections: [],
				noteText: null,
			}),
		).not.toThrow();
	});

	it("tells chat title generation to preserve proper-name capitalization", () => {
		expect(CHAT_TITLE_SYSTEM_PROMPT).toContain(
			"Preserve the original capitalization of proper nouns",
		);
		expect(CHAT_TITLE_SYSTEM_PROMPT).toContain("OpenAI");
		expect(CHAT_TITLE_SYSTEM_PROMPT).toContain("Cirrus Labs");
	});

	it("preserves organization and people name casing in fallback chat titles", () => {
		expect(
			deriveFallbackChatTitle({
				userText: "why did OpenAI hire Sam Altman for GPT-5 work?",
			}),
		).toBe("OpenAI hire Sam Altman");
	});

	it("maps missing chat Convex errors to route errors", () => {
		const error = Object.assign(new Error("Chat not found."), {
			data: { code: "CHAT_NOT_FOUND", message: "Chat not found." },
		});

		expect(getHostedChatConvexRouteError(error)).toEqual({
			error: "Chat not found.",
			errorCode: "CHAT_NOT_FOUND",
			statusCode: 409,
		});
	});

	it("maps stale assistant run transition errors to route conflicts", () => {
		const error = Object.assign(
			new Error(
				'Uncaught ConvexError: {"code":"INVALID_ASSISTANT_RUN_TRANSITION","message":"Assistant run cannot accept steered user input."}',
			),
			{},
		);

		expect(getHostedChatConvexRouteError(error)).toEqual({
			error: "Assistant run cannot accept steered user input.",
			errorCode: "INVALID_ASSISTANT_RUN_TRANSITION",
			statusCode: 409,
		});
	});

	it("maps missing Convex chat API functions to deployment skew route errors", () => {
		for (const missingFunction of [
			"assistantQueuedMessages:claimReadyForRun",
			"assistantQueuedMessages:enqueueForActiveRun",
			"assistantQueuedMessages:getClaimedForChat",
			"assistantRuns:getAttachableRun",
			"assistantRuns:appendUserMessageToAssistantRun",
		]) {
			expect(
				getHostedChatConvexRouteError(
					new Error(`Could not find public function for '${missingFunction}'.`),
				),
			).toEqual({
				error: expect.stringContaining(
					`Convex deployment is out of sync with this Graneri checkout. Missing Convex function: ${missingFunction}.`,
				),
				errorCode: "convex_deployment_out_of_sync",
				statusCode: 500,
			});
		}
	});

	it("includes selected app source instructions in hosted chat runtime prompts", () => {
		const prompt = buildHostedChatRuntimePrompt({
			selectedAppSourceInstructions:
				"The selected app source for this chat is Linear.",
		});

		expect(prompt).toContain(
			"The selected app source for this chat is Linear.",
		);
	});

	it("formats attached hosted note context consistently", () => {
		const context = buildHostedNotesContext([
			{ title: "Decision log", searchableText: "Ship desktop first." },
			{ title: "Empty note", searchableText: "" },
		]);

		expect(context).toContain(
			"Attached notes are available below. Use them when they are relevant to the user's request.",
		);
		expect(context).toContain("Note 1: Decision log\nShip desktop first.");
		expect(context).toContain("Note 2: Empty note\n(empty note)");
	});

	it("omits attached hosted note context when no notes are selected", () => {
		expect(buildHostedNotesContext([])).toBe("");
	});

	it("formats stored hosted note context consistently", () => {
		const context = getStoredHostedNoteContext({
			title: "Planning",
			searchableText: "Line 1\r\nLine 2",
		});

		expect(context).toContain(
			"The current note is attached below. Use it as the primary context for this chat.",
		);
		expect(context).toContain("Current note title: Planning");
		expect(context).toContain("Current note content:\nLine 1\nLine 2");
	});

	it("omits stored hosted note context when the note is unavailable", () => {
		expect(getStoredHostedNoteContext(null)).toBe("");
	});

	it("builds hosted chat save message arguments consistently", () => {
		const saved = buildHostedChatSaveMessageArgs({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			noteId: null,
			title: "Generated title",
			model: "gpt-5",
			reasoningEffort: "medium",
			message: {
				id: "msg-1",
				role: "user",
				parts: [{ type: "text", text: "Hello from Graneri" }],
			},
		});

		expect(saved.workspaceId).toBe("workspace-1");
		expect(saved.chatId).toBe("chat-1");
		expect(saved.noteId).toBeUndefined();
		expect(saved.title).toBe("Generated title");
		expect(saved.preview).toBe("Hello from Graneri");
		expect(saved.model).toBe("gpt-5");
		expect(saved.reasoningEffort).toBe("medium");
		expect(saved.message.id).toBe("msg-1");
		expect(saved.message.text).toBe("Hello from Graneri");
	});

	it("builds app-server-style steer acceptance headers", () => {
		expect(
			getHostedChatSteerAcceptanceHeaders({
				queuedMessageId: "queued-1",
				turnId: "run-1",
			}),
		).toEqual({
			[hostedChatSteerAcceptedHeader]: "true",
			[hostedChatSteerQueuedMessageIdHeader]: "queued-1",
			[hostedChatSteerTurnIdHeader]: "run-1",
		});
	});

	it("builds replay acceptance headers", () => {
		expect(
			getHostedChatReplayAcceptanceHeaders({
				queuedMessageId: "queued-1",
			}),
		).toEqual({
			[hostedChatReplayAcceptedHeader]: "true",
			[hostedChatReplayQueuedMessageIdHeader]: "queued-1",
		});
	});

	it("builds app-server-style steer telemetry", () => {
		expect(
			getHostedChatSteerTelemetry({
				acceptedTurnId: "run-1",
				errorCode: "stream_start_failed",
				expectedTurnId: "run-1",
				isSteerRoute: true,
				outcome: "error",
				queuedMessageId: "queued-1",
			}),
		).toEqual({
			turn_steer_accepted_turn_id: "run-1",
			turn_steer_expected_turn_id: "run-1",
			turn_steer_num_input_images: 0,
			turn_steer_queued_message_id: "queued-1",
			turn_steer_rejection_reason: null,
			turn_steer_result: "accepted",
		});
		expect(
			getHostedChatSteerTelemetry({
				errorCode: "active_run_mismatch",
				expectedTurnId: "run-1",
				isSteerRoute: true,
				outcome: "error",
				queuedMessageId: "queued-1",
			}),
		).toMatchObject({
			turn_steer_accepted_turn_id: null,
			turn_steer_rejection_reason: "expected_turn_mismatch",
			turn_steer_result: "rejected",
		});
		expect(
			getHostedChatSteerTelemetry({
				errorCode: "queued_message_unavailable",
				isSteerRoute: false,
				outcome: "error",
				queuedMessageId: "queued-1",
			}),
		).toMatchObject({
			turn_steer_rejection_reason: "queued_message_unavailable",
			turn_steer_result: "rejected",
		});
		expect(
			getHostedChatSteerTelemetry({
				errorCode: "input_empty",
				isSteerRoute: false,
				outcome: "error",
				queuedMessageId: null,
			}),
		).toBeNull();
	});

	it("validates the app-server-style steer route contract", () => {
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "run-1",
				isSteerRoute: true,
				replayQueuedMessageId: null,
				steerQueuedMessageId: "queued-1",
			}),
		).toBeNull();
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "run-1",
				isSteerRoute: false,
				replayQueuedMessageId: null,
				steerQueuedMessageId: "queued-1",
			}),
		).toMatchObject({
			errorCode: "steer_route_required",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: null,
				isSteerRoute: true,
				replayQueuedMessageId: null,
				steerQueuedMessageId: "queued-1",
			}),
		).toMatchObject({
			errorCode: "steer_context_missing",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "run-1",
				isSteerRoute: true,
				replayQueuedMessageId: "queued-replay-1",
				steerQueuedMessageId: "queued-steer-1",
			}),
		).toMatchObject({
			errorCode: "queued_message_mode_conflict",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "run-1",
				hasMessage: true,
				isSteerRoute: true,
				replayQueuedMessageId: null,
				steerQueuedMessageId: "queued-1",
			}),
		).toMatchObject({
			errorCode: "queued_message_body_conflict",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: null,
				hasMessage: true,
				isSteerRoute: false,
				replayQueuedMessageId: "queued-replay-1",
				steerQueuedMessageId: null,
			}),
		).toMatchObject({
			errorCode: "queued_message_body_conflict",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "run-1",
				isSteerRoute: false,
				replayQueuedMessageId: "queued-replay-1",
				steerQueuedMessageId: null,
			}),
		).toMatchObject({
			errorCode: "queued_replay_active_run_conflict",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "",
				isSteerRoute: true,
				replayQueuedMessageId: null,
				steerQueuedMessageId: "queued-1",
			}),
		).toMatchObject({
			errorCode: "continue_run_id_invalid",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: null,
				isSteerRoute: false,
				replayQueuedMessageId: 42,
				steerQueuedMessageId: null,
			}),
		).toMatchObject({
			errorCode: "replay_queued_message_id_invalid",
			statusCode: 400,
		});
		expect(
			validateHostedChatSteerRoute({
				continueRunId: "run-1",
				isSteerRoute: true,
				replayQueuedMessageId: null,
				steerQueuedMessageId: {},
			}),
		).toMatchObject({
			errorCode: "steer_queued_message_id_invalid",
			statusCode: 400,
		});
	});

	it("validates hosted chat request input before route execution", () => {
		expect(
			validateHostedChatRequestInput({
				message: null,
				replayQueuedMessageId: null,
				steerQueuedMessageId: null,
			}),
		).toMatchObject({
			errorCode: "message_missing",
			payload: {
				error: "message is required.",
			},
			statusCode: 400,
		});
		expect(
			validateHostedChatRequestInput({
				message: {
					id: "empty-user",
					role: "user",
					parts: [{ type: "text", text: "   " }],
				},
				replayQueuedMessageId: null,
				steerQueuedMessageId: null,
			}),
		).toMatchObject({
			errorCode: "input_empty",
			payload: {
				error: "input must not be empty",
			},
			statusCode: 400,
		});
		expect(
			validateHostedChatRequestInput({
				message: null,
				replayQueuedMessageId: "queued-1",
				steerQueuedMessageId: null,
			}),
		).toBeNull();
	});

	it("reconstructs accepted steer messages from durable queued content", () => {
		expect(
			toHostedQueuedUserMessage({
				messageId: "queued-message-1",
				metadataJson: JSON.stringify({ client: "ignored-for-trust" }),
				partsJson: JSON.stringify([
					{ type: "text", text: "Use the queued text" },
					{ type: "file", url: "file://not-model-input" },
				]),
			}),
		).toEqual({
			id: "queued-message-1",
			role: "user",
			metadata: { client: "ignored-for-trust" },
			parts: [{ type: "text", text: "Use the queued text" }],
		});
		expect(() =>
			toHostedQueuedUserMessage({
				messageId: "queued-message-empty",
				partsJson: JSON.stringify([{ type: "text", text: "   " }]),
			}),
		).toThrow("Queued chat message cannot be empty.");
	});

	it("replays stored hosted messages with tolerant parsing", () => {
		const messages = fromHostedStoredMessages([
			{
				id: "invalid-parts",
				role: "assistant",
				partsJson: "{",
				metadataJson: '{"status":"ignored"}',
			},
			{
				id: "empty-parts",
				role: "assistant",
				partsJson: JSON.stringify([{ type: "file", url: "file://local" }]),
			},
			{
				id: "valid-text",
				role: "user",
				partsJson: JSON.stringify([
					{ type: "text", text: "Replay this" },
					{ type: "text", text: "" },
				]),
				metadataJson: "{",
			},
		]);

		expect(messages).toEqual([
			{
				id: "valid-text",
				role: "user",
				metadata: undefined,
				parts: [{ type: "text", text: "Replay this" }],
			},
		]);
	});

	it("prepares edited hosted chat branches from stored snapshots", () => {
		const branch = prepareHostedChatBranch({
			message: {
				id: "edited-message",
				role: "user",
				parts: [{ type: "text", text: "Edited question" }],
			},
			messageId: "msg-2",
			storedMessages: [
				{
					id: "msg-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Original" }]),
				},
				{
					id: "msg-2",
					role: "assistant",
					partsJson: JSON.stringify([{ type: "text", text: "Old answer" }]),
				},
			],
			trigger: "submit-message",
		});

		expect(branch.editedMessageIndex).toBe(1);
		expect(branch.shouldTruncateChatBranch).toBe(true);
		expect(branch.truncateMessageId).toBe("msg-2");
		expect(branch.incomingMessages.map((message) => message.id)).toEqual([
			"msg-1",
			"edited-message",
		]);
	});

	it("omits every interrupted assistant segment from continued run context", () => {
		const branch = prepareHostedChatBranch({
			interruptedAssistantMessageIds: [
				"assistant-interrupted-1",
				"assistant-interrupted-2",
			],
			message: {
				id: "steer-2",
				role: "user",
				parts: [{ type: "text", text: "Second steer" }],
			},
			storedMessages: [
				{
					id: "prompt-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "First prompt" }]),
				},
				{
					id: "assistant-interrupted-1",
					role: "assistant",
					partsJson: JSON.stringify([
						{ type: "text", text: "Partial answer one" },
					]),
				},
				{
					id: "steer-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "First steer" }]),
				},
				{
					id: "assistant-interrupted-2",
					role: "assistant",
					partsJson: JSON.stringify([
						{ type: "text", text: "Partial answer two" },
					]),
				},
			],
			trigger: "submit-message",
		});

		expect(branch.incomingMessages.map((message) => message.id)).toEqual([
			"prompt-1",
			"steer-1",
			"steer-2",
		]);
	});

	it("drains active-turn pending input into continued run context once", () => {
		const branch = prepareHostedChatBranch({
			message: {
				id: "steer-2",
				role: "user",
				parts: [{ type: "text", text: "Second steer" }],
			},
			pendingMessages: [
				{
					id: "steer-1",
					role: "user",
					parts: [{ type: "text", text: "First steer" }],
				},
				{
					id: "steer-2",
					role: "user",
					parts: [{ type: "text", text: "Second steer" }],
				},
			],
			storedMessages: [
				{
					id: "prompt-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "First prompt" }]),
				},
				{
					id: "steer-1",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "First steer" }]),
				},
			],
			trigger: "submit-message",
		});

		expect(branch.incomingMessages.map((message) => message.id)).toEqual([
			"prompt-1",
			"steer-1",
			"steer-2",
		]);
	});

	it("prepares regenerated hosted chat branches even when the snapshot is stale", () => {
		const branch = prepareHostedChatBranch({
			message: {
				id: "retry-message",
				role: "user",
				parts: [{ type: "text", text: "Try again" }],
			},
			messageId: "missing-message",
			storedMessages: [],
			trigger: "regenerate-message",
		});

		expect(branch.editedMessageIndex).toBe(-1);
		expect(branch.shouldTruncateChatBranch).toBe(true);
		expect(branch.truncateMessageId).toBe("missing-message");
		expect(branch.incomingMessages).toHaveLength(1);
	});

	it("rejects new sends when an active run is still attachable", () => {
		expect(
			validateHostedChatActiveRunPolicy({
				attachableRun: { _id: "run-1" },
				trigger: "submit-message",
			}),
		).toEqual({
			activeRunId: "run-1",
			error: "Chat already has an active assistant run.",
			errorCode: "active_run_exists",
			statusCode: 409,
		});
	});

	it("allows active run continuations, regeneration, and superseding sends", () => {
		const attachableRun = { _id: "run-1" };

		expect(
			validateHostedChatActiveRunPolicy({
				attachableRun,
				continueRunId: "run-1",
				trigger: "submit-message",
			}),
		).toBeNull();
		expect(
			validateHostedChatActiveRunPolicy({
				attachableRun,
				trigger: "regenerate-message",
			}),
		).toBeNull();
		expect(
			validateHostedChatActiveRunPolicy({
				attachableRun,
				supersedeActiveRun: true,
				trigger: "submit-message",
			}),
		).toBeNull();
	});
});
