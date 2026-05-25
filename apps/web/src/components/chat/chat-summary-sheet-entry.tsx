import {
	createOpenComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { ChatSummarySheet as ChatSummarySheetComponent } from "./chat-summary-sheet";

type ChatSummarySheetModule = {
	ChatSummarySheet: typeof ChatSummarySheetComponent;
};

export const ChatSummarySheetEntry = createOpenComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<ChatSummarySheetModule>("./chat-summary-sheet.tsx"),
	),
	(module) => module.ChatSummarySheet,
);
