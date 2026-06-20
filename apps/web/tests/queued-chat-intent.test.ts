import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	prepareQueuedReplayIntent,
	prepareQueuedSteerIntent,
} from "../src/lib/queued-chat-intent";

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;
const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;

const createQueuedMessage = () => ({
	_id: queuedMessageId,
	_creationTime: 1,
	chatId: "chat-1",
	claimedAt: undefined,
	createdAt: 1,
	messageId: "queued-message-1",
	ownerTokenIdentifier: "owner",
	partsJson: JSON.stringify([{ type: "text", text: "Queued" }]),
	requestBodyJson: JSON.stringify({ model: "gpt-5" }),
	runId,
	status: "claimed" as const,
	text: "Queued",
	updatedAt: 1,
	workspaceId,
});

describe("queued chat intent", () => {
	it("prepares replay intent with the durable replay id", async () => {
		await expect(
			prepareQueuedReplayIntent({
				hasMessageId: () => false,
				queuedMessage: createQueuedMessage(),
				resolveConvexToken: async () => "fresh-token",
			}),
		).resolves.toMatchObject({
			body: {
				convexToken: "fresh-token",
				model: "gpt-5",
				replayQueuedMessageId: queuedMessageId,
			},
			message: {
				text: "Queued",
			},
		});
	});

	it("prepares steer intent without leaking replay fields", async () => {
		await expect(
			prepareQueuedSteerIntent({
				activeRunId: runId,
				hasMessageId: () => false,
				queuedMessage: createQueuedMessage(),
				resolveConvexToken: async () => "fresh-token",
			}),
		).resolves.toMatchObject({
			body: {
				convexToken: "fresh-token",
				continueRunId: runId,
				model: "gpt-5",
				steerQueuedMessageId: queuedMessageId,
			},
			message: {
				text: "Queued",
			},
		});

		const prepared = await prepareQueuedSteerIntent({
			activeRunId: runId,
			hasMessageId: () => false,
			queuedMessage: createQueuedMessage(),
			resolveConvexToken: async () => "fresh-token",
		});
		expect(prepared.body).not.toHaveProperty("replayQueuedMessageId");
	});
});
