import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export const DEFAULT_CONTEXT7_MCP_ENDPOINT = "https://mcp.context7.com/mcp";

export const validateContext7McpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "context7",
		displayName: "Context7",
		...connection,
	});

export const buildContext7Tools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		toolPrefix: "context7",
	});
