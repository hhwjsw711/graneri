import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { AutomationsPage as AutomationsPageComponent } from "./automations-page";

type AutomationsPageModule = {
	AutomationsPage: typeof AutomationsPageComponent;
};

export const AutomationsPageEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<AutomationsPageModule>("./automations-page.tsx"),
	),
	(module) => module.AutomationsPage,
);
