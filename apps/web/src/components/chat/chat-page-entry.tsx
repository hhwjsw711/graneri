import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { ChatPage as ChatPageComponent } from "./chat-page";

type ChatPageModule = {
	ChatPage: typeof ChatPageComponent;
};

export const ChatPageEntry = createComponentEntry(
	getOnlyComponentModule(import.meta.glob<ChatPageModule>("./chat-page.tsx")),
	(module) => module.ChatPage,
);
