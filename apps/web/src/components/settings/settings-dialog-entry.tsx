import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { SettingsDialog as SettingsDialogComponent } from "./settings-dialog";

type SettingsDialogModule = {
	SettingsDialog: typeof SettingsDialogComponent;
};

export const SettingsDialogEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<SettingsDialogModule>("./settings-dialog.tsx"),
	),
	(module) => module.SettingsDialog,
);
