import { cva } from "class-variance-authority";

const markerVariants = cva("flex min-w-0 items-center gap-2 text-sm", {
	variants: {
		variant: {
			default: "text-muted-foreground",
			border: "border-border border-b pb-2 text-muted-foreground",
			separator:
				"w-full justify-center text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

export { markerVariants };
