import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { SharedNotePage as SharedNotePageComponent } from "./shared-note-page";

type SharedNotePageModule = {
	SharedNotePage: typeof SharedNotePageComponent;
};

export const SharedNotePageEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<SharedNotePageModule>("./shared-note-page.tsx"),
	),
	(module) => module.SharedNotePage,
);
