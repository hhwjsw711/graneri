export declare const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export type HostedActiveToolCallStatus = "completed" | "failed" | "denied";

export type HostedActiveStreamPersisterLike = {
	readonly runId?: string;
	append(delta: string): void;
	closePersistence?(): Promise<void>;
	discardPending?(): void;
	flush?(): Promise<void>;
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

export type HostedActiveStreamCallbacks<
	WorkspaceId extends string,
	RunId extends string,
> = {
	appendActiveStreamText: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		delta: string;
	}) => Promise<unknown>;
	finishActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
	}) => Promise<unknown>;
	startActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
	}) => Promise<unknown>;
	startActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		toolCallId: string;
		toolName: string;
		inputJson?: string;
	}) => Promise<unknown>;
	finishActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
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
	RunId extends string,
> {
	constructor(
		args: HostedActiveStreamCallbacks<WorkspaceId, RunId> & {
			workspaceId: WorkspaceId;
			chatId: string;
			messageId: string;
			runId: RunId;
		},
	);
	get messageId(): string;
	get runId(): RunId;
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
	closePersistence(): Promise<void>;
	finish(): Promise<void>;
	discardPending(): void;
}

export type HostedActiveStreamSession = {
	abort(reason?: unknown): void;
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
	discardPending(): void;
	closePersistence(): Promise<void>;
	finish(): Promise<void>;
	cleanup(): void;
	subscribe<Chunk extends { type: string }>(): ReadableStream<Chunk>;
	startBroadcast<Chunk extends { type: string }>(
		stream: ReadableStream<Chunk>,
	): ReadableStream<Chunk>;
};

export declare const createHostedActiveStreamSession: (args: {
	controllers: Map<string, HostedActiveStreamSession>;
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
		closePersistence(): Promise<void>;
		finish(): Promise<void>;
		discardPending?(): void;
	};
	streamKey: string;
}) => HostedActiveStreamSession;

export declare const createHostedActiveChatStreamSession: <
	WorkspaceId extends string,
	RunId extends string,
>(args: {
	callbacks: HostedActiveStreamCallbacks<WorkspaceId, RunId>;
	chatId: string;
	controllers: Map<string, HostedActiveStreamSession>;
	messageId?: string;
	runId: RunId;
	workspaceId: WorkspaceId;
}) => HostedActiveStreamSession;

export declare const pipeHostedActiveStreamText: <
	Chunk extends { type: string },
>(args: {
	onFlush?: () => Promise<void> | void;
	persister?: HostedActiveStreamPersisterLike | null;
	stream: ReadableStream<Chunk>;
}) => ReadableStream<Chunk>;

export declare const pipeHostedActiveStreamEvents: <
	Chunk extends { type: string },
>(args: {
	onFlush?: () => Promise<void> | void;
	persister?: HostedActiveStreamPersisterLike | null;
	stream: ReadableStream<Chunk>;
}) => ReadableStream<Chunk>;
