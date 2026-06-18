import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";
import { Streamdown, type StreamdownProps } from "streamdown";
import { parseMarkdownIntoStableBlocks } from "@/lib/markdown-stable-blocks";

const fixNumberedListBreaks = (text: string) =>
	text.replace(/^(\d+)\.\s*\n+\s*\n*/gm, "$1. ");

const normalizeCodeFenceLanguages = (text: string) =>
	text.replace(/```([^\n]*)/g, (_match, languageRaw) => {
		const language = String(languageRaw || "")
			.trim()
			.toLowerCase();

		if (!language) {
			return "```";
		}

		const normalizedLanguage = language.split(/\s+/)[0];
		return `\`\`\`${normalizedLanguage}`;
	});

const normalizeMarkdownForStreamdown = (content: string) =>
	normalizeCodeFenceLanguages(fixNumberedListBreaks(content));

const aiRenderedLinkSafety = { enabled: false } as const;

export type MarkdownStreamProps = Omit<
	StreamdownProps,
	"caret" | "children" | "linkSafety" | "plugins" | "shikiTheme"
> & {
	children: string;
};

export function MarkdownStream({
	children,
	className,
	controls = false,
	mode,
	parseMarkdownIntoBlocksFn = parseMarkdownIntoStableBlocks,
	...props
}: MarkdownStreamProps) {
	const normalizedMarkdown = React.useMemo(
		() => normalizeMarkdownForStreamdown(children),
		[children],
	);

	return (
		<Streamdown
			className={cn("wrap-break-word", className)}
			controls={controls}
			linkSafety={aiRenderedLinkSafety}
			mode={mode}
			parseMarkdownIntoBlocksFn={parseMarkdownIntoBlocksFn}
			{...props}
		>
			{normalizedMarkdown}
		</Streamdown>
	);
}
