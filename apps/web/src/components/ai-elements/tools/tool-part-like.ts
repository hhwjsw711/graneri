import type { UIMessage } from "ai";
import type { ToolPartLike } from "@/components/ai-elements/tools/tool-registry";
import { normalizeToolPart } from "@/components/ai-elements/utils/tool-part-normalizer";

export const toToolPartLike = (
	part: UIMessage["parts"][number],
): ToolPartLike => {
	const normalized = normalizeToolPart(part) as {
		input?: unknown;
		output?: unknown;
		result?: unknown;
		state?: string;
		toolMetadata?: unknown;
		toolCallId?: string;
		toolName?: string;
		type: string;
	};

	return {
		...normalized,
		input:
			normalized.input &&
			typeof normalized.input === "object" &&
			!Array.isArray(normalized.input)
				? (normalized.input as Record<string, unknown>)
				: undefined,
		output:
			normalized.output &&
			typeof normalized.output === "object" &&
			!Array.isArray(normalized.output)
				? (normalized.output as Record<string, unknown>)
				: undefined,
		result:
			normalized.result &&
			typeof normalized.result === "object" &&
			!Array.isArray(normalized.result)
				? (normalized.result as Record<string, unknown>)
				: undefined,
		toolMetadata:
			normalized.toolMetadata &&
			typeof normalized.toolMetadata === "object" &&
			!Array.isArray(normalized.toolMetadata)
				? (normalized.toolMetadata as Record<string, unknown>)
				: undefined,
	};
};
