import type { ToolSet } from "ai";

export type AutomationSchedulePeriod =
	| "hourly"
	| "daily"
	| "weekdays"
	| "weekly";

export type AutomationAppSource = {
	id: string;
	label: string;
	provider:
		| "google-calendar"
		| "google-drive"
		| "jira-mcp"
		| "notion"
		| "posthog"
		| "yandex-calendar"
		| "yandex-tracker"
		| "zoom";
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
	appConnections: Array<{
		id?: string;
		sourceId?: string;
		displayName?: string;
		title?: string;
		provider?: string;
	}>;
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
	connections: Array<{
		id?: string;
		sourceId?: string;
		displayName?: string;
		title?: string;
		provider?: string;
	}>,
): AutomationAppSource[];
