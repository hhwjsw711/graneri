import type * as React from "react";
import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { NoteChatMessagesProps } from "./note-chat-messages";

export const NoteChatMessagesEntry = createComponentEntry<
	NoteChatMessagesProps,
	{
		NoteChatMessages: React.ComponentType<NoteChatMessagesProps>;
	}
>(
	getOnlyComponentModule(
		import.meta.glob<{
			NoteChatMessages: React.ComponentType<NoteChatMessagesProps>;
		}>("./note-chat-messages.tsx"),
	),
	(module) => module.NoteChatMessages,
);
