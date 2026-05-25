import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { useState } from "react";
import { MarkdownStream } from "@/components/chat/markdown-stream";

const COLLAPSIBLE_MESSAGE_CHARACTER_THRESHOLD = 900;
const COLLAPSIBLE_MESSAGE_LINE_THRESHOLD = 12;

const estimateRenderedLineCount = (text: string) =>
	text.split(/\r?\n/).reduce((lineCount, line) => {
		const normalizedLine = line.trim();

		if (normalizedLine.length === 0) {
			return lineCount + 1;
		}

		return lineCount + Math.max(1, Math.ceil(normalizedLine.length / 90));
	}, 0);

const shouldCollapseMessage = (text: string) => {
	const normalizedText = text.trim();

	if (normalizedText.length === 0) {
		return false;
	}

	return (
		normalizedText.length >= COLLAPSIBLE_MESSAGE_CHARACTER_THRESHOLD ||
		estimateRenderedLineCount(normalizedText) >=
			COLLAPSIBLE_MESSAGE_LINE_THRESHOLD
	);
};

export function CollapsibleMessageContent({
	role,
	text,
	isAnimating,
	streamdownClassName,
	mode,
}: {
	role: UIMessage["role"];
	text: string;
	isAnimating: boolean;
	streamdownClassName?: string;
	mode?: "streaming" | "static";
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const isCollapsible = role === "user" && shouldCollapseMessage(text);
	const resolvedMode = mode ?? (isAnimating ? "streaming" : "static");

	if (!isCollapsible) {
		return (
			<MarkdownStream
				className={streamdownClassName}
				isAnimating={isAnimating}
				mode={resolvedMode}
			>
				{text}
			</MarkdownStream>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div
				className={cn(
					"overflow-hidden transition-[max-height] duration-200 ease-out",
					isExpanded ? "max-h-[999rem]" : "max-h-80",
				)}
			>
				<MarkdownStream
					className={streamdownClassName}
					isAnimating={isAnimating}
					mode={resolvedMode}
				>
					{text}
				</MarkdownStream>
			</div>
			<div className="flex justify-end">
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="h-auto p-0 text-secondary-foreground/55 hover:bg-transparent hover:text-secondary-foreground aria-expanded:bg-transparent aria-expanded:text-secondary-foreground/55 aria-expanded:hover:text-secondary-foreground"
					aria-expanded={isExpanded}
					data-preserve-scroll-on-toggle
					onClick={() => setIsExpanded((current) => !current)}
				>
					{isExpanded ? "Show less" : "Show more"}
				</Button>
			</div>
		</div>
	);
}
