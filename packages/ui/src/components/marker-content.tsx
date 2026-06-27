import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="marker-content"
			className={cn("min-w-0 truncate", className)}
			{...props}
		/>
	);
}

export { MarkerContent };
