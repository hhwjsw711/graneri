import { GeneratedArtifactToolPreview } from "@/components/ai-elements/tools/generated-artifact-tool-preview";
import { hasCustomToolPreview } from "@/components/ai-elements/tools/tool-preview-policy";
import type { ToolPartLike } from "@/components/ai-elements/tools/tool-registry";

export function ToolPreview({
	isError,
	toolPart,
}: {
	isError: boolean;
	toolPart: ToolPartLike;
}) {
	if (!hasCustomToolPreview({ isError, toolPart })) {
		return null;
	}

	return <GeneratedArtifactToolPreview output={toolPart.output} />;
}
