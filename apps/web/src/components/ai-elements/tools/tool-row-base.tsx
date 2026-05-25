import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ShimmerText } from "@/components/ai-elements/shimmer";

export type ToolRowBaseProps = {
	children?: ReactNode;
	completeLabel: string;
	defaultOpen?: boolean;
	detail?: string;
	expandable?: boolean;
	expanded?: boolean;
	hideChevronUntilHover?: boolean;
	icon?: ReactNode;
	isAnimating: boolean;
	onToggleExpand?: () => void;
	shimmerLabel?: string;
	trailingContent?: ReactNode;
};

export function ToolRowBase({
	children,
	completeLabel,
	defaultOpen = false,
	detail,
	expandable = false,
	expanded,
	hideChevronUntilHover = false,
	icon,
	isAnimating,
	onToggleExpand,
	shimmerLabel,
	trailingContent,
}: ToolRowBaseProps) {
	const isComplete = !isAnimating;
	const isExpanded = expanded ?? false;
	const canToggle = expandable && (isComplete || isExpanded || isAnimating);

	const row = (
		<div
			className={cn(
				"flex max-w-full select-none items-center gap-1 rounded-[var(--an-tool-border-radius)]",
				canToggle ? "cursor-pointer" : "cursor-default",
			)}
		>
			<div className="flex min-w-0 items-center gap-2 text-sm">
				{icon ? (
					<span className="flex size-3 shrink-0 items-center justify-center">
						{icon}
					</span>
				) : null}
				<span className="shrink-0 whitespace-nowrap font-[450] text-foreground/70">
					{isAnimating && shimmerLabel ? (
						<ShimmerText
							as="span"
							duration={1.2}
							className="m-0 inline-flex h-4 items-center leading-none"
						>
							{shimmerLabel}
						</ShimmerText>
					) : (
						completeLabel
					)}
				</span>
				{detail ? (
					<span className="min-w-0 flex-1 truncate font-normal text-muted-foreground/70">
						{detail}
					</span>
				) : null}
				{trailingContent}
			</div>
			{expandable && (isComplete || isExpanded || isAnimating) ? (
				<ChevronRight
					className={cn(
						"size-3 shrink-0 text-muted-foreground transition-all duration-150 ease-out group-data-[state=open]/tool-row:rotate-90",
						hideChevronUntilHover &&
							"opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
					)}
				/>
			) : null}
		</div>
	);

	if (!expandable) {
		return <div className="flex flex-col gap-1">{row}</div>;
	}

	return (
		<Collapsible
			className="group/tool-row flex w-full flex-col gap-2"
			defaultOpen={expanded === undefined ? defaultOpen : undefined}
			open={expanded}
			onOpenChange={onToggleExpand}
		>
			<CollapsibleTrigger
				className="group flex"
				disabled={!canToggle}
				aria-disabled={!canToggle}
				data-preserve-scroll-on-toggle
			>
				{row}
			</CollapsibleTrigger>
			<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
