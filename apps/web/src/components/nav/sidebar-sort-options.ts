import { ArrowUpAZ, Clock3, PlusCircle } from "lucide-react";
import type * as React from "react";

export const SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME =
	"aspect-auto w-auto gap-0.5 rounded-xl bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent data-[state=open]:bg-transparent [&>div]:flex [&>div]:items-center [&>div]:gap-0.5 [&_button]:flex [&_button]:size-5 [&_button]:cursor-pointer [&_button]:items-center [&_button]:justify-center [&_button]:rounded-md [&_button]:p-0 [&_button]:text-sidebar-foreground/55 [&_button]:outline-hidden [&_button]:transition-colors [&_button:hover]:bg-sidebar-accent [&_button:hover]:text-sidebar-accent-foreground [&_button[data-state=open]]:bg-sidebar-accent [&_button[data-state=open]]:text-sidebar-accent-foreground [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-sidebar-ring [&_button>svg]:size-4 [&_button>svg]:shrink-0";

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
