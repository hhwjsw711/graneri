import type { Tool } from "ai";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";

export declare const HOSTED_WAIT_AGENT_MIN_TIMEOUT_MS = 100;
export declare const HOSTED_WAIT_AGENT_DEFAULT_TIMEOUT_MS = 1000;
export declare const HOSTED_WAIT_AGENT_MAX_TIMEOUT_MS = 30000;

export type HostedWaitAgentResult = {
	message: string;
	timed_out: boolean;
};

export declare const waitForHostedActiveStreamActivity: (args: {
	session?: HostedActiveStreamSession | null;
	signal?: AbortSignal;
	timeoutMs?: number;
}) => Promise<HostedWaitAgentResult>;

export declare const createHostedWaitAgentTool: (args: {
	getActiveStreamSession: () => HostedActiveStreamSession | null;
}) => Tool;
