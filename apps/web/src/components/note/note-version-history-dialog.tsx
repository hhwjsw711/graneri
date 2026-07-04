import type { JSONContent } from "@tiptap/core";
import { Tiptap, useEditor } from "@tiptap/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { History, Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	ManageDialogHeader,
	ManageDialogSidebarNav,
} from "@/components/ui/manage-dialog-navigation";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { logError } from "@/lib/logger";
import { removeNoteDraft } from "@/lib/note-draft";
import {
	createNoteEditorExtensions,
	parseStoredNoteContent,
} from "@/lib/note-editor";
import { getNoteDisplayTitle } from "@/lib/note-title";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type NoteVersion = {
	id: Id<"noteRevisions"> | "current";
	isCurrent: boolean;
	authorName: string;
	title: string;
	content: string;
	searchableText: string;
	createdAt: number;
};

export type NoteVersionHistoryDialogProps = {
	noteId: Id<"notes">;
	initialVersion: NoteVersion | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

const versionDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

const stripCommentMarks = (node: JSONContent): JSONContent => ({
	...node,
	marks: node.marks?.filter((mark) => mark.type !== "noteComment"),
	content: node.content?.map(stripCommentMarks),
});

function VersionHistoryDialogShell({
	activeItemId,
	children,
	footerAction,
	isLoadingVersions,
	items,
	mobileAction,
	onSelect,
}: React.PropsWithChildren<{
	activeItemId: string | null;
	footerAction?: {
		disabled?: boolean;
		icon: typeof History;
		label: string;
		onClick: () => void;
	};
	isLoadingVersions?: boolean;
	items: Array<{ id: string; icon: typeof History; label: string }>;
	mobileAction?: {
		disabled?: boolean;
		icon: typeof History;
		label: string;
		onClick: () => void;
	};
	onSelect: (versionId: string) => void;
}>) {
	return (
		<>
			<DialogHeader className="sr-only">
				<DialogTitle>Version history</DialogTitle>
				<DialogDescription>
					Review saved changes for this note.
				</DialogDescription>
			</DialogHeader>
			<DialogDescription className="sr-only">
				Review saved changes for this note.
			</DialogDescription>
			<SidebarProvider className="h-[480px] min-h-0 items-start">
				<ManageDialogSidebarNav
					activeItemId={activeItemId}
					footerAction={footerAction}
					isLoading={isLoadingVersions}
					items={items}
					onSelect={onSelect}
				/>
				<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
					<ManageDialogHeader
						activeItemId={activeItemId}
						items={items}
						mobileAction={mobileAction}
						onSelect={onSelect}
						title="Version history"
					/>
					<section className="min-h-0 flex-1">{children}</section>
				</main>
			</SidebarProvider>
		</>
	);
}

function NoteVersionPreview({ version }: { version: NoteVersion }) {
	const editor = useEditor({
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		editable: false,
		editorProps: {
			attributes: {
				class:
					"note-tiptap min-h-[180px] border border-transparent bg-transparent p-0 text-sm outline-none",
			},
		},
	});

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const parsedContent = parseStoredNoteContent(
			version.content,
			editor.state.schema,
		);
		editor.commands.setContent(stripCommentMarks(parsedContent), {
			emitUpdate: false,
		});
	}, [editor, version.content]);

	if (!version.searchableText.trim()) {
		return (
			<p className="text-muted-foreground text-sm">
				This version has no text content.
			</p>
		);
	}

	return editor ? (
		<Tiptap editor={editor}>
			<Tiptap.Content
				className={cn(
					"max-w-none text-foreground text-sm",
					"[&_.ProseMirror]:min-h-[180px]",
					"[&_.ProseMirror]:outline-none",
					"[&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h1]:text-2xl",
					"[&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-xl",
					"[&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-lg",
					"[&_.ProseMirror_p]:leading-6",
					"[&_.note-comment-anchor]:bg-transparent [&_.note-comment-anchor]:text-inherit",
				)}
			/>
		</Tiptap>
	) : null;
}

