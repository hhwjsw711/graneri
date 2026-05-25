import type * as React from "react";
import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { MarkdownStreamProps } from "./markdown-stream";

export const MarkdownStreamEntry = createComponentEntry<
	MarkdownStreamProps,
	{
		MarkdownStream: React.ComponentType<MarkdownStreamProps>;
	}
>(
	getOnlyComponentModule(
		import.meta.glob<{
			MarkdownStream: React.ComponentType<MarkdownStreamProps>;
		}>("./markdown-stream.tsx"),
	),
	(module) => module.MarkdownStream,
);
