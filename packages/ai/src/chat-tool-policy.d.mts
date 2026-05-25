import type { ToolSet, UIMessage } from "ai";

export declare const buildCoreChatToolPolicy: ({
	chatAttachmentsApi,
	convexClient,
	message,
	webSearchEnabled,
}: {
	chatAttachmentsApi: unknown;
	convexClient: unknown;
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
