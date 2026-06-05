import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type {
	ChatAddToolOutputFunction,
	ChatOnToolCallCallback,
	UIMessage,
} from "ai";
import type { RefObject } from "react";
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

const isDesktopLocalToolName = (toolName: string) =>
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

const getRequestLocalFolders = (
	requestBody: Record<string, unknown> | null,
) => {
	if (!requestBody) {
		throw new Error(
			"Desktop local tool request is missing chat request context.",
		);
	}

	if (!isDesktopLocalFolderArray(requestBody.localFolders)) {
		throw new Error(
			"Desktop local tool request is missing shared local folders.",
		);
	}

	return requestBody.localFolders;
};

const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

const executeDesktopLocalToolCall = async ({
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

	console.info("[desktop-local-tool] request", {
		folderCount: localFolders.length,
		toolCallId: toolCall.toolCallId,
		toolName: toolCall.toolName,
	});

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

	console.info("[desktop-local-tool] response", {
		ok: response.ok,
		outputKeys:
			payload.output && typeof payload.output === "object"
				? Object.keys(payload.output)
				: [],
		payloadKeys: Object.keys(payload),
		status: response.status,
		toolCallId: toolCall.toolCallId,
		toolName: toolCall.toolName,
	});

	if (!response.ok) {
		throw new Error(payload.error || "Local tool execution failed.");
	}

	return payload.output;
};

export const createDesktopLocalToolCallHandler =
	({
		addToolOutputRef,
		latestRequestBodyRef,
	}: {
		addToolOutputRef: RefObject<ChatAddToolOutputFunction<UIMessage> | null>;
		latestRequestBodyRef: RefObject<Record<string, unknown> | null>;
	}): ChatOnToolCallCallback<UIMessage> =>
	async ({ toolCall }) => {
		if (toolCall.dynamic) {
			return;
		}

		const toolName = toolCall.toolName;
		if (!isDesktopLocalToolName(toolName)) {
			return;
		}

		const requestOptions = latestRequestBodyRef.current
			? { body: latestRequestBodyRef.current }
			: undefined;

		try {
			const localFolders = getRequestLocalFolders(latestRequestBodyRef.current);
			console.info("[desktop-local-tool] execute", {
				folderCount: localFolders.length,
				toolCallId: toolCall.toolCallId,
				toolName,
			});
			const output = await executeDesktopLocalToolCall({
				localFolders,
				toolCall: {
					input: toolCall.input,
					toolCallId: toolCall.toolCallId,
					toolName,
				},
			});
			addToolOutputRef.current?.({
				options: requestOptions,
				output,
				tool: toolName,
				toolCallId: toolCall.toolCallId,
			});
		} catch (toolError) {
			console.error("[desktop-local-tool] failed", {
				error: getErrorMessage(toolError, "Local tool execution failed."),
				toolCallId: toolCall.toolCallId,
				toolName,
			});
			addToolOutputRef.current?.({
				errorText: getErrorMessage(toolError, "Local tool execution failed."),
				options: requestOptions,
				state: "output-error",
				tool: toolName,
				toolCallId: toolCall.toolCallId,
			});
		}
	};
