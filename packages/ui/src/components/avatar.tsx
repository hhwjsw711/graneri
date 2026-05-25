import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";
import { AvatarFallback } from "./avatar-fallback";
import { AvatarImage } from "./avatar-image";

function Avatar({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="avatar"
			className={cn(
				"relative flex size-8 shrink-0 overflow-hidden rounded-full",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarFallback, AvatarImage };
