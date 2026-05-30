import type { Tool } from "ai";
import type { UIMessage } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import type { GenericId } from "convex/values";

export type ChatAttachmentsApi = {
	generateUploadUrl: FunctionReference<"mutation", "public", Record<string, never>, string>;
	getUrl: FunctionReference<
		"mutation",
		"public",
		{ storageId: GenericId<"_storage"> },
		string | null
	>;
};

type ConvexGeneratedImageUploaderArgs = {
	chatAttachmentsApi: ChatAttachmentsApi;
	client: ConvexHttpClient;
};

type GeneratedImageArtifact = {
	filename: string;
	mediaType: string;
	providerMetadata: {
		graneri: {
			generatedBy: "ai";
			storageId: string;
		};
	};
	url: string;
};

export declare const buildImageGenerationInstruction: () => string;

export declare const shouldEnableImageGeneration: (message: UIMessage | undefined) => boolean;

export declare const createConvexGeneratedImageUploader: (
	args: ConvexGeneratedImageUploaderArgs,
) => (image: Uint8Array) => Promise<GeneratedImageArtifact>;

export declare const createImageGenerationTool: (args: {
	uploadGeneratedImage: (image: Uint8Array) => Promise<GeneratedImageArtifact>;
}) => Tool;
