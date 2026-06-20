import { describe, expect, it, vi } from "vitest";
import {
	getHostedChatRunStartPolicy,
	startHostedChatRun,
} from "../../../packages/ai/src/hosted-chat-run-starter.mjs";

const createCallbacks = (overrides = {}) => ({
	appendActiveStreamText: vi.fn(async () => null),
	deleteActiveStreamSnapshot: vi.fn(async () => null),
	failAssistantRun: vi.fn(async () => null),
	finishActiveStreamToolCall: vi.fn(async () => null),
	startActiveStream: vi.fn(async () => null),
	startActiveStreamToolCall: vi.fn(async () => null),
	startAssistantRun: vi.fn(async () => ({ _id: "run-1" })),
	...overrides,
});

const createStartArgs = (overrides = {}) => ({
	workspaceId: "workspace-1",
	chatId: "chat-1",
	assistantMessageId: "assistant-1",
	attachableRun: null,
	continueRunId: null,
	controllers: new Map(),
	model: "gpt-5",
	reasoningEffort: "medium",
	supersedeActiveRun: false,
	trigger: "submit-message",
	...createCallbacks(),
	...overrides,
});

describe("hosted chat run starter", () => {
	it("resolves assistant run start policy", () => {
		expect(
			getHostedChatRunStartPolicy({
				trigger: "submit-message",
				supersedeActiveRun: false,
			}),
		).toBe("reject");
		expect(
			getHostedChatRunStartPolicy({
				trigger: "regenerate-message",
				supersedeActiveRun: false,
			}),
		).toBe("supersede");
		expect(
			getHostedChatRunStartPolicy({
				trigger: "submit-message",
				supersedeActiveRun: true,
			}),
		).toBe("supersede");
	});

	it("starts a new assistant run and active stream session", async () => {
		const callbacks = createCallbacks();

		const result = await startHostedChatRun(createStartArgs(callbacks));

		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected run start to succeed");
		}
		expect(callbacks.startAssistantRun).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			assistantMessageId: "assistant-1",
			model: "gpt-5",
			reasoningEffort: "medium",
			policy: "reject",
		});
		expect(callbacks.startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			assistantMessageId: "assistant-1",
		});
		expect(result.assistantRun._id).toBe("run-1");
	});

	it("reuses a matching continued run instead of starting another run", async () => {
		const callbacks = createCallbacks();

		const result = await startHostedChatRun(
			createStartArgs({
				...callbacks,
				attachableRun: { _id: "run-existing" },
				continueRunId: "run-existing",
			}),
		);

		expect(result.ok).toBe(true);
		expect(callbacks.startAssistantRun).not.toHaveBeenCalled();
		expect(callbacks.startActiveStream).toHaveBeenCalledWith(
			expect.objectContaining({ runId: "run-existing" }),
		);
	});

	it("terminalizes a started run and cleans session when stream start fails", async () => {
		const streamStartError = new Error("stream start failed");
		const callbacks = createCallbacks({
			startActiveStream: vi.fn(async () => {
				throw streamStartError;
			}),
		});

		const result = await startHostedChatRun(createStartArgs(callbacks));

		expect(result).toMatchObject({
			assistantRun: { _id: "run-1" },
			error: streamStartError,
			ok: false,
			terminalizationError: null,
		});
		expect(callbacks.failAssistantRun).toHaveBeenCalledWith({
			runId: "run-1",
			errorText: "stream start failed",
		});
		expect(result.activeStreamSession?.isBroadcastClosed()).toBe(true);
	});
});
