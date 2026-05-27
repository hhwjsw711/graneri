export type AppSourceProvider =
	| "context7"
	| "figma"
	| "google-calendar"
	| "google-drive"
	| "jira-mcp"
	| "linear"
	| "notion"
	| "posthog"
	| "yandex-calendar"
	| "yandex-tracker"
	| "zoom";

export type AppSourceInstructionConnection = {
	id?: string;
	sourceId?: string;
	title?: string;
	displayName?: string;
	provider: AppSourceProvider | string;
};

export declare const appSourceProviders: readonly AppSourceProvider[];

export declare const automationAppSourceProviders: readonly AppSourceProvider[];
export declare const APP_SOURCE_PREFIX: "app:";

export declare const appSourceLabels: Record<AppSourceProvider, string>;

export declare const remoteMcpToolPrefixes: readonly {
	prefix: string;
	provider: AppSourceProvider;
	label: string;
}[];

export declare function getSelectedAppSourceIds(
	selectedSourceIds?: string[],
): string[];

export declare function getSelectedNoteSourceIds(args: {
	mentions?: string[];
}): string[];

export declare function buildSelectedAppSourceInstructions(
	connections: AppSourceInstructionConnection[],
): string;
