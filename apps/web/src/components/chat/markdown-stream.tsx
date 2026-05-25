import { cn } from "@workspace/ui/lib/utils";
import { Streamdown, type StreamdownProps } from "streamdown";

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

export type MarkdownStreamProps = Omit<
	StreamdownProps,
	"children" | "plugins" | "shikiTheme"
> & {
	children: string;
};

export function MarkdownStream({
	children,
	className,
	controls = false,
	caret = "block",
	linkSafety = { enabled: false },
	mode,
	...props
}: MarkdownStreamProps) {
	return (
		<Streamdown
			className={cn("wrap-break-word", className)}
			controls={controls}
			caret={caret}
			linkSafety={linkSafety}
			mode={mode}
			{...props}
		>
			{normalizeMarkdownForStreamdown(children)}
		</Streamdown>
	);
}
