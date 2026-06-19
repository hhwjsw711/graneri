import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const ROOT_AGENT_PATH = "/root";
const MAX_TASK_NAME_LENGTH = 64;
const MAX_AGENT_MESSAGE_LENGTH = 64_000;

const taskNameSchema = z
	.string()
	.min(1)
	.max(MAX_TASK_NAME_LENGTH)
	.regex(/^[a-z0-9_]+$/);

const agentMessageSchema = z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH);

const agentStatusValue = (agent) => {
	if (!agent) {
		return "not_found";
	}
	if (agent.status === "completed") {
		return {
			completed: agent.completedText ?? null,
		};
	}
	if (agent.status === "errored") {
		return {
			errored: agent.errorText ?? "Unknown agent error.",
		};
	}
	return agent.status;
};

const previousStatusOutput = (agent) => ({
	previous_status: agentStatusValue(agent),
});

const getParentPath = (currentPath) => {
	const normalized = normalizeAgentPath(currentPath);
	if (normalized === ROOT_AGENT_PATH) {
		return ROOT_AGENT_PATH;
	}
	const slashIndex = normalized.lastIndexOf("/");
	return slashIndex <= 0 ? ROOT_AGENT_PATH : normalized.slice(0, slashIndex);
};

const normalizeAgentPath = (value) => {
	if (typeof value !== "string" || value.length === 0) {
		return ROOT_AGENT_PATH;
	}
	const compact = value.replace(/\/+/g, "/").replace(/\/$/u, "");
	if (!compact || compact === "/") {
		return ROOT_AGENT_PATH;
	}
	return compact.startsWith("/") ? compact : `${ROOT_AGENT_PATH}/${compact}`;
};

const resolveAgentTarget = ({ currentPath = ROOT_AGENT_PATH, target }) => {
	if (typeof target !== "string" || target.length === 0) {
		throw new Error("target must be a non-empty agent task name.");
	}
	if (target.startsWith("/")) {
		return normalizeAgentPath(target);
	}
	const current = normalizeAgentPath(currentPath);
	if (current === ROOT_AGENT_PATH) {
		return normalizeAgentPath(`${ROOT_AGENT_PATH}/${target}`);
	}
	return normalizeAgentPath(`${current}/${target}`);
};

const createMailboxMessage = ({ agent, sequence }) => {
	const status =
		agent.status === "completed"
			? "completed"
			: agent.status === "errored"
				? "errored"
				: agent.status;
	const body =
		agent.status === "completed"
			? (agent.completedText ?? "")
			: agent.status === "errored"
				? (agent.errorText ?? "Unknown agent error.")
				: `Agent status changed to ${agent.status}.`;

	return {
		id: `mailbox-${sequence}`,
		role: "user",
		metadata: {
			graneriMailbox: {
				agentName: agent.path,
				status,
				taskName: agent.taskName,
				type: "agent_status",
			},
		},
		parts: [
			{
				type: "text",
				text: `[${agent.path} ${status}]\n${body}`,
			},
		],
	};
};

const createDefaultAgentTaskRunner =
	({ baseTools, model, providerOptions, systemPrompt }) =>
	async ({ abortSignal, currentPath, message }) => {
		const { text } = await generateText({
			abortSignal,
			model: openai(model),
			providerOptions,
			prompt: message,
			stopWhen: baseTools && Object.keys(baseTools).length > 0 ? stepCountIs(5) : undefined,
			system: [
				systemPrompt,
				"",
				`You are subagent ${currentPath}. Complete the delegated task and return the concise result for the parent agent. Do not address the user directly unless the task asks for user-facing prose.`,
			]
				.filter(Boolean)
				.join("\n"),
			tools:
				baseTools && Object.keys(baseTools).length > 0 ? baseTools : undefined,
		});
		return text;
	};

