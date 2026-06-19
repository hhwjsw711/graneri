import type { ToolSet } from "ai";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";

export type HostedMultiAgentStatus =
	| "pending_init"
	| "running"
	| "interrupted"
	| "shutdown"
	| "not_found"
	| {
			completed: string | null;
	  }
	| {
			errored: string;
	  };

export type HostedMultiAgentRuntime = {
	followupTask(args: {
		currentPath?: string;
		message: string;
		target: string;
	}): Record<string, never>;
	getAgent(target: string, currentPath?: string): unknown | null;
	interruptAgent(args: {
		currentPath?: string;
		target: string;
	}): Promise<{
		previous_status: HostedMultiAgentStatus;
	}>;
	listAgents(args?: { pathPrefix?: string }): {
		agents: Array<{
			agent_name: string;
			agent_status: HostedMultiAgentStatus;
			last_task_message: string | null;
		}>;
	};
	sendMessage(args: {
		currentPath?: string;
		message: string;
		target: string;
	}): Record<string, never>;
	shutdown(): void;
	spawnAgent(args: {
		currentPath?: string;
		message: string;
		taskName: string;
	}): Promise<{
		task_name: string;
		nickname: string | null;
	}>;
};

export declare const createHostedMultiAgentRuntime: (args: {
	activeStreamSession?: HostedActiveStreamSession | null;
	baseTools?: ToolSet;
	model: string;
	onAgentCompleted?: (args: {
		durableAgentId: string | null;
		message: string;
		path: string;
	}) => Promise<void> | void;
	onAgentCreated?: (args: {
		message: string;
		parentPath: string | null;
		path: string;
		taskName: string;
	}) => Promise<{ durableAgentId?: string | null } | void> | { durableAgentId?: string | null } | void;
	onAgentErrored?: (args: {
		durableAgentId: string | null;
		errorText: string;
		path: string;
	}) => Promise<void> | void;
	onAgentInterrupted?: (args: {
		durableAgentId: string | null;
		path: string;
	}) => Promise<void> | void;
	onAgentRunning?: (args: {
		activeRunId: string;
		durableAgentId: string | null;
		path: string;
	}) => Promise<void> | void;
	providerOptions?: unknown;
	runAgentTask?: (args: {
		abortSignal: AbortSignal;
		currentPath: string;
		message: string;
	}) => Promise<string>;
	systemPrompt?: string;
}) => HostedMultiAgentRuntime;

export declare const createHostedMultiAgentTools: (args: {
	currentPath?: string;
	getRuntime: () => HostedMultiAgentRuntime;
}) => ToolSet;

export declare const getHostedMultiAgentRootPath: () => string;
