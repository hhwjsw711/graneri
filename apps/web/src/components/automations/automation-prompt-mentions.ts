import type { JSONContent } from "@tiptap/core";
import type { AutomationDraft } from "@/components/automations/automation-types";
import type { AppSource } from "@/hooks/use-app-sources";
import {
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type AutomationNoteSource = {
	id: Id<"notes">;
	title: string;
	preview: string;
};

export type NoteMentionRange = {
	from: number;
	to: number;
};

export type AutomationPromptMention = {
	id: string;
	label: string;
	from: number;
	to: number;
	type: "note" | "tool";
	provider?: ChatAppSourceProvider;
};

export const filterAutomationNotes = (
	sources: AutomationNoteSource[],
	query: string,
): AutomationNoteSource[] => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	return sources.filter((source) =>
		[source.title, source.preview]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

export const filterAutomationTools = (sources: AppSource[], query: string) => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return sources;
	}

	return sources.filter((source) =>
		[source.title, source.preview, getAppSourceLabel(source.provider)]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

export const getPromptMentionsFromContent = (
	content: JSONContent,
): AutomationPromptMention[] => {
	const mentions: AutomationPromptMention[] = [];
	let textOffset = 0;
	const walk = (node: JSONContent) => {
		if (node.type === "mention" && typeof node.attrs?.id === "string") {
			const mentionId = node.attrs.id;
			const label =
				typeof node.attrs.label === "string" ? node.attrs.label : mentionId;
			const text = `@${label}`;
			mentions.push({
				id: mentionId,
				label,
				from: textOffset,
				to: textOffset + text.length,
				type:
					node.attrs.type === "tool" || mentionId.startsWith("app:")
						? "tool"
						: "note",
				provider:
					typeof node.attrs.provider === "string"
						? (node.attrs.provider as ChatAppSourceProvider)
						: undefined,
			});
			textOffset += text.length;
			return;
		}

		if (typeof node.text === "string") {
			textOffset += node.text.length;
			return;
		}

		for (const child of node.content ?? []) {
			walk(child);
		}
	};

	walk(content);
	return mentions;
};

export const areAutomationPromptMentionsEqual = (
	left: AutomationPromptMention[],
	right: AutomationPromptMention[],
) =>
	left.length === right.length &&
	left.every((leftMention, index) => {
		const rightMention = right[index];
		return (
			rightMention &&
			leftMention.id === rightMention.id &&
			leftMention.label === rightMention.label &&
			leftMention.from === rightMention.from &&
			leftMention.to === rightMention.to &&
			leftMention.type === rightMention.type &&
			leftMention.provider === rightMention.provider
		);
	});

export const getPromptDocument = (
	prompt: string,
	mentions: AutomationPromptMention[] = [],
): JSONContent => {
	if (!prompt) {
		return {
			type: "doc",
			content: [{ type: "paragraph" }],
		};
	}

	const sortedMentions = [...mentions]
		.filter(
			(mention) =>
				mention.from >= 0 &&
				mention.to > mention.from &&
				mention.to <= prompt.length &&
				prompt.slice(mention.from, mention.to) === `@${mention.label}`,
		)
		.sort((a, b) => a.from - b.from);
	const content: JSONContent[] = [];
	let cursor = 0;

	for (const mention of sortedMentions) {
		if (mention.from < cursor) {
			continue;
		}

		if (mention.from > cursor) {
			content.push({ type: "text", text: prompt.slice(cursor, mention.from) });
		}

		content.push({
			type: "mention",
			attrs: {
				id: mention.id,
				label: mention.label,
				type: mention.type,
				provider: mention.provider,
			},
		});
		cursor = mention.to;
	}

	if (cursor < prompt.length) {
		content.push({ type: "text", text: prompt.slice(cursor) });
	}

	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content:
					content.length > 0 ? content : [{ type: "text", text: prompt }],
			},
		],
	};
};

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findMentionRange = ({
	label,
	occupiedRanges,
	prompt,
}: {
	label: string;
	occupiedRanges: Array<Pick<AutomationPromptMention, "from" | "to">>;
	prompt: string;
}) => {
	const mentionText = `@${label}`;
	const mentionRegex = new RegExp(escapeRegExp(mentionText), "g");

	for (const match of prompt.matchAll(mentionRegex)) {
		const index = match.index;
		const end = index + mentionText.length;
		const overlaps = occupiedRanges.some(
			(range) => index < range.to && end > range.from,
		);
		if (!overlaps) {
			return {
				from: index,
				to: end,
			};
		}
	}

	return null;
};

export const getInitialAutomationMentions = ({
	automation,
}: {
	automation: AutomationDraft;
}) => {
	const mentions: AutomationPromptMention[] = [];

	for (const source of automation.appSources ?? []) {
		const label = getAppSourceLabel(source.provider);
		const range = findMentionRange({
			label,
			occupiedRanges: mentions,
			prompt: automation.prompt,
		});

		if (!range) {
			continue;
		}

		mentions.push({
			id: source.id,
			label,
			type: "tool",
			provider: source.provider,
			...range,
		});
	}

	if (automation.target.kind === "notes") {
		for (const noteId of automation.target.noteIds) {
			const label = automation.target.label;
			const range = findMentionRange({
				label,
				occupiedRanges: mentions,
				prompt: automation.prompt,
			});

			if (!range) {
				continue;
			}

			mentions.push({
				id: noteId,
				label,
				type: "note",
				...range,
			});
		}
	}

	return mentions.sort((a, b) => a.from - b.from);
};
