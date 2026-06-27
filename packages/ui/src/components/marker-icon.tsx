import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

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

export { MarkerIcon };
