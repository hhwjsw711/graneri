import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

function AvatarFallback({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="avatar-fallback"
			className={cn(
				"flex size-full items-center justify-center rounded-full bg-muted text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export { AvatarFallback };
