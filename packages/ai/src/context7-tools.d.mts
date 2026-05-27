export declare const DEFAULT_CONTEXT7_MCP_ENDPOINT: string;

export type Context7McpToolConnection = {
	sourceId: string;
	provider: "context7";
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
};

export type Context7McpConnectionInput = {
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
};

export declare const validateContext7McpConnection: (
	connection: Context7McpConnectionInput,
) => Promise<unknown[]>;

export declare const buildContext7Tools: (
	connection: Context7McpToolConnection,
) => Promise<Record<string, unknown>>;
