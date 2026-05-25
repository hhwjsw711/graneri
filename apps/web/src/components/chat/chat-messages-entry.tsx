import type * as React from "react";
import {
	createDefaultComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { ChatMessagesProps } from "./messages";

export const ChatMessagesEntry = createDefaultComponentEntry<ChatMessagesProps>(
	getOnlyComponentModule(
		import.meta.glob<{
			default: React.ComponentType<ChatMessagesProps>;
		}>("./messages.tsx"),
	),
);
