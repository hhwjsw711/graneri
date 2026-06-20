import type { ToolLoopAgent, ToolSet, UIMessage } from "ai";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";
import type { HostedAssistantRunTerminalization } from "./hosted-chat-run-finalizer.mjs";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type StreamLatencyTracker<Chunk extends { type: string }> = {
	getFinishDetails: () => LogLatencyDetails;
	wrapStream: (stream: ReadableStream<Chunk>) => ReadableStream<Chunk>;
};

type FinalizedToolSet = {
	hasTools: boolean;
};

export declare const createHostedChatRunResponseStream: <
	AssistantRunId extends string,
	Chunk extends { type: string },
>(args: {
	activeStreamSession: HostedActiveStreamSession;
	agent: ToolLoopAgent<never, ToolSet, never>;
	assistantMessageId: string;
	assistantRunId: AssistantRunId;
	chatMessages: UIMessage[];
	createUiStream?: (args: {
		agent: ToolLoopAgent<never, ToolSet, never>;
		uiMessages: UIMessage[];
		abortSignal: AbortSignal;
		originalMessages: UIMessage[];
		generateMessageId: () => string;
		sendReasoning: true;
		sendSources: true;
		onFinish: (args: {
			isAborted: boolean;
			responseMessage: UIMessage;
		}) => void;
		onError: () => string;
	}) => Promise<ReadableStream<Chunk>>;
	failAssistantRun: (args: {
		runId: AssistantRunId;
		errorText: string;
	}) => Promise<unknown>;
	finalizeAssistantRun: (
		terminalization: HostedAssistantRunTerminalization,
	) => Promise<void>;
	finalizedToolSet: FinalizedToolSet;
	logLatency: (stage: string, details?: LogLatencyDetails) => void;
	onStreamCreateError?: (error: unknown) => Promise<void> | void;
	streamLatencyTracker: StreamLatencyTracker<Chunk>;
	systemPrompt: string;
}) => Promise<
	| {
			ok: true;
			responseStream: ReadableStream<Chunk>;
	  }
	| {
			ok: false;
			error: unknown;
	  }
>;
