import type { ToolSet } from "ai";
import type { AppSourceInstructionConnection } from "./capability-metadata.mjs";

export type AutomationSchedulePeriod =
	| "hourly"
	| "daily"
	| "weekdays"
	| "weekly";

export type AutomationAppSource = {
	id: string;
	label: string;
	provider: string;
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
	target:
		| {
				kind: "workspace";
				label?: string;
		  }
		| {
				kind: "notes";
				label?: string;
				noteIds: string[];
		  };
	chatId: string;
};

export type AutomationToolResult = {
	id: unknown;
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
	target: AutomationToolInput["target"];
	nextRunAt: number | null;
	isPaused: boolean;
	chatId: string;
};

export type AutomationConfirmationToolResult = {
	id: string;
	requiresConfirmation: true;
	confirmation: {
		kind: "delete_automation";
		message: string;
		options: Array<{ id: "confirm" | "cancel"; label: string }>;
		title: string;
	};
};

export type AutomationActions = {
	createAutomation: (
		automation: AutomationToolInput,
	) => Promise<AutomationToolResult>;
	deleteAutomation?: (args: { automationId: string }) => Promise<unknown>;
	getAutomation?: (args: {
		automationId: string;
	}) => Promise<AutomationToolResult | null>;
	listAutomations?: () => Promise<AutomationToolResult[]>;
	runAutomationNow?: (args: { automationId: string }) => Promise<unknown>;
	togglePaused?: (args: {
		automationId: string;
	}) => Promise<AutomationToolResult>;
	updateAutomation?: (
		automation: AutomationToolInput & { automationId: string },
	) => Promise<AutomationToolResult>;
};

export declare function buildAutomationCreationInstruction(args: {
	now: number;
	timezone: string;
}): string;

export declare function createAutomationTool(args: {
	appSources: AutomationAppSource[];
	chatId: string;
	createAutomation: AutomationActions["createAutomation"];
	defaultModel: string;
	defaultReasoningEffort: "low" | "medium" | "high" | "xhigh";
	defaultTimezone: string;
	webSearchEnabled: boolean;
}): ToolSet[string];

export declare function buildChatAutomationContext(args: {
	appConnections: AppSourceInstructionConnection[];
	automationActions: AutomationActions | null | undefined;
	chatId: string | null | undefined;
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
