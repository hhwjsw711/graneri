import type * as React from "react";
import {
	createDefaultComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { NoteChatMessagesProps } from "./note-chat-messages";

export const NoteChatMessagesEntry =
	createDefaultComponentEntry<NoteChatMessagesProps>(
		getOnlyComponentModule(
			import.meta.glob<{
				default: React.ComponentType<NoteChatMessagesProps>;
			}>("./note-chat-messages.tsx"),
		),
	);
