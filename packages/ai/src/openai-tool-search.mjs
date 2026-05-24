import { openai } from "@ai-sdk/openai";

const TOOL_SEARCH_TOOL_NAME = "toolSearch";

export const hasDeferredOpenAITools = (tools) =>
	Object.entries(tools).some(
		([name, tool]) =>
			name !== TOOL_SEARCH_TOOL_NAME &&
			tool?.providerOptions?.openai?.deferLoading === true,
	);

export const countDeferredOpenAITools = (tools) =>
	Object.entries(tools).filter(
		([name, tool]) =>
			name !== TOOL_SEARCH_TOOL_NAME &&
			tool?.providerOptions?.openai?.deferLoading === true,
	).length;

export const addOpenAIToolSearch = (tools) => {
	if (!hasDeferredOpenAITools(tools)) {
		return tools;
	}

	if (tools[TOOL_SEARCH_TOOL_NAME]) {
		return tools;
	}

	return {
		toolSearch: openai.tools.toolSearch(),
		...tools,
	};
};

export const finalizeOpenAIToolSet = (tools) => {
	const finalizedTools = addOpenAIToolSearch(tools);
	const toolNames = Object.keys(finalizedTools);
	const deferredToolCount = countDeferredOpenAITools(finalizedTools);
	const hasToolSearch = Boolean(finalizedTools[TOOL_SEARCH_TOOL_NAME]);

	if (deferredToolCount > 0 && !hasToolSearch) {
		throw new Error(
			"OpenAI deferred tools require toolSearch in the finalized tool set.",
		);
	}

	return {
		tools: finalizedTools,
		hasTools: toolNames.length > 0,
		toolCount: toolNames.length,
		deferredToolCount,
		hasToolSearch,
	};
};
