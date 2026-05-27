import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export const DEFAULT_FIGMA_MCP_ENDPOINT = "https://mcp.figma.com/mcp";

export const validateFigmaMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "figma",
		displayName: "Figma",
		...connection,
	});

export const buildFigmaTools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		toolPrefix: "figma",
	});
