import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { SearchCommand as SearchCommandComponent } from "./search-command";

type SearchCommandModule = {
	SearchCommand: typeof SearchCommandComponent;
};

export const SearchCommandEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<SearchCommandModule>("./search-command.tsx"),
	),
	(module) => module.SearchCommand,
);
