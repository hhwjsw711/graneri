export declare const DEFAULT_LINEAR_MCP_ENDPOINT: string;

export type LinearMcpToolConnection = {
	sourceId: string;
	provider: "linear";
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
	oauthClientId?: string;
	oauthAccessToken: string;
};

export type LinearMcpConnectionInput = {
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
	oauthClientId?: string;
	oauthAccessToken?: string;
};

export declare const validateLinearMcpConnection: (
	connection: LinearMcpConnectionInput,
) => Promise<unknown[]>;

export declare const buildLinearTools: (
	connection: LinearMcpToolConnection,
) => Promise<Record<string, unknown>>;
