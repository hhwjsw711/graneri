import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { TemplatesDialog as TemplatesDialogComponent } from "./templates-dialog";

type TemplatesDialogModule = {
	TemplatesDialog: typeof TemplatesDialogComponent;
};

export const TemplatesDialogEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<TemplatesDialogModule>("./templates-dialog.tsx"),
	),
	(module) => module.TemplatesDialog,
);
