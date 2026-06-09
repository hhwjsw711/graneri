import type { ToolSet } from "ai";
import type {
	AppSourceInstructionConnection,
	AppSourceProvider,
} from "./capability-metadata.mjs";

export type AutomationSchedulePeriod =
	| "hourly"
	| "daily"
	| "weekdays"
	| "weekly";

export type AutomationAppSource = {
	id: string;
	label: string;
	provider: AppSourceProvider;
};

export declare const automationAppSourceProviders: readonly AutomationAppSource["provider"][];

export type AutomationToolInput = {
	title: string;
	prompt: string;
	model: string;
	reasoningEffort: "low" | "medium" | "high" | "xhigh";
	webSearchEnabled: boolean;
	appsEnabled: boolean;
	appSources: AutomationAppSource[];
	schedulePeriod: AutomationSchedulePeriod;
	scheduledAt: number;
	timezone: string;
	target: {
		kind: "workspace";
	};
	chatId: string;
};

export type AutomationToolResult = {
	id: unknown;
	title: string;
	prompt: string;
	schedulePeriod: AutomationSchedulePeriod;
	scheduledAt: number;
	timezone: string;
	nextRunAt: number | null;
	chatId: string;
};

export declare function buildAutomationCreationInstruction(args: {
	now: number;
	timezone: string;
}): string;

export declare function createAutomationTool(args: {
	appSources: AutomationAppSource[];
	chatId: string;
	createAutomation: (
		automation: AutomationToolInput,
	) => Promise<AutomationToolResult>;
	defaultModel: string;
	defaultReasoningEffort: "low" | "medium" | "high" | "xhigh";
	defaultTimezone: string;
	webSearchEnabled: boolean;
}): ToolSet[string];

export declare function buildChatAutomationContext(args: {
	appConnections: AppSourceInstructionConnection[];
	chatId: string | null | undefined;
	createAutomation:
		| ((automation: AutomationToolInput) => Promise<AutomationToolResult>)
		| null
		| undefined;
	defaultModel: string;
	defaultReasoningEffort: "low" | "medium" | "high" | "xhigh";
	defaultTimezone: string;
	webSearchEnabled: boolean;
}): {
	instruction: string;
	tools: ToolSet;
};

export declare function normalizeAutomationAppSources(
	connections: AppSourceInstructionConnection[],
): AutomationAppSource[];
