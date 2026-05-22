import type { ToolSet } from "ai";
import type { z } from "zod";

export type AiToolPolicy = {
	access: "read" | "write";
	capability: "generate" | "read" | "search" | "write";
	provider: string;
	requiresApproval?: boolean;
	requiresConnection?: boolean;
};

export type AiToolUi = {
	complete: string;
	groupLabel?: string;
	groupKey?: string;
	icon: string;
	running: string;
	subtitleKeys?: string[];
};

export type AiToolDefinition<
	TInput = unknown,
	TOutput = unknown,
> = {
	description: string;
	inputSchema: z.ZodType<TInput>;
	name: string;
	policy: AiToolPolicy;
	ui: AiToolUi;
	toAITool(): ToolSet[string];
};

export declare function defineAiTool<TInput, TOutput>(args: {
	deferLoading?: boolean;
	description: string;
	execute(input: TInput): Promise<TOutput> | TOutput;
	inputSchema: z.ZodType<TInput>;
	name: string;
	policy: AiToolPolicy;
	ui: AiToolUi;
}): AiToolDefinition<TInput, TOutput>;

export declare function buildAiToolSet(
	definitions: AiToolDefinition[],
): ToolSet;

export declare function buildAiToolMetadata(
	definitions: AiToolDefinition[],
): Record<
	string,
	{
		description: string;
		policy: AiToolPolicy;
		ui: AiToolUi;
	}
>;
