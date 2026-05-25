import type { Tool } from "ai";
import type { UIMessage } from "ai";

export declare const CHART_GENERATION_TOOL_NAME = "generate_chart";

export declare const buildChartGenerationInstruction: () => string;

export declare const buildChartGenerationPrepareStep: () => ({
	stepNumber,
}: {
	stepNumber: number;
}) =>
	| {
			toolChoice: { type: "tool"; toolName: typeof CHART_GENERATION_TOOL_NAME };
	  }
	| { toolChoice: "auto" };

export declare const createChartGenerationTool: () => Tool;

export declare const shouldEnableChartGeneration: (
	message: UIMessage | undefined,
) => boolean;
