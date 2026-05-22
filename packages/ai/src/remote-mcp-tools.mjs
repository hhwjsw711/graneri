import { createMCPClient } from "@ai-sdk/mcp";

const withRemoteMcpClient = async (connection, callback) => {
	const headers = {};

	for (const [key, value] of Object.entries(connection.env ?? {})) {
		if (key && value) {
			headers[key] = value;
		}
	}

	if (connection.oauthAccessToken) {
		headers.Authorization = `Bearer ${connection.oauthAccessToken}`;
	}

	if (connection.includeOAuthClientIdHeader && connection.oauthClientId) {
		headers["X-Client-ID"] = connection.oauthClientId;
	}

	const client = await createMCPClient({
		transport: {
			type: "http",
			url: connection.baseUrl,
			...(Object.keys(headers).length > 0 ? { headers } : {}),
			redirect: "error",
		},
		clientName: "opengran",
		version: "0.0.1",
	});

	try {
		return await callback(client);
	} finally {
		await client.close();
	}
};

const normalizeToolName = (provider, toolName) =>
	`${provider}_${toolName
		.trim()
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")}`;

const makeUniqueToolName = (provider, toolName, tools) => {
	const normalizedName = normalizeToolName(provider, toolName);
	const baseName = normalizedName || `${provider}_tool`;
	let candidateName = baseName;
	let suffix = 2;

	while (candidateName in tools) {
		candidateName = `${baseName}_${suffix}`;
		suffix += 1;
	}

	return candidateName;
};

const REMOTE_MCP_SUBTITLE_KEYS = [
	"query",
	"question",
	"q",
	"search",
	"jql",
	"issueKey",
	"key",
	"url",
	"id",
	"name",
	"title",
];

const getRemoteMcpToolUiMetadata = (connection) => ({
	groupKey: `mcp:${connection.provider}`,
	groupLabel: connection.displayName,
	icon: "database",
	running: `Using ${connection.displayName}`,
	complete: `Used ${connection.displayName}`,
	subtitleKeys: REMOTE_MCP_SUBTITLE_KEYS,
});

const executeRemoteMcpTool = async (connection, definition, args, options) =>
	await withRemoteMcpClient(connection, async (client) => {
		const tools = client.toolsFromDefinitions({ tools: [definition] });
		const tool = tools[definition.name];

		if (!tool?.execute) {
			throw new Error(
				`${connection.displayName} MCP tool "${definition.name}" is unavailable.`,
			);
		}

		return await tool.execute(args, options);
	});

export const validateRemoteMcpConnection = async (connection) =>
	await withRemoteMcpClient(connection, async (client) => {
		const result = await client.listTools();
		return Array.isArray(result?.tools) ? result.tools : [];
	});

export const buildRemoteMcpTools = async (connection) =>
	await withRemoteMcpClient(connection, async (client) => {
		const definitions = await client.listTools();
		const discoveredTools = client.toolsFromDefinitions(definitions);
		const tools = {};

		for (const definition of definitions.tools) {
			const discoveredTool = discoveredTools[definition.name];

			if (!discoveredTool) {
				continue;
			}

			const toolName = makeUniqueToolName(
				connection.toolPrefix ?? connection.provider,
				definition.name,
				tools,
			);

			tools[toolName] = {
				...discoveredTool,
				description: discoveredTool.description ?? definition.description,
				metadata: {
					...(discoveredTool.metadata ?? {}),
					provider: connection.provider,
					source: "mcp",
					mcpToolName: definition.name,
					ui: getRemoteMcpToolUiMetadata(connection),
				},
				providerOptions: {
					...(discoveredTool.providerOptions ?? {}),
					openai: {
						...(discoveredTool.providerOptions?.openai ?? {}),
						deferLoading: true,
					},
				},
				execute: async (args, options) =>
					await executeRemoteMcpTool(connection, definition, args, options),
			};
		}

		return tools;
	});
