import type { ToolPartLike } from "@/components/ai-elements/tools/tool-registry";
import { parseGeneratedArtifact } from "@/lib/chat-message";

export const hasCustomToolPreview = ({
	isError,
	toolPart,
}: {
	isError: boolean;
	toolPart: ToolPartLike;
}) =>
	!isError &&
	toolPart.type === "tool-generate_image" &&
	Boolean(parseGeneratedArtifact(toolPart.output));
