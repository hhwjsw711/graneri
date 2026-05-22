export type AppSourceProvider =
	| "google-calendar"
	| "google-drive"
	| "jira-mcp"
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

export declare const appSourceLabels: Record<AppSourceProvider, string>;

export declare function buildSelectedAppSourceInstructions(
	connections: AppSourceInstructionConnection[],
): string;
