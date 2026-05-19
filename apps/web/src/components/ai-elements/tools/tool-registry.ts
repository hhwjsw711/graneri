import {
	Calendar,
	Database,
	FileImage,
	FileSearch,
	FileText,
	Folder,
	FolderOpen,
	Globe,
	Search,
} from "lucide-react";
import type React from "react";
import { toolUiMetadata } from "../../../../../../packages/ai/src/tool-ui-metadata.mjs";

export type ToolMeta = {
	groupKey?: string;
	icon: React.ComponentType<{ className?: string }>;
	subtitle?: (part: ToolPartLike) => string;
	title: (part: ToolPartLike) => string;
};

export type ToolPartLike = {
	callProviderMetadata?: { custom?: { startedAt?: unknown } };
	errorText?: string;
	input?: Record<string, unknown>;
	output?: Record<string, unknown>;
	result?: Record<string, unknown>;
	state?: string;
	startedAt?: unknown;
	toolCallId?: string;
	type: string;
};

const isPending = (part: ToolPartLike) =>
	part.state !== "output-available" && part.state !== "output-error";

const getString = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";

const getFirstString = (
	value: Record<string, unknown> | undefined,
	keys: string[],
) => {
	if (!value) {
		return "";
	}

	for (const key of keys) {
		const candidate = getString(value[key]);
		if (candidate) {
			return candidate;
		}
	}

	return "";
};

const clamp = (value: string, maxLength = 54) =>
	value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const toolIconRegistry = {
	calendar: Calendar,
	database: Database,
	"file-image": FileImage,
	"file-search": FileSearch,
	"file-text": FileText,
	folder: Folder,
	"folder-open": FolderOpen,
	globe: Globe,
	search: Search,
} satisfies Record<string, React.ComponentType<{ className?: string }>>;

const makeToolMeta = ({
	complete,
	groupKey,
	icon: iconKey,
	running,
	subtitleKeys,
}: {
	complete: string;
	groupKey?: string;
	icon: keyof typeof toolIconRegistry;
	running: string;
	subtitleKeys?: string[];
}): ToolMeta => ({
	groupKey,
	icon: toolIconRegistry[iconKey],
	title: (part) => (isPending(part) ? running : complete),
	subtitle: subtitleKeys
		? (part) => clamp(getFirstString(part.input, subtitleKeys))
		: undefined,
});

const toolRegistry = Object.fromEntries(
	Object.entries(toolUiMetadata).map(([toolName, metadata]) => [
		`tool-${toolName}`,
		makeToolMeta({
			...metadata,
			icon: metadata.icon as keyof typeof toolIconRegistry,
		}),
	]),
) as Record<string, ToolMeta>;

function getPostHogToolMeta(part: ToolPartLike): ToolMeta | null {
	if (!part.type.startsWith("tool-posthog_")) {
		return null;
	}

	return {
		groupKey: "posthog",
		icon: Database,
		title: () => (isPending(part) ? "Querying PostHog" : "Queried PostHog"),
		subtitle: (currentPart) =>
			clamp(
				getFirstString(currentPart.input, [
					"query",
					"question",
					"insightId",
					"event",
					"name",
				]),
			),
	};
}

export const getToolMeta = (part: ToolPartLike) =>
	toolRegistry[part.type] ?? getPostHogToolMeta(part);
