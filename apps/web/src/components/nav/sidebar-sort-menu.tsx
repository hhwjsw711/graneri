import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
	ArrowUpAZ,
	Check,
	Clock3,
	MoreHorizontal,
	PlusCircle,
} from "lucide-react";
import type * as React from "react";

export const SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME =
	"aspect-auto w-auto gap-0.5 rounded-xl bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent data-[state=open]:bg-transparent [&>div]:flex [&>div]:items-center [&>div]:gap-0.5 [&_button]:flex [&_button]:size-5 [&_button]:cursor-pointer [&_button]:items-center [&_button]:justify-center [&_button]:rounded-md [&_button]:p-0 [&_button]:text-sidebar-foreground/55 [&_button]:outline-hidden [&_button]:transition-colors [&_button:hover]:bg-sidebar-accent [&_button:hover]:text-sidebar-accent-foreground [&_button[data-state=open]]:bg-sidebar-accent [&_button[data-state=open]]:text-sidebar-accent-foreground [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-sidebar-ring [&_button>svg]:size-4 [&_button>svg]:shrink-0";

export const SIDEBAR_SORT_MENU_CONTENT_CLASS_NAME =
	"w-56 overflow-hidden rounded-lg p-1";

export type SidebarSortOption<TValue extends string> = {
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
	label: string;
	selected: boolean;
	value: TValue;
};

export type SidebarSortValue = "name" | "created" | "updated";

const SIDEBAR_SORT_OPTION_DEFINITIONS: Array<
	Omit<SidebarSortOption<SidebarSortValue>, "selected">
> = [
	{
		icon: ArrowUpAZ,
		label: "Name",
		value: "name",
	},
	{
		icon: PlusCircle,
		label: "Created",
		value: "created",
	},
	{
		icon: Clock3,
		label: "Updated",
		value: "updated",
	},
];

export function getSidebarSortOptions(
	selectedValue: SidebarSortValue,
): Array<SidebarSortOption<SidebarSortValue>> {
	return SIDEBAR_SORT_OPTION_DEFINITIONS.map((option) => ({
		...option,
		selected: option.value === selectedValue,
	}));
}

export function SidebarSortMenu<TValue extends string>({
	label,
	open,
	options,
	onOpenChange,
	onSortChange,
}: {
	label: string;
	open: boolean;
	options: Array<SidebarSortOption<TValue>>;
	onOpenChange: (open: boolean) => void;
	onSortChange: (value: TValue) => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={label}
							className={cn(
								"text-sidebar-foreground/55 hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground",
								open && "!bg-sidebar-accent !text-sidebar-accent-foreground",
							)}
						>
							<MoreHorizontal />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					align="center"
					sideOffset={8}
					className="pointer-events-none select-none"
				>
					{label}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align="start"
				side="right"
				sideOffset={6}
				className={SIDEBAR_SORT_MENU_CONTENT_CLASS_NAME}
			>
				{options.map((option) => (
					<SidebarSortMenuItem
						key={option.value}
						option={option}
						onSortChange={onSortChange}
					/>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function SidebarSortMenuItem<TValue extends string>({
	option,
	onSortChange,
}: {
	option: SidebarSortOption<TValue>;
	onSortChange: (value: TValue) => void;
}) {
	const Icon = option.icon;

	return (
		<DropdownMenuItem
			className="cursor-pointer justify-between"
			onSelect={() => onSortChange(option.value)}
		>
			<div className="flex items-center gap-2">
				<Icon />
				<span>{option.label}</span>
			</div>
			{option.selected ? <Check /> : null}
		</DropdownMenuItem>
	);
}
