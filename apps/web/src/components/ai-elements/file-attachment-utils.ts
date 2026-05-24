import type { FileUIPart } from "ai";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type ChatAttachment = FileUIPart & {
	id: string;
	localUrl?: string;
	uploadStatus: "uploading" | "ready";
};

export type UploadResult = {
	storageId?: Id<"_storage">;
};

export const getReadyFileParts = (
	attachments: ChatAttachment[],
): FileUIPart[] =>
	attachments.flatMap((attachment) =>
		attachment.uploadStatus === "ready"
			? [
					{
						type: "file" as const,
						mediaType: attachment.mediaType,
						filename: attachment.filename,
						url: attachment.url,
						providerMetadata: attachment.providerMetadata,
					},
				]
			: [],
	);

export const hasUploadingAttachments = (attachments: ChatAttachment[]) =>
	attachments.some((attachment) => attachment.uploadStatus === "uploading");
