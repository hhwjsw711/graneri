import { describe, expect, it, vi } from "vitest";
import {
	createHostedTurnInputBuffer,
	HOSTED_TURN_INPUT_ACTIVITY_MAILBOX,
	HOSTED_TURN_INPUT_ACTIVITY_STEER,
} from "../../../packages/ai/src/hosted-chat-turn-input-buffer.mjs";

describe("hosted chat turn input buffer", () => {
	it("buffers steered input before mailbox input for the current turn", () => {
		const buffer = createHostedTurnInputBuffer();

		buffer.enqueueMailboxInput({ id: "mailbox-1" });
		buffer.extendSteerInput([{ id: "steer-1" }, { id: "steer-2" }]);

		expect(buffer.hasPendingInput()).toBe(true);
		expect(buffer.takeForCurrentTurn()).toEqual([
			{ id: "steer-1" },
			{ id: "steer-2" },
			{ id: "mailbox-1" },
		]);
		expect(buffer.hasPendingInput()).toBe(false);
	});

	it("can defer mailbox input until steer input reopens delivery", () => {
		const buffer = createHostedTurnInputBuffer();

		buffer.deferMailboxDeliveryToNextTurn();
		buffer.enqueueMailboxInput({ id: "mailbox-1" });

		expect(buffer.hasPendingMailboxInput()).toBe(true);
		expect(buffer.hasPendingInput()).toBe(false);
		expect(buffer.takeForCurrentTurn()).toEqual([]);

		buffer.extendSteerInput({ id: "steer-1" });
		expect(buffer.takeForCurrentTurn()).toEqual([
			{ id: "steer-1" },
			{ id: "mailbox-1" },
		]);
	});

	it("notifies subscribers with pending activity snapshots", () => {
		const buffer = createHostedTurnInputBuffer();
		const listener = vi.fn();

		const subscription = buffer.subscribeActivity(listener);
		expect(subscription.pendingActivity).toBeNull();

		buffer.enqueueMailboxInput({ id: "mailbox-1" });
		buffer.extendSteerInput({ id: "steer-1" });

		expect(listener).toHaveBeenNthCalledWith(
			1,
			HOSTED_TURN_INPUT_ACTIVITY_MAILBOX,
		);
		expect(listener).toHaveBeenNthCalledWith(
			2,
			HOSTED_TURN_INPUT_ACTIVITY_STEER,
		);

		const lateSubscription = buffer.subscribeActivity(vi.fn());
		expect(lateSubscription.pendingActivity).toBe(
			HOSTED_TURN_INPUT_ACTIVITY_STEER,
		);

		subscription.unsubscribe();
		lateSubscription.unsubscribe();
	});
});
