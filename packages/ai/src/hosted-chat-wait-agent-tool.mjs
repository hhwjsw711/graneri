import { tool } from "ai";
import { z } from "zod";
import {
	HOSTED_ACTIVE_STREAM_ACTIVITY_MAILBOX,
	HOSTED_ACTIVE_STREAM_ACTIVITY_STEER,
} from "./hosted-chat-active-stream.mjs";

export const HOSTED_WAIT_AGENT_MIN_TIMEOUT_MS = 100;
export const HOSTED_WAIT_AGENT_DEFAULT_TIMEOUT_MS = 1_000;
export const HOSTED_WAIT_AGENT_MAX_TIMEOUT_MS = 30_000;

const waitAgentInputSchema = z.object({
	timeout_ms: z
		.number()
		.int()
		.min(HOSTED_WAIT_AGENT_MIN_TIMEOUT_MS)
		.max(HOSTED_WAIT_AGENT_MAX_TIMEOUT_MS)
		.optional(),
});

const resultForActivity = (activity) => {
	if (activity === HOSTED_ACTIVE_STREAM_ACTIVITY_MAILBOX) {
		return {
			message: "Wait completed.",
			timed_out: false,
		};
	}
	if (activity === HOSTED_ACTIVE_STREAM_ACTIVITY_STEER) {
		return {
			message: "Wait interrupted by new input.",
			timed_out: false,
		};
	}
	return {
		message: "Wait timed out.",
		timed_out: true,
	};
};

const abortError = () =>
	new DOMException("wait_agent was aborted.", "AbortError");

export const waitForHostedActiveStreamActivity = ({
	session,
	signal,
	timeoutMs = HOSTED_WAIT_AGENT_DEFAULT_TIMEOUT_MS,
}) =>
	new Promise((resolve, reject) => {
		if (!session?.subscribePendingInputActivity) {
			reject(new Error("wait_agent requires an active assistant turn."));
			return;
		}

		let settled = false;
		let timeout = null;
		let subscription = null;
		const cleanup = () => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			subscription?.unsubscribe();
			subscription = null;
			signal?.removeEventListener("abort", onAbort);
			session.abortSignal?.removeEventListener("abort", onAbort);
		};
		const settle = (activity) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(resultForActivity(activity));
		};
		const onAbort = () => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(abortError());
		};

		if (signal?.aborted || session.abortSignal?.aborted) {
			onAbort();
			return;
		}

		subscription = session.subscribePendingInputActivity(settle);
		if (subscription.pendingActivity) {
			settle(subscription.pendingActivity);
			return;
		}

		signal?.addEventListener("abort", onAbort, { once: true });
		session.abortSignal?.addEventListener("abort", onAbort, { once: true });
		timeout = setTimeout(() => settle(null), timeoutMs);
	});

export const createHostedWaitAgentTool = ({ getActiveStreamSession }) =>
	tool({
		description:
			"Wait for active-turn mailbox activity or new user input. Returns a short summary and whether the wait timed out. Use this only when waiting for more activity is useful.",
		inputSchema: waitAgentInputSchema,
		execute: async ({ timeout_ms: timeoutMs }, options = {}) =>
			await waitForHostedActiveStreamActivity({
				session: getActiveStreamSession(),
				signal: options.abortSignal,
				timeoutMs: timeoutMs ?? HOSTED_WAIT_AGENT_DEFAULT_TIMEOUT_MS,
			}),
	});
