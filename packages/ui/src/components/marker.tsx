import { cn } from "@workspace/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { MarkerContent } from "./marker-content";
import { MarkerIcon } from "./marker-icon";
import { markerVariants } from "./marker-variants";

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

export { Marker, MarkerContent, MarkerIcon };
