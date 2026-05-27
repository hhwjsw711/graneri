import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export const DEFAULT_LINEAR_MCP_ENDPOINT = "https://mcp.linear.app/mcp";

export const validateLinearMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "linear",
		displayName: "Linear",
		...connection,
	});

export const buildLinearTools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		toolPrefix: "linear",
	});
