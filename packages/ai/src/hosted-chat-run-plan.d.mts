import type {
	PrepareStepFunction,
	ProviderOptions,
	ToolLoopAgent,
	ToolSet,
} from "ai";

export type HostedChatRunPlanContext = {
	attachedNoteContext: string;
	notesContext: string;
	recipeContext: string;
	userProfileContext?: unknown;
};

export type HostedChatRunPlanCoreToolPolicy = {
	enabledTools: ToolSet;
	instruction: string;
	prepareStep?: PrepareStepFunction<ToolSet> | undefined;
};

export type HostedChatRunPlanAutomationContext = {
	instruction: string;
	tools: ToolSet;
};

export declare const buildHostedChatRunPlan: (args: {
	additionalAgentTools?: ToolSet | undefined;
	appTools?: ToolSet | undefined;
	automationContext: HostedChatRunPlanAutomationContext;
	context: HostedChatRunPlanContext;
	coreToolPolicy: HostedChatRunPlanCoreToolPolicy;
	emptyToolsWhenNone?: boolean;
	localFolderContext?: string;
	localFolderTools?: ToolSet | undefined;
	model: string;
	providerOptions?: ProviderOptions | undefined;
	selectedAppSourceInstructions?: string;
	webSearchEnabled?: boolean;
}) => {
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	enabledTools: ToolSet;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	systemPrompt: string;
	tools: ToolSet;
};
