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
export declare const buildHostedChatSaveMessageArgs: <
	WorkspaceId extends string,
	NoteId extends string,
	ReasoningEffort extends string,
>(args: {
	chatId: string;
	message: UIMessage;
	model: string;
	noteId?: NoteId | null;
	reasoningEffort: ReasoningEffort;
	title?: string;
	workspaceId: WorkspaceId;
}) => {
	workspaceId: WorkspaceId;
	chatId: string;
	noteId: NoteId | undefined;
	title: string | undefined;
	preview: string;
	model: string;
	reasoningEffort: ReasoningEffort;
	message: ReturnType<typeof toHostedStoredMessage>;
};
export declare const fromHostedStoredMessages: (
	messages: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>,
) => UIMessage[];
export declare const prepareHostedChatBranch: (args: {
	message?: UIMessage;
	messageId?: string;
	messages?: UIMessage[];
	storedMessages?: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>;
	trigger?: "submit-message" | "regenerate-message";
}) => {
	editedMessageIndex: number;
	incomingMessages: UIMessage[];
	shouldTruncateChatBranch: boolean;
	truncateMessageId: string | undefined;
};
export declare const getInlineHostedNoteContext: (args: {
	title?: string;
	text?: string;
}) => string;
export declare const getStoredHostedNoteContext: (
	note:
		| {
				title: string;
				searchableText?: string | null;
		  }
		| null
		| undefined,
) => string;
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
