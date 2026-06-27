import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

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

function Marker({
	asChild = false,
	className,
	variant = "default",
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof markerVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "div";

	return (
		<Comp
			data-slot="marker"
			data-variant={variant}
			className={cn(markerVariants({ variant }), className)}
			{...props}
		/>
	);
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			aria-hidden="true"
			data-slot="marker-icon"
			className={cn("flex shrink-0 items-center justify-center", className)}
			{...props}
		/>
	);
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="marker-content"
			className={cn("min-w-0 truncate", className)}
			{...props}
		/>
	);
}

export { Marker, MarkerContent, MarkerIcon, markerVariants };
