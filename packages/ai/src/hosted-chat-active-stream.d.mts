export declare const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export type HostedActiveStreamStatus = "done" | "error";
export type HostedActiveToolCallStatus = "completed" | "failed" | "denied";

export type HostedActiveStreamPersisterLike = {
	append(delta: string): void;
	startToolCall?(args: {
		toolCallId: string;
		toolName: string;
		input?: unknown;
	}): Promise<void>;
	finishToolCall?(args: {
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		output?: unknown;
		errorText?: string;
	}): Promise<void>;
};

export type HostedActiveStreamCallbacks<WorkspaceId extends string> = {
	appendActiveStreamText: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		messageId: string;
		delta: string;
	}) => Promise<unknown>;
	finishActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		messageId: string;
		status: HostedActiveStreamStatus;
	}) => Promise<unknown>;
	startActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		messageId: string;
	}) => Promise<unknown>;
	startActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		messageId: string;
		toolCallId: string;
		toolName: string;
		inputJson?: string;
	}) => Promise<unknown>;
	finishActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		messageId: string;
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		outputJson?: string;
		errorText?: string;
	}) => Promise<unknown>;
};

export declare const createHostedActiveStreamKey: <
	WorkspaceId extends string,
>(args: {
	workspaceId: WorkspaceId;
	chatId: string;
}) => string;

export declare class HostedActiveChatStreamPersister<
	WorkspaceId extends string,
> {
	constructor(
		args: HostedActiveStreamCallbacks<WorkspaceId> & {
			workspaceId: WorkspaceId;
			chatId: string;
			messageId: string;
		},
	);
	get messageId(): string;
	start(): Promise<void>;
	append(delta: string): void;
	startToolCall(args: {
		toolCallId: string;
		toolName: string;
		input?: unknown;
	}): Promise<void>;
	finishToolCall(args: {
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		output?: unknown;
		errorText?: string;
	}): Promise<void>;
	flush(): Promise<void>;
	finish(status: HostedActiveStreamStatus): Promise<void>;
}

export type HostedActiveStreamSession = {
	abortSignal: AbortSignal;
	persister: HostedActiveStreamPersisterLike;
	streamKey: string;
	start(): Promise<void>;
	append(delta: string): void;
	startToolCall(args: {
		toolCallId: string;
		toolName: string;
		input?: unknown;
	}): Promise<void>;
	finishToolCall(args: {
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		output?: unknown;
		errorText?: string;
	}): Promise<void>;
	finish(status: HostedActiveStreamStatus): Promise<void>;
	cleanup(): void;
};

export declare const createHostedActiveStreamSession: (args: {
	controllers: Map<string, AbortController>;
	persister: {
		start(): Promise<void>;
		append(delta: string): void;
		startToolCall?(args: {
			toolCallId: string;
			toolName: string;
			input?: unknown;
		}): Promise<void>;
		finishToolCall?(args: {
			toolCallId: string;
			status: HostedActiveToolCallStatus;
			output?: unknown;
			errorText?: string;
		}): Promise<void>;
		finish(status: HostedActiveStreamStatus): Promise<void>;
	};
	streamKey: string;
}) => HostedActiveStreamSession;

export declare const createHostedActiveChatStreamSession: <
	WorkspaceId extends string,
>(args: {
	callbacks: HostedActiveStreamCallbacks<WorkspaceId>;
	chatId: string;
	controllers: Map<string, AbortController>;
	workspaceId: WorkspaceId;
}) => HostedActiveStreamSession;

export declare const stopHostedActiveChatStream: <
	WorkspaceId extends string,
>(args: {
	chatId: string;
	controllers: Map<string, AbortController>;
	stopActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
	}) => Promise<unknown>;
	workspaceId: WorkspaceId;
}) => Promise<void>;

export declare const pipeHostedActiveStreamText: <Chunk extends { type: string }>(
	args: {
		persister?: HostedActiveStreamPersisterLike | null;
		stream: ReadableStream<Chunk>;
	},
) => ReadableStream<Chunk>;

export declare const pipeHostedActiveStreamEvents: <
	Chunk extends { type: string },
>(
	args: {
		persister?: HostedActiveStreamPersisterLike | null;
		stream: ReadableStream<Chunk>;
	},
) => ReadableStream<Chunk>;
