import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import * as React from "react";

export const SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME =
	"opacity-0 pointer-events-none transition-opacity group-hover/header:opacity-100 group-hover/header:pointer-events-auto group-focus-within/header:opacity-100 group-focus-within/header:pointer-events-auto";
export const SIDEBAR_COLLAPSIBLE_GROUP_ACTION_OPEN_CLASS_NAME =
	"!pointer-events-auto !opacity-100";

export function SidebarCollapsibleGroup({
	children,
	className,
	contentClassName,
	defaultOpen = true,
	labelClassName,
	title,
	actions,
	actionClassName,
	actionTooltip,
}: {
	children: React.ReactNode;
	className?: string;
	contentClassName?: string;
	defaultOpen?: boolean;
	labelClassName?: string;
	title: string;
	actions?: React.ReactNode;
	actionClassName?: string;
	actionTooltip?: string;
}) {
	const contentId = React.useId();
	const action = actions ? (
		<SidebarGroupAction asChild className={actionClassName}>
			{actions}
		</SidebarGroupAction>
	) : null;

	return (
		<Collapsible defaultOpen={defaultOpen} className="group/collapsible">
			<SidebarGroup className={className}>
				<div className="group/header">
					<SidebarGroupLabel asChild>
						<CollapsibleTrigger
							aria-controls={contentId}
							className={cn(
								"group/label w-full cursor-pointer justify-start gap-1.5 px-2 text-sidebar-foreground/60 [&>svg]:!size-3",
								labelClassName,
							)}
						>
							<span>{title}</span>
							<ChevronRight
								className={cn(
									"mt-px shrink-0 opacity-0 transition-[opacity,transform] group-hover/label:opacity-100 group-focus-visible/label:opacity-100",
									"group-data-[state=open]/collapsible:rotate-90",
								)}
							/>
						</CollapsibleTrigger>
					</SidebarGroupLabel>
					{actionTooltip && action ? (
						<Tooltip>
							<TooltipTrigger asChild>{action}</TooltipTrigger>
							<TooltipContent side="bottom" align="center" sideOffset={8}>
								{actionTooltip}
							</TooltipContent>
						</Tooltip>
					) : (
						action
					)}
				</div>
				<CollapsibleContent id={contentId}>
					<SidebarGroupContent className={contentClassName}>
						{children}
					</SidebarGroupContent>
				</CollapsibleContent>
			</SidebarGroup>
		</Collapsible>
	);
}
