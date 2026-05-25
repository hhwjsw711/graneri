"use client";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { BookIcon, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";

export const Sources = ({
	className,
	...props
}: ComponentProps<typeof Collapsible>) => (
	<Collapsible
		className={cn("group/sources flex w-full flex-col gap-2", className)}
		{...props}
	/>
);

export const SourcesTrigger = ({
	className,
	count,
	children,
	...props
}: ComponentProps<typeof CollapsibleTrigger> & {
	count: number;
}) => (
	<CollapsibleTrigger
		className={cn(
			"group flex max-w-full cursor-pointer items-center gap-1 rounded-[var(--an-tool-border-radius)] text-sm",
			className,
		)}
		data-preserve-scroll-on-toggle
		{...props}
	>
		{children ?? (
			<>
				<span className="shrink-0 whitespace-nowrap font-[450] text-foreground/70">
					{count} sources
				</span>
				<ChevronRight className="size-3 shrink-0 text-muted-foreground transition-all duration-150 ease-out group-data-[state=open]/sources:rotate-90" />
			</>
		)}
	</CollapsibleTrigger>
);

export const SourcesContent = ({
	className,
	...props
}: ComponentProps<typeof CollapsibleContent>) => (
	<CollapsibleContent
		className={cn(
			"flex w-fit flex-col gap-1.5 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
			className,
		)}
		{...props}
	/>
);

export const Source = ({
	href,
	title,
	children,
	...props
}: ComponentProps<"a">) => (
	<a
		className="flex max-w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground/70 transition-colors hover:text-foreground"
		href={href}
		rel="noreferrer"
		target="_blank"
		{...props}
	>
		{children ?? (
			<>
				<BookIcon className="size-3 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate font-[450] text-foreground/70">
					{title}
				</span>
			</>
		)}
	</a>
);
