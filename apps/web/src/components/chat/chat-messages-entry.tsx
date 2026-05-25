import type * as React from "react";
import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { ChatMessagesProps } from "./messages";

export const ChatMessagesEntry = createComponentEntry<
	ChatMessagesProps,
	{
		ChatMessages: React.ComponentType<ChatMessagesProps>;
	}
>(
	getOnlyComponentModule(
		import.meta.glob<{
			ChatMessages: React.ComponentType<ChatMessagesProps>;
		}>("./messages.tsx"),
	),
	(module) => module.ChatMessages,
);
