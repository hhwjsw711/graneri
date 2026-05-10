import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { Spinner } from "@workspace/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import { useMutation } from "convex/react";
import { FileText, Paperclip, X } from "lucide-react";
import * as React from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type UploadResult = {
	storageId?: Id<"_storage">;
};

export type ChatAttachment = FileUIPart & {
	id: string;
	localUrl?: string;
	uploadStatus: "uploading" | "ready";
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

export function useRevokeAttachmentObjectUrls(attachments: ChatAttachment[]) {
	const localUrlByIdRef = React.useRef(new Map<string, string>());

	React.useEffect(() => {
		const nextLocalUrlById = new Map<string, string>();

		for (const attachment of attachments) {
			if (attachment.localUrl) {
				nextLocalUrlById.set(attachment.id, attachment.localUrl);
			}
		}

		for (const [id, localUrl] of localUrlByIdRef.current) {
			if (nextLocalUrlById.get(id) !== localUrl) {
				URL.revokeObjectURL(localUrl);
			}
		}

		localUrlByIdRef.current = nextLocalUrlById;
	}, [attachments]);

	React.useEffect(
		() => () => {
			for (const localUrl of localUrlByIdRef.current.values()) {
				URL.revokeObjectURL(localUrl);
			}
			localUrlByIdRef.current.clear();
		},
		[],
	);
}

function useConvexFileAttachmentUpload() {
	const generateUploadUrl = useMutation(api.chatAttachments.generateUploadUrl);
	const getFileUrl = useMutation(api.chatAttachments.getUrl);

	return React.useCallback(
		async (file: File): Promise<FileUIPart> => {
			const uploadUrl = await generateUploadUrl();
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});

			if (!response.ok) {
				throw new Error("Attachment upload failed.");
			}

			const result = (await response.json()) as UploadResult;
			if (!result.storageId) {
				throw new Error("Attachment upload did not return a storage id.");
			}

			const url = await getFileUrl({ storageId: result.storageId });
			if (!url) {
				throw new Error("Attachment upload did not return a file URL.");
			}

			return {
				type: "file",
				mediaType: file.type || "application/octet-stream",
				filename: file.name,
				url,
				providerMetadata: {
					opengran: {
						storageId: result.storageId,
					},
				},
			};
		},
		[generateUploadUrl, getFileUrl],
	);
}

function createPendingAttachment(file: File, idSuffix: number): ChatAttachment {
	const localUrl = URL.createObjectURL(file);

	return {
		id: [file.name, file.size, file.lastModified, Date.now(), idSuffix].join(
			":",
		),
		type: "file",
		mediaType: file.type || "application/octet-stream",
		filename: file.name,
		url: localUrl,
		localUrl,
		uploadStatus: "uploading",
	};
}

function hasDraggedFiles(event: React.DragEvent<HTMLElement>) {
	return Array.from(event.dataTransfer.types).includes("Files");
}

export function useFileAttachmentDropzone({
	disabled,
	onFilesAdded,
	onFileUploadFailed,
	onFileUploaded,
}: {
	disabled?: boolean;
	onFilesAdded: (files: ChatAttachment[]) => void;
	onFileUploadFailed: (id: string) => void;
	onFileUploaded: (id: string, file: FileUIPart) => void;
}) {
	const attachmentIdCounterRef = React.useRef(0);
	const dragDepthRef = React.useRef(0);
	const [isDragOver, setIsDragOver] = React.useState(false);
	const uploadFile = useConvexFileAttachmentUpload();

	const uploadFiles = React.useCallback(
		(files: File[]) => {
			if (disabled || files.length === 0) {
				return;
			}

			const attachments = files.map((file) => {
				attachmentIdCounterRef.current += 1;
				return createPendingAttachment(file, attachmentIdCounterRef.current);
			});

			onFilesAdded(attachments);

			for (const [index, file] of files.entries()) {
				const attachment = attachments[index];
				void uploadFile(file)
					.then((uploadedFile) => onFileUploaded(attachment.id, uploadedFile))
					.catch((error) => {
						console.error("Failed to upload attachment", error);
						onFileUploadFailed(attachment.id);
					});
			}
		},
		[disabled, onFileUploadFailed, onFileUploaded, onFilesAdded, uploadFile],
	);

	const handleDragEnter = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			dragDepthRef.current += 1;
			setIsDragOver(true);
		},
		[disabled],
	);

	const handleDragOver = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			setIsDragOver(true);
		},
		[disabled],
	);

	const handleDragLeave = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
			if (dragDepthRef.current === 0) {
				setIsDragOver(false);
			}
		},
		[disabled],
	);

	const handleDrop = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			dragDepthRef.current = 0;
			setIsDragOver(false);
			uploadFiles(Array.from(event.dataTransfer.files));
		},
		[disabled, uploadFiles],
	);

	return {
		isDragOver,
		uploadFiles,
		dropzoneProps: {
			onDragEnter: handleDragEnter,
			onDragOver: handleDragOver,
			onDragLeave: handleDragLeave,
			onDrop: handleDrop,
		},
	};
}

