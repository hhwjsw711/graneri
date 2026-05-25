import type { ToolSet, UIMessage } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import type { ChatAttachmentsApi } from "./image-generation-tool.mjs";

export declare const buildCoreChatToolPolicy: ({
	chatAttachmentsApi,
	convexClient,
	message,
	webSearchEnabled,
}: {
	chatAttachmentsApi: ChatAttachmentsApi;
	convexClient: ConvexHttpClient | null | undefined;
	message: UIMessage | undefined;
	webSearchEnabled: boolean;
}) => {
	enabledTools: ToolSet;
	instruction: string;
	prepareStep:
		| (({ stepNumber }: { stepNumber: number }) => {
				toolChoice: { type: "tool"; toolName: "generate_chart" } | "auto";
		  })
		| undefined;
	state: {
		chartGenerationRequested: boolean;
		imageGenerationEnabled: boolean;
		imageGenerationRequested: boolean;
		webSearchEnabled: boolean;
	};
};
