import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { NoteVersionHistoryDialog as NoteVersionHistoryDialogComponent } from "./note-version-history-dialog";

type NoteVersionHistoryDialogModule = {
	NoteVersionHistoryDialog: typeof NoteVersionHistoryDialogComponent;
};

export const NoteVersionHistoryDialogEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<NoteVersionHistoryDialogModule>(
			"./note-version-history-dialog.tsx",
		),
	),
	(module) => module.NoteVersionHistoryDialog,
);
