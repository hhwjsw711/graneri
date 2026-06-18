import type { HostedAssistantRunTerminalization } from "./hosted-chat-run-finalizer.mjs";

type HostedChatLogDetails = Record<
	string,
	string | number | boolean | null | undefined
>;

export type HostedAssistantRunFinalizationQueue = {
	flush: () => Promise<void>;
	flushAfterClientStream: () => Promise<void>;
	hasTerminalization: () => boolean;
	setTerminalization: (
		terminalization: HostedAssistantRunTerminalization,
	) => void;
};

export declare const createHostedAssistantRunFinalizationQueue: ({
	finalizeAssistantRun,
	logLatency,
	runId,
}: {
	finalizeAssistantRun: (
		terminalization: HostedAssistantRunTerminalization,
	) => Promise<void>;
	logLatency: (event: string, details?: HostedChatLogDetails) => void;
	runId: string;
}) => HostedAssistantRunFinalizationQueue;
