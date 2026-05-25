import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { NotePage as NotePageComponent } from "./note-page";

type NotePageModule = {
	NotePage: typeof NotePageComponent;
};

export const NotePageEntry = createComponentEntry(
	getOnlyComponentModule(import.meta.glob<NotePageModule>("./note-page.tsx")),
	(module) => module.NotePage,
);
