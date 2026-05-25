import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { RecipesDialog as RecipesDialogComponent } from "./recipes-dialog";

type RecipesDialogModule = {
	RecipesDialog: typeof RecipesDialogComponent;
};

export const RecipesDialogEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<RecipesDialogModule>("./recipes-dialog.tsx"),
	),
	(module) => module.RecipesDialog,
);
