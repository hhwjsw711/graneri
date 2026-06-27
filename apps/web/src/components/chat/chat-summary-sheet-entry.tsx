import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { ChatSummarySheet as ChatSummarySheetComponent } from "./chat-summary-sheet";

type ChatSummarySheetModule = {
	ChatSummarySheet: typeof ChatSummarySheetComponent;
};

export const ChatSummarySheetEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<ChatSummarySheetModule>("./chat-summary-sheet.tsx"),
	),
	(module) => module.ChatSummarySheet,
);
