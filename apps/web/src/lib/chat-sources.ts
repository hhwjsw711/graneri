import type { UIMessage } from "ai";
import { remoteMcpToolPrefixes } from "../../../../packages/ai/src/app-source-providers.mjs";

export type ToolSource = {
	href: string;
	title: string;
};

const toDisplayTitle = (url: string, title?: string | null) => {
	if (typeof title === "string" && title.trim()) {
		return title;
	}

	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

const tryParseJson = (value: unknown): unknown => {
	if (typeof value !== "string") {
		return value;
	}

	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
};

const collectToolSources = (message: UIMessage): ToolSource[] => {
	const sources: ToolSource[] = [];
	const isRemoteMcpToolName = (toolName: string) =>
		remoteMcpToolPrefixes.some(({ prefix }) => toolName.startsWith(prefix));

	const addSourcesFromToolOutput = (toolName: string, output: unknown) => {
		if (!output || typeof output !== "object") {
			return;
		}

		if (
			toolName !== "web_search" &&
			toolName !== "yandex_tracker_search" &&
			toolName !== "yandex_tracker_get_issue" &&
			toolName !== "jira_search" &&
			toolName !== "jira_get_issue" &&
			!isRemoteMcpToolName(toolName)
		) {
			return;
		}

		const resultSources =
			"sources" in output
				? (output as { sources?: unknown }).sources
				: undefined;

		if (!Array.isArray(resultSources)) {
			return;
		}

		for (const source of resultSources) {
			if (!source || typeof source !== "object") {
				continue;
			}

			const url =
				"url" in source ? (source as { url?: unknown }).url : undefined;
			const title =
				"title" in source ? (source as { title?: unknown }).title : undefined;

			if (typeof url === "string" && url) {
				sources.push({
					href: url,
					title: toDisplayTitle(url, typeof title === "string" ? title : null),
				});
			}
		}
	};

	for (const part of message.parts) {
		if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") {
			continue;
		}

		const toolName =
			part.type === "dynamic-tool" &&
			"toolName" in part &&
			typeof part.toolName === "string"
				? part.toolName
				: part.type.slice("tool-".length);

		if (
			!("output" in part) ||
			!("state" in part) ||
			part.state !== "output-available"
		) {
			continue;
		}

		addSourcesFromToolOutput(toolName, tryParseJson(part.output));
	}

	const seen = new Set<string>();

	return sources.filter((source) => {
		const key = `${source.href}::${source.title}`;

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
};

export const collectMessageSources = (message: UIMessage): ToolSource[] => {
	const sources: ToolSource[] = [];

	for (const part of message.parts) {
		if (part.type !== "source-url") {
			continue;
		}

		sources.push({
			href: part.url,
			title: toDisplayTitle(part.url, part.title),
		});
	}

	sources.push(...collectToolSources(message));

	const seen = new Set<string>();

	return sources.filter((source) => {
		const key = `${source.href}::${source.title}`;

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
};
