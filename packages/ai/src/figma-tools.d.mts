export declare const DEFAULT_FIGMA_MCP_ENDPOINT: string;

export type FigmaMcpToolConnection = {
	sourceId: string;
	provider: "figma";
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
};

export type FigmaMcpConnectionInput = {
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
};

export declare const validateFigmaMcpConnection: (
	connection: FigmaMcpConnectionInput,
) => Promise<unknown[]>;

export declare const buildFigmaTools: (
	connection: FigmaMcpToolConnection,
) => Promise<Record<string, unknown>>;
