import { describe, expect, it } from "vitest";
import {
	createHostedMultiAgentRuntime,
	createHostedMultiAgentTools,
} from "../../../packages/ai/src/hosted-chat-multi-agent-tools.mjs";
import { waitForHostedActiveStreamActivity } from "../../../packages/ai/src/hosted-chat-wait-agent-tool.mjs";

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	return { promise, reject, resolve };
};

const nextTick = async () =>
	await new Promise((resolve) => setTimeout(resolve, 0));

const createSessionHarness = () => {
	const listeners = new Set<(activity: "mailbox" | "steer") => void>();
	const mailboxMessages: unknown[] = [];
	return {
		mailboxMessages,
		session: {
			abortSignal: new AbortController().signal,
			enqueueMailboxInput: (input: unknown) => {
				mailboxMessages.push(input);
				for (const listener of listeners) {
					listener("mailbox");
				}
			},
			subscribePendingInputActivity: (
				listener: (activity: "mailbox" | "steer") => void,
			) => {
				listeners.add(listener);
				return {
					pendingActivity: mailboxMessages.length > 0 ? "mailbox" : null,
					unsubscribe: () => listeners.delete(listener),
				};
			},
		},
	};
};

describe("hosted multi-agent runtime", () => {
	it("spawns a task, completes it, and wakes wait_agent through mailbox activity", async () => {
		const harness = createSessionHarness();
		const firstRun = createDeferred<string>();
		const runtime = createHostedMultiAgentRuntime({
			activeStreamSession: harness.session,
			model: "gpt-5.4",
			runAgentTask: () => firstRun.promise,
		});

		expect(
			await runtime.spawnAgent({
				message: "Find the risky branch.",
				taskName: "review",
			}),
		).toEqual({
			task_name: "/root/review",
			nickname: null,
		});
		expect(runtime.listAgents()).toEqual({
			agents: [
				{
					agent_name: "/root/review",
					agent_status: "running",
					last_task_message: "Find the risky branch.",
				},
			],
		});

		const waitPromise = waitForHostedActiveStreamActivity({
			session: harness.session,
			timeoutMs: 1_000,
		});
		firstRun.resolve("The risky branch is in queue handling.");

		await expect(waitPromise).resolves.toEqual({
			message: "Wait completed.",
			timed_out: false,
		});
		await Promise.resolve();
		expect(harness.mailboxMessages).toHaveLength(1);
		expect(runtime.listAgents().agents[0]).toEqual({
			agent_name: "/root/review",
			agent_status: {
				completed: "The risky branch is in queue handling.",
			},
			last_task_message: "Find the risky branch.",
		});
	});

	it("send_message records mailbox input without triggering a new task", async () => {
		const firstRun = createDeferred<string>();
		const runMessages: string[] = [];
		const runtime = createHostedMultiAgentRuntime({
			model: "gpt-5.4",
			runAgentTask: ({ message }) => {
				runMessages.push(message);
				return firstRun.promise;
			},
		});

		await runtime.spawnAgent({
			message: "Initial task.",
			taskName: "worker",
		});
		runtime.sendMessage({
			message: "Background note.",
			target: "worker",
		});
		firstRun.resolve("Done.");
		await firstRun.promise;

		expect(runMessages).toEqual(["Initial task."]);
		expect(runtime.listAgents().agents[0]?.last_task_message).toBe(
			"Background note.",
		);
	});

	it("followup_task triggers an idle completed agent", async () => {
		const firstRun = createDeferred<string>();
		const secondRun = createDeferred<string>();
		const runs = [firstRun, secondRun];
		const runMessages: string[] = [];
		const runtime = createHostedMultiAgentRuntime({
			model: "gpt-5.4",
			runAgentTask: ({ message }) => {
				runMessages.push(message);
				const nextRun = runs.shift();
				if (!nextRun) {
					throw new Error("unexpected extra run");
				}
				return nextRun.promise;
			},
		});

		await runtime.spawnAgent({
			message: "Initial task.",
			taskName: "worker",
		});
		firstRun.resolve("First done.");
		await firstRun.promise;
		await nextTick();
		runtime.followupTask({
			message: "Second task.",
			target: "worker",
		});
		await nextTick();

		expect(runMessages).toEqual(["Initial task.", "Second task."]);
	});

	it("interrupt_agent rejects root and returns previous status for a running target", async () => {
		const runtime = createHostedMultiAgentRuntime({
			model: "gpt-5.4",
			runAgentTask: () => new Promise(() => {}),
		});
		await runtime.spawnAgent({
			message: "Long task.",
			taskName: "worker",
		});

		await expect(
			runtime.interruptAgent({
				target: "/root",
			}),
		).rejects.toThrow("root or current agent");
		await expect(
			runtime.interruptAgent({
				target: "worker",
			}),
		).resolves.toEqual({
			previous_status: "running",
		});
		expect(runtime.listAgents().agents[0]?.agent_status).toBe("interrupted");
	});

	it("exposes Codex v2 tool names through the AI SDK tool set", () => {
		const runtime = createHostedMultiAgentRuntime({
			model: "gpt-5.4",
			runAgentTask: async () => "done",
		});
		const tools = createHostedMultiAgentTools({
			getRuntime: () => runtime,
		});

		expect(Object.keys(tools).sort()).toEqual([
			"followup_task",
			"interrupt_agent",
			"list_agents",
			"send_message",
			"spawn_agent",
		]);
	});
});
