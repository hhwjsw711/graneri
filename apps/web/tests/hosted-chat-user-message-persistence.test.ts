import { describe, expect, it, vi } from "vitest";
import {
	isHostedQueuedUserMessageAccept,
	persistHostedChatUserMessage,
} from "../../../packages/ai/src/hosted-chat-user-message-persistence.mjs";

const userMessage = (id: string, text: string) => ({
	id,
	role: "user",
	parts: [{ type: "text", text }],
});

const createQueuedInput = ({
	claimedQueuedMessageId = null,
	claimedQueuedMessageIds = [],
} = {}) => ({
	get claimedQueuedMessageId() {
		return claimedQueuedMessageId;
	},
	get claimedQueuedMessageIds() {
		return claimedQueuedMessageIds;
	},
	get hasClaimed() {
		return claimedQueuedMessageIds.length > 0;
	},
	clearClaimed: vi.fn(),
});

const createPersistenceArgs = (overrides = {}) => ({
	workspaceId: "workspace-1",
	chatId: "chat-1",
	noteId: null,
	model: "gpt-5",
	reasoningEffort: "medium",
	message: userMessage("user-1", "Hello"),
	queuedInput: createQueuedInput(),
	steeredUserMessages: [],
	acceptQueuedUserMessage: vi.fn(async () => null),
	acceptSteeredUserMessages: vi.fn(async () => null),
	appendUserMessageToRun: vi.fn(async () => null),
	saveMessage: vi.fn(async () => null),
	...overrides,
});

describe("hosted chat user message persistence", () => {
	it("detects queued accept intents", () => {
		expect(
			isHostedQueuedUserMessageAccept({
				continueRunId: "run-1",
				queuedInput: createQueuedInput({
					claimedQueuedMessageId: "queued-1",
					claimedQueuedMessageIds: ["queued-1"],
				}),
				replayQueuedMessageId: null,
			}),
		).toBe(true);

		expect(
			isHostedQueuedUserMessageAccept({
				continueRunId: null,
				queuedInput: createQueuedInput(),
				replayQueuedMessageId: "queued-1",
			}),
		).toBe(true);

		expect(
			isHostedQueuedUserMessageAccept({
				continueRunId: "run-1",
				queuedInput: createQueuedInput(),
				replayQueuedMessageId: "queued-1",
			}),
		).toBe(false);
	});

	it("saves normal user messages and appends continued run events", async () => {
		const args = createPersistenceArgs({ continueRunId: "run-1" });

		await expect(persistHostedChatUserMessage(args)).resolves.toEqual({
			acceptedSteerTurnId: null,
			pendingQueuedAcceptanceHeaders: null,
		});
		expect(args.saveMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: "chat-1",
				message: expect.objectContaining({ id: "user-1" }),
				model: "gpt-5",
				workspaceId: "workspace-1",
			}),
		);
		expect(args.appendUserMessageToRun).toHaveBeenCalledWith({
			runId: "run-1",
			messageId: "user-1",
		});
	});

	it("accepts claimed replay messages with replay headers", async () => {
		const args = createPersistenceArgs({
			replayQueuedMessageId: "queued-replay-1",
		});

		const result = await persistHostedChatUserMessage(args);

		expect(args.acceptQueuedUserMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				queuedMessageId: "queued-replay-1",
				message: expect.objectContaining({ id: "user-1" }),
			}),
		);
		expect(result.pendingQueuedAcceptanceHeaders).toMatchObject({
			"X-Graneri-Replay-Accepted": "true",
			"X-Graneri-Replay-Queued-Message-Id": "queued-replay-1",
		});
	});

	it("accepts claimed steer batches and clears the claim", async () => {
		const queuedInput = createQueuedInput({
			claimedQueuedMessageId: "queued-1",
			claimedQueuedMessageIds: ["queued-1", "queued-2"],
		});
		const args = createPersistenceArgs({
			continueRunId: "run-1",
			queuedInput,
			steeredUserMessages: [
				userMessage("queued-user-1", "First"),
				userMessage("queued-user-2", "Second"),
			],
		});

		const result = await persistHostedChatUserMessage(args);

		expect(args.acceptSteeredUserMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				messages: [
					expect.objectContaining({ queuedMessageId: "queued-1" }),
					expect.objectContaining({ queuedMessageId: "queued-2" }),
				],
			}),
		);
		expect(queuedInput.clearClaimed).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			acceptedSteerTurnId: "run-1",
			pendingQueuedAcceptanceHeaders: {
				"X-Graneri-Queued-Message-Id": "queued-1",
				"X-Graneri-Steer-Accepted": "true",
				"X-Graneri-Turn-Id": "run-1",
			},
		});
	});
});
