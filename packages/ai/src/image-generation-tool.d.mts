import type { Tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";

type ChatAttachmentsApi = {
	generateUploadUrl: unknown;
	getUrl: unknown;
};

type ConvexGeneratedImageUploaderArgs = {
	chatAttachmentsApi: ChatAttachmentsApi;
	client: ConvexHttpClient;
};

type GeneratedImageArtifact = {
	filename: string;
	mediaType: string;
	providerMetadata: {
		opengran: {
			generatedBy: "ai";
			storageId: string;
		};
	};
	url: string;
};

export declare const buildImageGenerationInstruction: () => string;

export declare const shouldEnableImageGeneration: (
	message: unknown,
) => boolean;

export declare const createConvexGeneratedImageUploader: (
	args: ConvexGeneratedImageUploaderArgs,
) => (image: Uint8Array) => Promise<GeneratedImageArtifact>;

export declare const createImageGenerationTool: (args: {
	uploadGeneratedImage: (image: Uint8Array) => Promise<GeneratedImageArtifact>;
}) => Tool;
