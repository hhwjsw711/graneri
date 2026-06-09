import { buildLocalFolderTools } from "../../../packages/ai/src/local-folder-tools.mjs";
import { readJsonBody, sendJson } from "./local-server-http.mjs";

const getLocalFolderIds = (localFolders) =>
	Array.isArray(localFolders)
		? localFolders
				.map((folder) => folder?.id)
				.filter((id) => typeof id === "string" && id.length > 0)
		: [];

export const createLocalFolderToolRouteHandler =
	({ getSharedLocalFolders }) =>
	async (request, response) => {
		const {
			input,
			localFolders = [],
			toolCallId,
			toolName,
		} = await readJsonBody(request);

		if (typeof toolName !== "string" || !toolName) {
			sendJson(response, 400, { error: "toolName is required." });
			return;
		}

		if (typeof toolCallId !== "string" || !toolCallId) {
			sendJson(response, 400, { error: "toolCallId is required." });
			return;
		}

		const localFolderRoots =
			typeof getSharedLocalFolders === "function"
				? getSharedLocalFolders(getLocalFolderIds(localFolders))
				: [];

		if (localFolderRoots.length === 0) {
			sendJson(response, 400, {
				error: "No shared local folders are available for this tool call.",
			});
			return;
		}

		const toolToExecute = buildLocalFolderTools(localFolderRoots)[toolName];

		if (!toolToExecute?.execute) {
			sendJson(response, 400, { error: `Unknown local tool: ${toolName}.` });
			return;
		}

		const output = await toolToExecute.execute(input ?? {}, {
			messages: [],
			toolCallId,
		});
		sendJson(response, 200, { output });
	};