export const createHostedMultiAgentRuntime = ({
	activeStreamSession,
	baseTools = {},
	model,
	onAgentCompleted,
	onAgentCreated,
	onAgentErrored,
	onAgentInterrupted,
	onAgentRunning,
	providerOptions,
	runAgentTask,
	systemPrompt = "",
}) => {
	const agents = new Map();
	let mailboxSequence = 0;
	const executeAgentTask =
		runAgentTask ??
		createDefaultAgentTaskRunner({
			baseTools,
			model,
			providerOptions,
			systemPrompt,
		});

	const enqueueMailbox = (agent) => {
		mailboxSequence += 1;
		activeStreamSession?.enqueueMailboxInput(
			createMailboxMessage({
				agent,
				sequence: mailboxSequence,
			}),
		);
	};

	const runNextTask = (agent) => {
		if (agent.status === "running" || agent.status === "shutdown") {
			return;
		}
		const nextMessage = agent.pendingTasks.shift();
		if (!nextMessage) {
			return;
		}
		agent.abortController = new AbortController();
		agent.lastTaskMessage = nextMessage;
		agent.status = "running";
		agent.completedText = null;
		agent.errorText = null;
		const activeRunId =
			typeof crypto?.randomUUID === "function"
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random()}`;
		agent.activeRunId = activeRunId;
		agent.promise = Promise.resolve(
			onAgentRunning?.({
				activeRunId,
				durableAgentId: agent.durableAgentId ?? null,
				path: agent.path,
			}),
		)
			.then(
				async () =>
					await executeAgentTask({
						abortSignal: agent.abortController.signal,
						currentPath: agent.path,
						message: nextMessage,
					}),
			)
			.then(async (text) => {
				if (agent.status === "interrupted" || agent.status === "shutdown") {
					return;
				}
				agent.status = "completed";
				agent.completedText = text;
				await onAgentCompleted?.({
					durableAgentId: agent.durableAgentId ?? null,
					message: text,
					path: agent.path,
				});
				enqueueMailbox(agent);
			})
			.catch(async (error) => {
				if (agent.status === "interrupted" || agent.status === "shutdown") {
					return;
				}
				agent.status = "errored";
				agent.errorText =
					error instanceof Error ? error.message : "Unknown agent error.";
				await onAgentErrored?.({
					durableAgentId: agent.durableAgentId ?? null,
					errorText: agent.errorText,
					path: agent.path,
				});
				enqueueMailbox(agent);
			})
			.catch((error) => {
				if (agent.status === "interrupted" || agent.status === "shutdown") {
					return;
				}
				agent.status = "errored";
				agent.errorText =
					error instanceof Error ? error.message : "Unknown agent error.";
			})
			.finally(() => {
				agent.abortController = null;
				agent.promise = null;
				agent.activeRunId = null;
				if (
					(agent.status === "completed" ||
						agent.status === "errored" ||
						agent.status === "interrupted") &&
					agent.pendingTasks.length > 0
				) {
					runNextTask(agent);
				}
			});
	};

	const spawnAgent = async ({ currentPath = ROOT_AGENT_PATH, message, taskName }) => {
		const parentPath = normalizeAgentPath(currentPath);
		const path = normalizeAgentPath(`${parentPath}/${taskName}`);
		if (agents.has(path)) {
			throw new Error(`Agent ${path} already exists.`);
		}
		const agent = {
			abortController: null,
			activeRunId: null,
			completedText: null,
			durableAgentId: null,
			errorText: null,
			lastTaskMessage: message,
			path,
			pendingMessages: [],
			pendingTasks: [message],
			promise: null,
			status: "pending_init",
			taskName,
		};
		if (onAgentCreated) {
			const created = await onAgentCreated({
				message,
				parentPath: parentPath === ROOT_AGENT_PATH ? null : parentPath,
				path,
				taskName,
			});
			agent.durableAgentId = created?.durableAgentId ?? null;
		}
		agents.set(path, agent);
		runNextTask(agent);
		return {
			task_name: path,
			nickname: null,
		};
	};

	const getAgent = (target, currentPath = ROOT_AGENT_PATH) =>
		agents.get(resolveAgentTarget({ currentPath, target })) ?? null;

	return {
		followupTask({ currentPath = ROOT_AGENT_PATH, message, target }) {
			const targetPath = resolveAgentTarget({ currentPath, target });
			if (targetPath === ROOT_AGENT_PATH) {
				throw new Error("followup_task cannot target the root agent.");
			}
			const agent = getAgent(target, currentPath);
			if (!agent) {
				throw new Error(`Agent ${target} was not found.`);
			}
			if (agent.status === "shutdown") {
				throw new Error(`Agent ${agent.path} is shut down.`);
			}
			agent.pendingTasks.push(message);
			if (agent.status !== "running") {
				runNextTask(agent);
			}
			return {};
		},
		getAgent,
		async interruptAgent({ currentPath = ROOT_AGENT_PATH, target }) {
			const targetPath = resolveAgentTarget({ currentPath, target });
			if (
				targetPath === ROOT_AGENT_PATH ||
				targetPath === normalizeAgentPath(currentPath)
			) {
				throw new Error("interrupt_agent cannot target the root or current agent.");
			}
			const agent = getAgent(target, currentPath);
			const previous = previousStatusOutput(agent);
			if (!agent) {
				return previous;
			}
			if (agent.status === "running") {
				agent.abortController?.abort("interrupted");
			}
			if (agent.status !== "shutdown") {
				agent.status = "interrupted";
			}
			await onAgentInterrupted?.({
				durableAgentId: agent.durableAgentId ?? null,
				path: agent.path,
			});
			return previous;
		},
		listAgents({ pathPrefix } = {}) {
			const normalizedPrefix =
				typeof pathPrefix === "string" && pathPrefix.length > 0
					? normalizeAgentPath(pathPrefix)
					: null;
			return {
				agents: [...agents.values()]
					.filter((agent) => agent.status !== "shutdown")
					.filter(
						(agent) =>
							!normalizedPrefix || agent.path.startsWith(normalizedPrefix),
					)
					.map((agent) => ({
						agent_name: agent.path,
						agent_status: agentStatusValue(agent),
						last_task_message: agent.lastTaskMessage ?? null,
					})),
			};
		},
		sendMessage({ currentPath = ROOT_AGENT_PATH, message, target }) {
			const agent = getAgent(target, currentPath);
			if (!agent) {
				throw new Error(`Agent ${target} was not found.`);
			}
			if (agent.status === "shutdown") {
				throw new Error(`Agent ${agent.path} is shut down.`);
			}
			agent.pendingMessages.push({
				from: normalizeAgentPath(currentPath),
				message,
			});
			agent.lastTaskMessage = message;
			return {};
		},
		shutdown() {
			for (const agent of agents.values()) {
				agent.abortController?.abort("shutdown");
				agent.status = "shutdown";
			}
			agents.clear();
		},
		spawnAgent,
	};
};

export const createHostedMultiAgentTools = ({
	currentPath = ROOT_AGENT_PATH,
	getRuntime,
}) => ({
	followup_task: tool({
		description:
			"Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle.",
		inputSchema: z.object({
			target: z.string().min(1),
			message: agentMessageSchema,
		}),
		execute: async ({ message, target }) =>
			getRuntime().followupTask({ currentPath, message, target }),
	}),
	interrupt_agent: tool({
		description:
			"Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.",
		inputSchema: z.object({
			target: z.string().min(1),
		}),
		execute: async ({ target }) =>
			getRuntime().interruptAgent({ currentPath, target }),
	}),
	list_agents: tool({
		description:
			"List live agents in the current root thread tree. Optionally filter by task-path prefix.",
		inputSchema: z.object({
			path_prefix: z.string().min(1).optional(),
		}),
		execute: async ({ path_prefix: pathPrefix }) =>
			getRuntime().listAgents({ pathPrefix }),
	}),
	send_message: tool({
		description:
			"Send a message to an existing agent. The message will be delivered promptly. Does not trigger a new turn.",
		inputSchema: z.object({
			target: z.string().min(1),
			message: agentMessageSchema,
		}),
		execute: async ({ message, target }) =>
			getRuntime().sendMessage({ currentPath, message, target }),
	}),
	spawn_agent: tool({
		description:
			"Spawns an agent to work on the specified task. Only call this for a concrete, bounded subtask that can run independently alongside useful local work.",
		inputSchema: z.object({
			task_name: taskNameSchema,
			message: agentMessageSchema,
			agent_type: z.string().optional(),
			fork_turns: z
				.union([z.literal("none"), z.literal("all"), z.string().regex(/^[1-9][0-9]*$/)])
				.optional(),
			model: z.string().optional(),
			reasoning_effort: z.string().optional(),
			service_tier: z.string().optional(),
		}),
		execute: async ({ message, task_name: taskName }) =>
			getRuntime().spawnAgent({ currentPath, message, taskName }),
	}),
});

export const getHostedMultiAgentRootPath = () => ROOT_AGENT_PATH;
