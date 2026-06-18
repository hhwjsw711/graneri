import type { UIMessage } from "ai";
import type * as HostedChatRuntime from "./hosted-chat-runtime.mjs";

type CompletedAssistantRunTerminalization = {
	responseMessage: UIMessage;
	status: "completed";
};

type FailedAssistantRunTerminalization = {
	errorText: string;
	status: "failed";
};

export type HostedAssistantRunTerminalization =
	| CompletedAssistantRunTerminalization
	| FailedAssistantRunTerminalization;

type HostedActiveStreamSessionLike = {
	abortSignal: AbortSignal;
	cleanup: () => void;
	closePersistence: () => Promise<void>;
};

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type SaveAssistantMessageForRunArgs<
	WorkspaceId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
	AssistantRunId extends string,
> = ReturnType<
	typeof HostedChatRuntime.buildHostedChatSaveMessageArgs<
		WorkspaceId,
		NoteId,
		ReasoningEffort
	>
> & {
	runId: AssistantRunId;
};

export declare const createHostedAssistantRunFinalizer: <
	WorkspaceId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
	AssistantRunId extends string,
>(args: {
	activeStreamSession: HostedActiveStreamSessionLike;
	assistantRunId: AssistantRunId;
	chatId: string;
	failAssistantRun: (args: {
		errorText: string;
		runId: AssistantRunId;
	}) => Promise<unknown>;
	finishAssistantRun: (args: { runId: AssistantRunId }) => Promise<unknown>;
	lastUserMessage?: UIMessage | null;
	logError: (args: {
		error: unknown;
		terminalization: HostedAssistantRunTerminalization;
	}) => void;
	logLatency: (stage: string, details?: LogLatencyDetails) => void;
	model: string;
	noteId?: NoteId | null;
	onCompleted?: () => void;
	onFailed?: () => void;
	onFinalizeError?: (args: {
		error: unknown;
		terminalization: HostedAssistantRunTerminalization;
	}) => void;
	onTitleGenerationError?: (args: {
		error: unknown;
		responseMessage: UIMessage;
	}) => void;
	reasoningEffort: ReasoningEffort;
	saveAssistantMessageForRun: (
		args: SaveAssistantMessageForRunArgs<
			WorkspaceId,
			NoteId,
			ReasoningEffort,
			AssistantRunId
		>,
	) => Promise<unknown | null>;
	shouldGenerateChatTitle: boolean;
	updateChatTitle: (args: {
		chatId: string;
		onlyIfReplaceable: true;
		title: string;
		workspaceId: WorkspaceId;
	}) => Promise<unknown>;
	workspaceId: WorkspaceId;
}) => (terminalization: HostedAssistantRunTerminalization) => Promise<void>;
