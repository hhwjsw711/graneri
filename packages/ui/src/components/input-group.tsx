import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";
import { InputGroupAddon } from "./input-group-addon";
import { InputGroupButton } from "./input-group-button";

const INPUT_GROUP_INTERACTIVE_SELECTOR = [
	"button",
	"a[href]",
	"input",
	"label",
	"select",
	"textarea",
	"[role='button']",
	"[role='checkbox']",
	"[role='link']",
	"[role='menuitem']",
	"[role='option']",
	"[role='switch']",
	"[contenteditable='true']",
].join(",");

const INPUT_GROUP_OVERLAY_CONTENT_SELECTOR = [
	'[data-slot="dropdown-menu-content"]',
	'[data-slot="dropdown-menu-sub-content"]',
	'[data-slot="popover-content"]',
	'[data-slot="select-content"]',
].join(",");

function focusInputGroupControl(container: HTMLDivElement) {
	const control = container.querySelector<HTMLElement>(
		'[data-slot="input-group-control"]:not([disabled])',
	);

	if (!control) {
		return;
	}

	const focusTarget = control.matches(
		"input, textarea, [contenteditable='true']",
	)
		? control
		: control.querySelector<HTMLElement>(
				"input, textarea, [contenteditable='true']",
			);

	if (!focusTarget) {
		return;
	}

	focusTarget.focus({ preventScroll: true });

	if (
		focusTarget instanceof HTMLInputElement ||
		focusTarget instanceof HTMLTextAreaElement
	) {
		const cursorPosition = focusTarget.value.length;
		focusTarget.setSelectionRange(cursorPosition, cursorPosition);
	}
}

function shouldIgnoreInputGroupFocusTarget(
	target: HTMLElement,
	currentTarget: HTMLDivElement,
) {
	const targetInputGroup = target.closest<HTMLElement>(
		'[data-slot="input-group"]',
	);
	const targetOverlayContent = target.closest<HTMLElement>(
		INPUT_GROUP_OVERLAY_CONTENT_SELECTOR,
	);

	return (
		Boolean(
			target.closest(
				"input, textarea, [contenteditable='true'], [data-slot='input-group-control'] button",
			),
		) ||
		(Boolean(targetInputGroup) && targetInputGroup !== currentTarget) ||
		(targetOverlayContent !== null &&
			!targetOverlayContent.contains(currentTarget)) ||
		Boolean(target.closest(INPUT_GROUP_INTERACTIVE_SELECTOR))
	);
}

function InputGroup({
	className,
	onPointerDown,
	onPointerUp,
	...props
}: React.ComponentProps<"div">) {
	const focusControlFromEvent = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.defaultPrevented) {
				return;
			}

			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}

			if (shouldIgnoreInputGroupFocusTarget(target, event.currentTarget)) {
				return;
			}

			focusInputGroupControl(event.currentTarget);
		},
		[],
	);

	const handlePointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			onPointerDown?.(event);
			focusControlFromEvent(event);
		},
		[focusControlFromEvent, onPointerDown],
	);

	const handlePointerUp = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			onPointerUp?.(event);
			focusControlFromEvent(event);
		},
		[focusControlFromEvent, onPointerUp],
	);

	return (
		<div
			data-slot="input-group"
			className={cn(
				"group/input-group relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input transition-colors outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:bg-input/50 has-disabled:opacity-50 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto has-[>[data-slot=input-group-control]]:cursor-text dark:bg-input/30 dark:has-disabled:bg-input/80 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
				className,
			)}
			onPointerDown={handlePointerDown}
			onPointerUp={handlePointerUp}
			{...props}
		/>
	);
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"flex items-center gap-2 text-sm text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupInput({
	className,
	...props
}: React.ComponentProps<"input">) {
	return (
		<Input
			data-slot="input-group-control"
			className={cn(
				"flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupTextarea({
	className,
	...props
}: React.ComponentProps<"textarea">) {
	return (
		<Textarea
			data-slot="input-group-control"
			className={cn(
				"flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
				className,
			)}
			{...props}
		/>
	);
}

export {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
	InputGroupTextarea,
};
