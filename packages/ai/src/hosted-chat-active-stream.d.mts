export declare const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export type HostedActiveStreamStatus = "done" | "error";

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
	flush(): Promise<void>;
	finish(status: HostedActiveStreamStatus): Promise<void>;
}

export type HostedActiveStreamSession = {
	abortSignal: AbortSignal;
	persister: { append(delta: string): void };
	streamKey: string;
	start(): Promise<void>;
	append(delta: string): void;
	finish(status: HostedActiveStreamStatus): Promise<void>;
	cleanup(): void;
};

export declare const createHostedActiveStreamSession: (args: {
	controllers: Map<string, AbortController>;
	persister: {
		start(): Promise<void>;
		append(delta: string): void;
		finish(status: HostedActiveStreamStatus): Promise<void>;
	};
	streamKey: string;
}) => HostedActiveStreamSession;

export declare const pipeHostedActiveStreamText: <Chunk extends { type: string }>(
	args: {
		persister?: { append(delta: string): void } | null;
		stream: ReadableStream<Chunk>;
	},
) => ReadableStream<Chunk>;
