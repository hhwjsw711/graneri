import { openai } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { finalizeOpenAIToolSet } from "./openai-tool-search.mjs";

export const createHostedChatAgent = ({
	additionalAgentTools,
	enabledTools,
	emptyToolsWhenNone = false,
	model,
	prepareStep,
	providerOptions,
	systemPrompt,
}) => {
	const finalizedToolSet = finalizeOpenAIToolSet(enabledTools);
	const hasAdditionalAgentTools =
		additionalAgentTools && Object.keys(additionalAgentTools).length > 0;
	const agentTools =
		finalizedToolSet.hasTools || hasAdditionalAgentTools
			? {
					...(finalizedToolSet.hasTools ? finalizedToolSet.tools : {}),
					...(additionalAgentTools ?? {}),
				}
			: undefined;
	const agent = new ToolLoopAgent({
		model: openai(model),
		providerOptions,
		instructions: systemPrompt,
		tools: agentTools ?? (emptyToolsWhenNone ? {} : undefined),
		prepareStep,
		stopWhen: agentTools ? stepCountIs(5) : undefined,
	});

	return {
		agent,
		agentTools,
		finalizedToolSet,
		tools: finalizedToolSet.tools,
	};
};
