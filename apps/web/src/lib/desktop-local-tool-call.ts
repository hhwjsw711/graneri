import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type {
	ChatAddToolOutputFunction,
	ChatOnToolCallCallback,
	UIMessage,
} from "ai";
import type { RefObject } from "react";
import { logError } from "@/lib/logger";
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

type LocalToolRequestOptions =
	| {
			body: Record<string, unknown>;
	  }
	| undefined;

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

const submitDesktopLocalToolCall = async ({
	addToolOutputRef,
	requestBody,
	requestOptions,
	toolCall,
}: {
	addToolOutputRef: RefObject<ChatAddToolOutputFunction<UIMessage> | null>;
	requestBody: Record<string, unknown> | null;
	requestOptions: LocalToolRequestOptions;
	toolCall: LocalToolCall;
}) => {
	try {
		const output = await executeDesktopLocalToolCall({
			localFolders: getRequestLocalFolders(requestBody),
			toolCall,
		});
		addToolOutputRef.current?.({
			options: requestOptions,
			output,
			tool: toolCall.toolName,
			toolCallId: toolCall.toolCallId,
		});
	} catch (toolError) {
		const errorText = getErrorMessage(
			toolError,
			"Local tool execution failed.",
		);
		logError({
			event: "client.error",
			error: {
				error: errorText,
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
			},
			message: "[desktop-local-tool] failed",
		});
		addToolOutputRef.current?.({
			errorText,
			options: requestOptions,
			state: "output-error",
			tool: toolCall.toolName,
			toolCallId: toolCall.toolCallId,
		});
	}
};

export const createDesktopLocalToolCallHandler =
	({
		addToolOutputRef,
		latestRequestBodyRef,
	}: {
		addToolOutputRef: RefObject<ChatAddToolOutputFunction<UIMessage> | null>;
		latestRequestBodyRef: RefObject<Record<string, unknown> | null>;
	}): ChatOnToolCallCallback<UIMessage> =>
	({ toolCall }) => {
		if (toolCall.dynamic) {
			return;
		}

		const toolName = toolCall.toolName;
		if (!isDesktopLocalToolName(toolName)) {
			return;
		}

		const requestBody = latestRequestBodyRef.current;
		const requestOptions = requestBody ? { body: requestBody } : undefined;
		void submitDesktopLocalToolCall({
			addToolOutputRef,
			requestBody,
			requestOptions,
			toolCall: {
				input: toolCall.input,
				toolCallId: toolCall.toolCallId,
				toolName,
			},
		});
	};
