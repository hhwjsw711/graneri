import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

function Message({
	align = "start",
	className,
	...props
}: React.ComponentProps<"div"> & {
	align?: "start" | "end";
}) {
	return (
		<div
			data-slot="message"
			data-align={align}
			className={cn(
				"group/message flex w-full min-w-0 items-end gap-2 data-[align=end]:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="message-group"
			className={cn("flex min-w-0 flex-col gap-2", className)}
			{...props}
		/>
	);
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="message-avatar"
			className={cn("flex shrink-0 items-end", className)}
			{...props}
		/>
	);
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="message-content"
			className={cn(
				"flex min-w-0 flex-col group-data-[align=end]/message:items-end",
				className,
			)}
			{...props}
		/>
	);
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="message-header"
			className={cn("mb-1 text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="message-footer"
			className={cn(
				"mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground group-data-[align=end]/message:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Message,
	MessageAvatar,
	MessageContent,
	MessageFooter,
	MessageGroup,
	MessageHeader,
};
