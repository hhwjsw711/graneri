import { Tiptap, useEditor } from "@tiptap/react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { FileText } from "lucide-react";
import * as React from "react";
import {
	createNoteEditorExtensions,
	parseStoredNoteContent,
} from "@/lib/note-editor";
import type { Doc } from "../../../../../convex/_generated/dataModel";

function SharedNotePageShell({
	children,
	fullHeight = false,
}: {
	children?: React.ReactNode;
	fullHeight?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex flex-1 justify-center px-4 pb-6 md:px-6",
				fullHeight && "min-h-svh",
			)}
		>
			<div className="flex w-full max-w-5xl flex-1 flex-col pt-2 md:pt-4">
				<div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-between gap-6">
					{children}
				</div>
			</div>
		</div>
	);
}

export type SharedNotePageProps = {
	note: Doc<"notes"> | null | undefined;
	onOpenNote?: (noteId: Doc<"notes">["_id"]) => void;
};

export function SharedNotePage({ note }: SharedNotePageProps) {
	const editor = useEditor({
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		editable: false,
		editorProps: {
			attributes: {
				class:
					"note-tiptap min-h-[240px] border border-transparent bg-transparent p-0 text-base outline-none",
			},
		},
	});

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		editor.commands.setContent(
			parseStoredNoteContent(note?.content ?? "", editor.state.schema),
			{
				emitUpdate: false,
			},
		);
	}, [editor, note?.content]);

	if (note === undefined) {
		return <SharedNotePageShell fullHeight />;
	}

	if (note === null) {
		return (
			<div className="flex min-h-svh items-center justify-center px-4 pb-6 md:px-6">
				<Empty className="max-w-xl">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FileText className="size-4" />
						</EmptyMedia>
						<EmptyTitle>This shared note is unavailable</EmptyTitle>
						<EmptyDescription>
							It may have been removed, archived, or switched back to private
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	return (
		<SharedNotePageShell>
			<div className="flex-1 pt-4 md:pt-8">
				<div className="shared-note-page-content flex flex-col gap-6">
					<Textarea
						value={note.title}
						readOnly
						placeholder="New note"
						aria-label="Note title"
						rows={1}
						className="note-title min-h-0 flex-1 resize-none overflow-hidden rounded-none border-0 !bg-transparent p-0 text-2xl font-medium leading-tight tracking-tight shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-0 dark:!bg-transparent md:text-3xl"
					/>

					{editor ? (
						<Tiptap editor={editor}>
							<Tiptap.Content
								className={cn(
									"min-h-[320px] text-base text-foreground",
									"[&_.ProseMirror]:min-h-[320px]",
								)}
							/>
						</Tiptap>
					) : null}
				</div>
			</div>
		</SharedNotePageShell>
	);
}
