import {
	AudioLines,
	Calendar,
	ChartNoAxesColumn,
	Database,
	FileImage,
	FileSearch,
	FileText,
	Folder,
	FolderOpen,
	Globe,
	Search,
	Video,
} from "lucide-react";
import type React from "react";
import { toolUiMetadata } from "../../../../../../packages/ai/src/tool-ui-metadata.mjs";

export type ToolMeta = {
	errorTitle?: (part: ToolPartLike) => string;
	groupKey?: string;
	groupLabel?: string;
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
	toolMetadata?: Record<string, unknown>;
	toolCallId?: string;
	toolName?: string;
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
	"audio-lines": AudioLines,
	calendar: Calendar,
	chart: ChartNoAxesColumn,
	database: Database,
	"file-image": FileImage,
	"file-search": FileSearch,
	"file-text": FileText,
	folder: Folder,
	"folder-open": FolderOpen,
	globe: Globe,
	search: Search,
	video: Video,
} satisfies Record<string, React.ComponentType<{ className?: string }>>;

const makeToolMeta = ({
	complete,
	error,
	groupKey,
	icon: iconKey,
	running,
	subtitleKeys,
}: {
	complete: string;
	error?: string;
	groupKey?: string;
	icon: keyof typeof toolIconRegistry;
	running: string;
	subtitleKeys?: string[];
}): ToolMeta => ({
	groupKey,
	icon: toolIconRegistry[iconKey],
	errorTitle: error ? () => error : undefined,
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

const getStaticToolMeta = (part: ToolPartLike) => {
	if (part.type === "dynamic-tool") {
		return null;
	}

	return toolRegistry[part.type] ?? null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const getStringArray = (value: unknown) =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];

function getMetadataToolMeta(part: ToolPartLike): ToolMeta | null {
	const metadata = part.toolMetadata;
	const ui = asRecord(metadata?.ui);

	if (!ui) {
		return null;
	}

	const running = getString(ui.running);
	const complete = getString(ui.complete);
	const error = getString(ui.error);
	const iconKey = getString(ui.icon);

	if (!running || !complete || !(iconKey in toolIconRegistry)) {
		return null;
	}

	const icon = toolIconRegistry[iconKey as keyof typeof toolIconRegistry];
	const subtitleKeys = getStringArray(ui.subtitleKeys);
	const groupKey = getString(ui.groupKey) || undefined;
	const groupLabel = getString(ui.groupLabel) || undefined;

	return {
		groupKey,
		groupLabel,
		icon,
		errorTitle: error ? () => error : undefined,
		title: (currentPart) => (isPending(currentPart) ? running : complete),
		subtitle: (currentPart) => {
			const value = getFirstString(currentPart.input, subtitleKeys);
			return value ? clamp(value) : "";
		},
	};
}

export const getToolMeta = (part: ToolPartLike) =>
	getMetadataToolMeta(part) ?? getStaticToolMeta(part);
