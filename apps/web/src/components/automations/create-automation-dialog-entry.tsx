import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { CreateAutomationDialog as CreateAutomationDialogComponent } from "./create-automation-dialog";

type CreateAutomationDialogModule = {
	CreateAutomationDialog: typeof CreateAutomationDialogComponent;
};

export const CreateAutomationDialogEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<CreateAutomationDialogModule>(
			"./create-automation-dialog.tsx",
		),
	),
	(module) => module.CreateAutomationDialog,
);
