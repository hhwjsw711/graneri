import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { InboxSheet as InboxSheetComponent } from "./inbox-sheet";

type InboxSheetModule = {
	InboxSheet: typeof InboxSheetComponent;
};

export const InboxSheetEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<InboxSheetModule>("./inbox-sheet.tsx"),
	),
	(module) => module.InboxSheet,
);
