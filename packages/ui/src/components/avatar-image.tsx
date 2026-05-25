import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";
import { useReducer } from "react";

function AvatarImage({
	className,
	alt = "",
	src,
	...props
}: React.ComponentProps<"img">) {
	const [hasError, setHasError] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);

	if (!src || hasError) {
		return null;
	}

	return (
		<img
			data-slot="avatar-image"
			src={src}
			alt={alt}
			className={cn("aspect-square size-full object-cover", className)}
			onError={() => setHasError(true)}
			{...props}
		/>
	);
}

export { AvatarImage };