export function FileAttachmentButton({
	disabled,
	onFilesAdded,
	onFileUploadFailed,
	onFileUploaded,
}: {
	disabled?: boolean;
	onFilesAdded: (files: ChatAttachment[]) => void;
	onFileUploadFailed: (id: string) => void;
	onFileUploaded: (id: string, file: FileUIPart) => void;
}) {
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const { uploadFiles } = useFileAttachmentDropzone({
		disabled,
		onFilesAdded,
		onFileUploadFailed,
		onFileUploaded,
	});

	return (
		<>
			<input
				ref={inputRef}
				aria-label="Attach files"
				className="hidden"
				multiple
				onChange={(event) => {
					const files = event.currentTarget.files;
					if (!files || files.length === 0) {
						return;
					}

					const selectedFiles = Array.from(files);
					uploadFiles(selectedFiles);

					if (inputRef.current) {
						inputRef.current.value = "";
					}
				}}
				type="file"
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<InputGroupButton
						aria-label="Attach files"
						className="shrink-0 rounded-full bg-transparent !text-muted-foreground shadow-none hover:bg-muted hover:!text-foreground"
						disabled={disabled}
						onClick={() => inputRef.current?.click()}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<Paperclip className="size-4" />
					</InputGroupButton>
				</TooltipTrigger>
				<TooltipContent>Attach files</TooltipContent>
			</Tooltip>
		</>
	);
}

export function FileAttachmentChips({
	files,
	onRemove,
}: {
	files: ChatAttachment[];
	onRemove: (index: number) => void;
}) {
	const [previewImage, setPreviewImage] = React.useState<ChatAttachment | null>(
		null,
	);

	if (files.length === 0) {
		return null;
	}

	return (
		<>
			<div className="no-scrollbar -m-1.5 flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-1.5">
				{files.map((file, index) => {
					const isImage = file.mediaType.startsWith("image/");
					const canPreview = isImage && file.url.length > 0;

					return (
						<div
							key={file.id}
							className={cn(
								"group/attachment-preview relative flex size-14 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground",
								file.uploadStatus === "uploading" && "opacity-80",
							)}
						>
							<button
								type="button"
								className={cn(
									"flex size-12 items-center justify-center overflow-hidden rounded-[5px] bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									canPreview && "cursor-zoom-in",
								)}
								onClick={() => {
									if (canPreview) {
										setPreviewImage(file);
									}
								}}
								aria-label={
									canPreview
										? `Preview ${file.filename || "attached image"}`
										: file.filename || "Attached file"
								}
							>
								{isImage ? (
									<img
										src={file.url}
										alt={file.filename || "Attached image"}
										className="size-full object-cover"
									/>
								) : (
									<FileText className="size-5" />
								)}
							</button>
							{file.uploadStatus === "uploading" ? (
								<div className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
									<Spinner className="size-4" aria-label="Uploading file" />
								</div>
							) : null}
							<button
								type="button"
								className="absolute -top-1.5 -right-1.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-[opacity,transform] duration-150 ease-out hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] group-hover/attachment-preview:opacity-100"
								onClick={() => onRemove(index)}
								aria-label={`Remove ${file.filename || "attachment"}`}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
			</div>
			<Dialog
				open={previewImage !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPreviewImage(null);
					}
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="!top-0 !left-0 !flex !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 items-center justify-center !rounded-none !border-0 !bg-transparent p-10 !shadow-none !ring-0 sm:!max-w-none"
					style={
						{
							"--tw-enter-scale": "1",
							"--tw-exit-scale": "1",
						} as React.CSSProperties
					}
					onPointerDown={(event) => {
						if (event.target === event.currentTarget) {
							setPreviewImage(null);
						}
					}}
				>
					<DialogTitle className="sr-only">
						{previewImage?.filename || "Attached image preview"}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Image attachment preview.
					</DialogDescription>
					{previewImage ? (
						<img
							src={previewImage.url}
							alt={previewImage.filename || "Attached image preview"}
							className="max-h-full max-w-full object-contain shadow-2xl"
						/>
					) : null}
					<DialogClose className="absolute top-4 right-4 cursor-pointer rounded-full bg-background/90 p-2 text-foreground shadow-lg transition hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring">
						<X className="size-5" />
						<span className="sr-only">Close</span>
					</DialogClose>
				</DialogContent>
			</Dialog>
		</>
	);
}
