import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import { getLocalFolderToolApiUrl } from "@/lib/runtime-config";

const localToolNames = new Set([
	"get_shared_local_folders",
	"inspect_local_image",
	"list_local_directory",
	"read_local_file",
	"run_local_bash",
	"search_local_files",
	"search_local_images",
	"transcribe_local_audio",
]);

type LocalToolCall = {
	toolCallId: string;
	toolName: string;
	input: unknown;
};

export const isDesktopLocalToolName = (toolName: string) =>
	localToolNames.has(toolName);

export const isDesktopLocalFolderArray = (
	value: unknown,
): value is DesktopLocalFolder[] =>
	Array.isArray(value) &&
	value.every(
		(folder) =>
			typeof folder?.id === "string" &&
			typeof folder.name === "string" &&
			typeof folder.path === "string",
	);

export const executeDesktopLocalToolCall = async ({
	localFolders,
	toolCall,
}: {
	localFolders: DesktopLocalFolder[];
	toolCall: LocalToolCall;
}) => {
	const apiUrl = getLocalFolderToolApiUrl();

	if (!apiUrl) {
		throw new Error("Desktop local tools are unavailable in this runtime.");
	}

	if (!isDesktopLocalToolName(toolCall.toolName)) {
		throw new Error(`Unsupported local tool: ${toolCall.toolName}.`);
	}

	const response = await fetch(apiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			localFolders,
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
		}),
	});
	const payload = (await response.json().catch(() => ({}))) as {
		error?: string;
		output?: unknown;
	};

	if (!response.ok) {
		throw new Error(payload.error || "Local tool execution failed.");
	}

	return payload.output;
};
