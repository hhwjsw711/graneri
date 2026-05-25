import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { ShimmerText } from "@/components/ai-elements/shimmer";

export function Reasoning({
	className,
	isStreaming,
	text,
}: {
	className?: string;
	isStreaming: boolean;
	text: string;
}) {
	const trimmedText = text.trim();

	if (!trimmedText && !isStreaming) {
		return null;
	}

	return (
		<Collapsible className={cn("group/reasoning w-full", className)}>
			<CollapsibleTrigger
				className="flex max-w-full cursor-pointer items-center gap-1 rounded-[var(--an-tool-border-radius)] text-sm"
				data-preserve-scroll-on-toggle
			>
				<span className="font-[450] text-foreground/70">
					{isStreaming ? (
						<ShimmerText
							as="span"
							duration={1.2}
							className="m-0 inline-flex h-4 items-center leading-none"
						>
							Thinking
						</ShimmerText>
					) : (
						"Thought"
					)}
				</span>
				<ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 ease-out group-hover/reasoning:opacity-100 group-focus-visible/reasoning:opacity-100 group-data-[state=open]/reasoning:rotate-90" />
			</CollapsibleTrigger>
			{trimmedText ? (
				<CollapsibleContent className="mt-2 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-1">
					<div className="max-h-[175px] overflow-y-auto">
						<p className="whitespace-pre-wrap text-sm text-muted-foreground">
							{trimmedText}
						</p>
					</div>
				</CollapsibleContent>
			) : null}
		</Collapsible>
	);
}
