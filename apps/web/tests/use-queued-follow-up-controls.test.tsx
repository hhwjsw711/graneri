import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedFollowUpControls } from "../src/hooks/use-queued-follow-up-controls";
import type { QueuedFollowUpMessage } from "../src/lib/chat-queued-followups";

const tokenMocks = vi.hoisted(() => ({
	getCachedConvexToken: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));

vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: tokenMocks.getCachedConvexToken,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;

const createQueuedMessage = ({
	id = "queued-1",
	messageId = "queued-message-1",
	text = "Steer now",
} = {}): QueuedFollowUpMessage =>
	({
		_id: id as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-doc-1" as Id<"chats">,
		claimedAt: undefined,
		createdAt: 1,
		messageId,
		ownerTokenIdentifier: "owner",
		partsJson: JSON.stringify([{ type: "text", text }]),
		requestBodyJson: JSON.stringify({ model: "gpt-5" }),
		runId,
		status: "queued",
		text,
		updatedAt: 1,
		workspaceId,
	}) as QueuedFollowUpMessage;

describe("useQueuedFollowUpControls", () => {
	beforeEach(() => {
		tokenMocks.getCachedConvexToken.mockReset();
	});

	it("rolls back handoff state and restores the queue when manual steer send fails", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const rollbackHandoff = vi.fn();
		const onSteerStart = vi.fn(() => rollbackHandoff);
		const sendMessage = vi.fn().mockRejectedValue(new Error("send failed"));
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		const latestRequestBodyRef = {
			current: null as Record<string, unknown> | null,
		};

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				activeRun: { _id: runId },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef,
				localMessageIds: new Set(),
				onEditMessage: vi.fn(),
				onSteerStart,
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-1");
		});

		expect(onSteerStart).toHaveBeenCalledOnce();
		expect(rollbackHandoff).toHaveBeenCalledOnce();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Steer now" }),
			{
				body: {
					convexToken: "fresh-token",
					continueRunId: runId,
					model: "gpt-5",
					steerQueuedMessageId: "queued-1",
				},
			},
		);
		expect(queuedMessages).toEqual([queuedMessage]);
	});

	it("does not start handoff when queued request preparation fails", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const onSteerStart = vi.fn();
		tokenMocks.getCachedConvexToken.mockResolvedValue(null);

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				activeRun: { _id: runId },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				onEditMessage: vi.fn(),
				onSteerStart,
				queuedMessages,
				sendMessage: vi.fn(),
				setQueuedMessages,
				workspaceId,
			}),
		);

		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-1");
		});

		expect(onSteerStart).not.toHaveBeenCalled();
		expect(queuedMessages).toEqual([queuedMessage]);
	});

	it("ignores duplicate manual steer sends while one is pending", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		let resolveSend: (() => void) | null = null;
		const sendMessage = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSend = resolve;
				}),
		);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				activeRun: { _id: runId },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				onEditMessage: vi.fn(),
				onSteerStart: vi.fn(),
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		await act(async () => {
			const firstSend = result.current.sendQueuedFollowUpNow("queued-1");
			const secondSend = result.current.sendQueuedFollowUpNow("queued-1");
			await secondSend;
			await waitFor(() => {
				expect(sendMessage).toHaveBeenCalledOnce();
			});
			expect(sendMessage).toHaveBeenCalledOnce();
			resolveSend?.();
			await firstSend;
		});

		expect(sendMessage).toHaveBeenCalledOnce();
	});

	it("queues distinct manual steer sends while another steer is pending", async () => {
		const firstQueuedMessage = createQueuedMessage({
			id: "queued-1",
			messageId: "queued-message-1",
			text: "First steer",
		});
		const secondQueuedMessage = createQueuedMessage({
			id: "queued-2",
			messageId: "queued-message-2",
			text: "Second steer",
		});
		let queuedMessages = [firstQueuedMessage, secondQueuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const sendResolutions: Array<() => void> = [];
		const sendMessage = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					sendResolutions.push(resolve);
				}),
		);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				activeRun: { _id: runId },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				onEditMessage: vi.fn(),
				onSteerStart: vi.fn(),
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		let firstSend: Promise<unknown>;
		let secondSend: Promise<unknown>;
		await act(async () => {
			firstSend = result.current.sendQueuedFollowUpNow("queued-1");
			secondSend = result.current.sendQueuedFollowUpNow("queued-2");
		});
		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalledOnce();
		});
		expect(sendMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ text: "First steer" }),
			{
				body: {
					convexToken: "fresh-token",
					continueRunId: runId,
					model: "gpt-5",
					steerQueuedMessageId: "queued-1",
				},
			},
		);

		await act(async () => {
			sendResolutions[0]?.();
			await firstSend;
		});
		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalledTimes(2);
		});
		expect(sendMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ text: "Second steer" }),
			{
				body: {
					convexToken: "fresh-token",
					continueRunId: runId,
					model: "gpt-5",
					steerQueuedMessageId: "queued-2",
				},
			},
		);

		await act(async () => {
			sendResolutions[1]?.();
			await secondSend;
		});

		expect(queuedMessages).toEqual([]);
	});
});
