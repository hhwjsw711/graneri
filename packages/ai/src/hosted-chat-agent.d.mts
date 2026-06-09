import type {
	PrepareStepFunction,
	ProviderOptions,
	ToolLoopAgent,
	ToolSet,
} from "ai";

export declare const buildHostedChatAgentToolSet: ({
	additionalAgentTools,
	enabledTools,
}: {
	additionalAgentTools?: ToolSet | undefined;
	enabledTools: ToolSet;
}) => {
	agentTools: ToolSet | undefined;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	tools: ToolSet;
};

export declare const createHostedChatAgent: ({
	additionalAgentTools,
	enabledTools,
	emptyToolsWhenNone,
	model,
	prepareStep,
	providerOptions,
	systemPrompt,
}: {
	additionalAgentTools?: ToolSet | undefined;
	enabledTools: ToolSet;
	emptyToolsWhenNone?: boolean;
	model: string;
	prepareStep?: PrepareStepFunction<ToolSet> | undefined;
	providerOptions?: ProviderOptions | undefined;
	systemPrompt: string;
}) => {
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	tools: ToolSet;
};
