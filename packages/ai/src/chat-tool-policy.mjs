import { openai } from "@ai-sdk/openai";
import {
	buildChartGenerationInstruction,
	buildChartGenerationPrepareStep,
	createChartGenerationTool,
	shouldEnableChartGeneration,
} from "./chart-generation-tool.mjs";
import {
	buildImageGenerationInstruction,
	createConvexGeneratedImageUploader,
	createImageGenerationTool,
	shouldEnableImageGeneration,
} from "./image-generation-tool.mjs";

export const buildCoreChatToolPolicy = ({
	chatAttachmentsApi,
	convexClient,
	message,
	webSearchEnabled,
}) => {
	const imageGenerationRequested = shouldEnableImageGeneration(message);
	const imageGenerationEnabled = Boolean(
		convexClient && imageGenerationRequested,
	);
	const chartGenerationRequested = shouldEnableChartGeneration(message);
	const enabledTools = {};

	if (webSearchEnabled) {
		enabledTools.web_search = openai.tools.webSearch({
			searchContextSize: "medium",
			userLocation: {
				type: "approximate",
				country: "US",
			},
		});
	}

	if (imageGenerationEnabled) {
		enabledTools.generate_image = createImageGenerationTool({
			uploadGeneratedImage: createConvexGeneratedImageUploader({
				chatAttachmentsApi,
				client: convexClient,
			}),
		});
	}

	if (chartGenerationRequested) {
		enabledTools.generate_chart = createChartGenerationTool();
	}

	return {
		enabledTools,
		instruction: [
			chartGenerationRequested ? buildChartGenerationInstruction() : "",
			imageGenerationEnabled ? buildImageGenerationInstruction() : "",
		]
			.filter(Boolean)
			.join("\n\n"),
		prepareStep: chartGenerationRequested
			? buildChartGenerationPrepareStep()
			: undefined,
		state: {
			chartGenerationRequested,
			imageGenerationEnabled,
			imageGenerationRequested,
			webSearchEnabled,
		},
	};
};
