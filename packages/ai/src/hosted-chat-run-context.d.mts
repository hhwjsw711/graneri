import type { ProviderOptions, ToolLoopAgent, ToolSet, UIMessage } from "ai";
import type {
	AutomationToolInput,
	AutomationToolResult,
} from "./automation-tools.mjs";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type LocalFolderReference = {
	id?: string;
	path?: string;
};

type LocalFolderRoot = {
	id?: string;
	name: string;
	path: string;
};

type AppConnection = Record<string, unknown>;

type Recipe = Record<string, unknown> | null;

type ChatAttachmentsApi = Record<string, unknown>;

export declare const getHostedChatLocalFolderReferencePaths: (
	localFolders?: LocalFolderReference[],
) => string[];

export declare const getHostedChatLocalFolderReferenceIds: (
	localFolders?: LocalFolderReference[],
) => string[];

export declare const buildHostedChatRunContext: (args: {
	appsEnabled?: boolean;
	chatAttachmentsApi: ChatAttachmentsApi;
	chatId: string;
	convexClient: unknown;
	createAutomation: (
		automation: AutomationToolInput,
	) => Promise<AutomationToolResult>;
	defaultModel: string;
	defaultReasoningEffort: string;
	defaultTimezone: string;
	getActiveStreamSession: () => HostedActiveStreamSession | null;
	getNotesContext: () => Promise<string>;
	getSelectedAppConnections: (args: {
		selectedSourceIds: string[];
		workspaceId: string;
	}) => Promise<AppConnection[]>;
	getSelectedRecipe: (args: {
		recipeSlug?: string | null;
		workspaceId: string;
	}) => Promise<Recipe>;
	getStoredNoteContext: (args: {
		noteId: string;
		workspaceId: string;
	}) => Promise<string>;
	getUserProfileContext: () => Promise<unknown>;
	localFolders?: LocalFolderReference[];
	logLatency: (stage: string, details?: LogLatencyDetails) => void;
	message?: UIMessage | null;
	noteContext?: {
		title?: string;
		text?: string;
	} | null;
	noteId?: string | null;
	providerOptions?: ProviderOptions;
	recipeSlug?: string | null;
	resolveLocalFolderRoots: (
		localFolders: LocalFolderReference[],
	) => Promise<LocalFolderRoot[]> | LocalFolderRoot[];
	selectedSourceIds?: string[];
	webSearchEnabled?: boolean;
	workspaceId: string;
}) => Promise<{
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	enabledTools: ToolSet;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	localFolderRoots: LocalFolderRoot[];
	selectedAppConnections: AppConnection[];
	systemPrompt: string;
	tools: ToolSet;
}>;
