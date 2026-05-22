import { openai } from "@ai-sdk/openai";

export const hasDeferredOpenAITools = (tools) =>
	Object.entries(tools).some(
		([name, tool]) =>
			name !== "toolSearch" &&
			tool?.providerOptions?.openai?.deferLoading === true,
	);

export const addOpenAIToolSearch = (tools) => {
	if (!hasDeferredOpenAITools(tools)) {
		return tools;
	}

	return {
		toolSearch: openai.tools.toolSearch(),
		...tools,
	};
};
