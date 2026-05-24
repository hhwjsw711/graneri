import type { ToolSet } from "ai";

export declare function hasDeferredOpenAITools(tools: ToolSet): boolean;

export declare function countDeferredOpenAITools(tools: ToolSet): number;

export declare function addOpenAIToolSearch(tools: ToolSet): ToolSet;

export declare function finalizeOpenAIToolSet(tools: ToolSet): {
	tools: ToolSet;
	hasTools: boolean;
	toolCount: number;
	deferredToolCount: number;
	hasToolSearch: boolean;
};
