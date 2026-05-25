import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Paperclip, X } from "lucide-react";
import { type CSSProperties, useState } from "react";
import {
	type ChatGeneratedArtifact,
	parseGeneratedArtifact,
} from "@/lib/chat-message";

export function GeneratedArtifactToolPreview({ output }: { output: unknown }) {
	const artifact = parseGeneratedArtifact(output);
	const [previewImage, setPreviewImage] =
		useState<ChatGeneratedArtifact | null>(null);

	if (!artifact) {
		return null;
	}

	return (
		<>
			<div className="mt-2 flex max-w-full flex-wrap gap-2">
				{artifact.mediaType.startsWith("image/") ? (
					<button
						type="button"
						className="size-24 cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => setPreviewImage(artifact)}
					>
						<img
							src={artifact.url}
							alt={artifact.filename || "Generated image"}
							className="size-full object-cover"
						/>
					</button>
				) : (
					<a
						href={artifact.url}
						target="_blank"
						rel="noreferrer"
						className="flex h-10 max-w-full items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<Paperclip className="size-4 shrink-0" />
						<span className="min-w-0 truncate">
							{artifact.filename || "Generated file"}
						</span>
					</a>
				)}
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
						} as CSSProperties
					}
					onPointerDown={(event) => {
						if (event.target === event.currentTarget) {
							setPreviewImage(null);
						}
					}}
				>
					<DialogTitle className="sr-only">
						{previewImage?.filename || "Generated image preview"}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Generated image preview.
					</DialogDescription>
					{previewImage ? (
						<img
							src={previewImage.url}
							alt={previewImage.filename || "Generated image preview"}
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