function NoteVersionHistoryDialogContent({
	initialVersion,
	noteId,
	onOpenChange,
	open,
}: Pick<
	NoteVersionHistoryDialogProps,
	"initialVersion" | "noteId" | "onOpenChange" | "open"
>) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const restoreVersion = useMutation(api.notes.restoreVersion);
	const versions = useQuery(
		api.notes.listVersions,
		open && activeWorkspaceId
			? { workspaceId: activeWorkspaceId, id: noteId }
			: "skip",
	);
	const [activeVersionId, setActiveVersionId] = React.useState<string | null>(
		null,
	);
	const displayVersions = React.useMemo(
		() => versions ?? (initialVersion ? [initialVersion] : []),
		[initialVersion, versions],
	);
	const isLoadingVersions = Boolean(
		open && activeWorkspaceId && versions === undefined,
	);
	const navigationItems = React.useMemo(
		() =>
			displayVersions.map((version) => ({
				id: version.id,
				icon: History,
				label: versionDateFormatter.format(new Date(version.createdAt)),
			})),
		[displayVersions],
	);
	const selectedVersion =
		displayVersions.find((version) => version.id === activeVersionId) ??
		displayVersions[0] ??
		null;
	const [confirmRestoreOpen, setConfirmRestoreOpen] = React.useState(false);
	const [isRestoring, setIsRestoring] = React.useState(false);

	const handleRestoreRequest = React.useCallback(() => {
		if (
			!activeWorkspaceId ||
			!selectedVersion ||
			selectedVersion.id === "current"
		) {
			return;
		}

		setConfirmRestoreOpen(true);
	}, [activeWorkspaceId, selectedVersion]);

	const handleRestore = React.useCallback(async () => {
		if (
			!activeWorkspaceId ||
			!selectedVersion ||
			selectedVersion.id === "current"
		) {
			return;
		}

		setIsRestoring(true);
		try {
			await restoreVersion({
				workspaceId: activeWorkspaceId,
				id: noteId,
				revisionId: selectedVersion.id,
			});
			await removeNoteDraft(noteId);
			setConfirmRestoreOpen(false);
			onOpenChange(false);
			toast.success("Version restored");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to restore note version",
			});
			toast.error("Failed to restore version");
		} finally {
			setIsRestoring(false);
		}
	}, [
		activeWorkspaceId,
		noteId,
		onOpenChange,
		restoreVersion,
		selectedVersion,
	]);

	return (
		<VersionHistoryDialogShell
			activeItemId={selectedVersion?.id ?? null}
			footerAction={{
				disabled: !selectedVersion || selectedVersion.isCurrent || isRestoring,
				icon: Undo2,
				label: isRestoring ? "Restoring..." : "Restore",
				onClick: handleRestoreRequest,
			}}
			isLoadingVersions={isLoadingVersions}
			items={navigationItems}
			mobileAction={{
				disabled: !selectedVersion || selectedVersion.isCurrent || isRestoring,
				icon: Undo2,
				label: isRestoring ? "Restoring..." : "Restore",
				onClick: handleRestoreRequest,
			}}
			onSelect={setActiveVersionId}
		>
			{displayVersions.length === 0 || !selectedVersion ? (
				<div className="flex h-full items-center justify-center px-4 text-muted-foreground text-sm">
					No saved versions yet.
				</div>
			) : (
				<ScrollArea className="h-full">
					<div className="mx-auto max-w-2xl p-6">
						<article className="space-y-4">
							<h3 className="text-balance font-semibold text-2xl tracking-normal">
								{getNoteDisplayTitle(selectedVersion.title)}
							</h3>
							<NoteVersionPreview version={selectedVersion} />
						</article>
					</div>
				</ScrollArea>
			)}
			<AlertDialog
				open={confirmRestoreOpen}
				onOpenChange={setConfirmRestoreOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Restore this version?</AlertDialogTitle>
						<AlertDialogDescription>
							This will make the selected version the current note. The current
							note will be saved in version history first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isRestoring}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void handleRestore();
							}}
							disabled={isRestoring}
						>
							{isRestoring ? "Restoring..." : "Restore"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</VersionHistoryDialogShell>
	);
}

export function NoteVersionHistoryDialog({
	initialVersion,
	noteId,
	open,
	onOpenChange,
}: NoteVersionHistoryDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<NoteVersionHistoryDialogContent
					initialVersion={initialVersion}
					noteId={noteId}
					onOpenChange={onOpenChange}
					open={open}
				/>
			</DialogContent>
		</Dialog>
	);
}
