import { Icons } from "@workspace/ui/components/icons";
import { SidebarMenuButton } from "@workspace/ui/components/sidebar";
import { FileText } from "lucide-react";
import type { Id } from "../../../../../convex/_generated/dataModel";

const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

export function NoteRenameAnchor({
	displayTitle,
	isActive,
	isRecording,
	noteId,
	onNoteSelect,
	onPrefetchNote,
}: {
	displayTitle: string;
	isActive: boolean;
	isRecording: boolean;
	noteId: Id<"notes">;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onPrefetchNote: (noteId: Id<"notes">) => void;
}) {
	return (
		<SidebarMenuButton
			isActive={isActive}
			onFocus={() => onPrefetchNote(noteId)}
			onMouseEnter={() => onPrefetchNote(noteId)}
			onPointerDown={() => onPrefetchNote(noteId)}
			onClick={() => onNoteSelect(noteId)}
		>
			{isRecording ? <SidebarRecordingSpinner /> : <FileText />}
			<span>{displayTitle}</span>
		</SidebarMenuButton>
	);
}
