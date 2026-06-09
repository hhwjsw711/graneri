import type { UIMessage } from "ai";

export declare const clampHostedChatWhitespace: (value: string) => string;
export declare const clampHostedNoteContext: (value: string) => string;
export declare const generateHostedChatMessageId: () => string;
export declare const getHostedChatMessageText: (message: UIMessage) => string;
export declare const getHostedChatPreviewFromMessage: (
	message: UIMessage,
) => string;
export declare const toHostedStoredMessage: (message: UIMessage) => {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson: string | undefined;
	text: string;
	createdAt: number;
};
export declare const fromHostedStoredMessages: (
	messages: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>,
) => UIMessage[];
export declare const getInlineHostedNoteContext: (args: {
	title?: string;
	text?: string;
}) => string;
export declare const buildHostedNotesContext: (
	notes: Array<{
		title: string;
		searchableText?: string | null;
	}>,
) => string;
export declare const getHostedChatRecipeContext: (
	selectedRecipe:
		| {
				name: string;
				prompt: string;
		  }
		| null
		| undefined,
) => string;
export declare const buildHostedChatRuntimePrompt: (args: {
	automationInstruction?: string;
	attachedNoteContext?: string;
	coreToolInstruction?: string;
	localFolderContext?: string;
	notesContext?: string;
	recipeContext?: string;
	selectedAppSourceInstructions?: string;
	userProfileContext?: unknown;
	webSearchEnabled?: boolean;
}) => string;
export declare const generateHostedChatTitle: (args: {
	assistantMessage?: UIMessage;
	userMessage: UIMessage;
}) => Promise<string>;
