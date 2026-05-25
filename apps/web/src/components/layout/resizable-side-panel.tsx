"use client";

import { DESKTOP_DOCKED_PANEL_MIN_CONTENT_WIDTH } from "@workspace/ui/lib/panel-dimensions";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

type PanelSide = "left" | "right";
type ResizeGripOrientation = "vertical" | "horizontal";
type ResizeHandleCursor = "col-resize" | "row-resize";

type ResizablePanelWidthBounds = {
	min: number;
	max: number;
};

type UseResizableSidePanelOptions = {
	isMobile: boolean;
	side: PanelSide;
	desktopStorageKey: string;
	mobileStorageKey: string;
	defaultDesktopWidth: number;
	desktopMinWidth: number;
	desktopMaxWidth: number;
	mobileMinWidth: number;
	keyboardStep?: number;
	desktopMinContentWidth?: number;
	desktopLeadingOffset?: number;
	desktopTrailingOffset?: number;
};

type UseResizeHandleOptions = {
	cursor: ResizeHandleCursor;
	onResizeMove: (event: PointerEvent) => void;
	onResizeStart?: (event: React.PointerEvent<HTMLElement>) => void;
	onResizeEnd?: () => void;
	onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
};

const DEFAULT_KEYBOARD_STEP = 24;
const DEFAULT_DESKTOP_MIN_CONTENT_WIDTH =
	DESKTOP_DOCKED_PANEL_MIN_CONTENT_WIDTH;

const clampPanelWidth = (width: number, bounds: ResizablePanelWidthBounds) =>
	Math.min(bounds.max, Math.max(bounds.min, width));

const getPanelWidthBounds = (
	viewportWidth: number,
	isMobile: boolean,
	desktopMinWidth: number,
	desktopMaxWidth: number,
	mobileMinWidth: number,
	desktopMinContentWidth: number,
	desktopLeadingOffset: number,
	desktopTrailingOffset: number,
): ResizablePanelWidthBounds => {
	if (isMobile) {
		const maxWidth = Math.max(mobileMinWidth, viewportWidth);
		return {
			min: Math.min(mobileMinWidth, maxWidth),
			max: maxWidth,
		};
	}

	const maxWidth = Math.max(
		desktopMinWidth,
		Math.min(
			desktopMaxWidth,
			viewportWidth -
				desktopMinContentWidth -
				desktopLeadingOffset -
				desktopTrailingOffset,
		),
	);

	return {
		min: Math.min(desktopMinWidth, maxWidth),
		max: maxWidth,
	};
};

const getWidthFromClientX = (
	clientX: number,
	viewportWidth: number,
	side: PanelSide,
	leadingOffset: number,
	trailingOffset: number,
) =>
	side === "right"
		? viewportWidth - trailingOffset - clientX
		: clientX - leadingOffset;

function useResizeHandle({
	cursor,
	onResizeMove,
	onResizeStart,
	onResizeEnd,
	onKeyDown,
}: UseResizeHandleOptions) {
	const [isResizing, setIsResizing] = React.useState(false);

	React.useEffect(() => {
		if (!isResizing || typeof document === "undefined") {
			return;
		}

		const previousBodyStyle = document.body.getAttribute("style");
		const previousPanelResizingState =
			document.documentElement.dataset.panelResizing;

		document.body.setAttribute(
			"style",
			`${previousBodyStyle ?? ""}; user-select: none; cursor: ${cursor};`,
		);
		document.documentElement.dataset.panelResizing = "true";

		return () => {
			if (previousBodyStyle === null) {
				document.body.removeAttribute("style");
			} else {
				document.body.setAttribute("style", previousBodyStyle);
			}
			if (previousPanelResizingState === undefined) {
				delete document.documentElement.dataset.panelResizing;
				return;
			}

			document.documentElement.dataset.panelResizing =
				previousPanelResizingState;
		};
	}, [cursor, isResizing]);

	const handleResizeStart = React.useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			if (event.pointerType !== "touch" && event.button !== 0) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture?.(event.pointerId);
			onResizeStart?.(event);
			setIsResizing(true);

			const stopResizing = () => {
				setIsResizing(false);
				onResizeEnd?.();
				window.removeEventListener("pointermove", onResizeMove);
				window.removeEventListener("pointerup", stopResizing);
				window.removeEventListener("pointercancel", stopResizing);
			};

			window.addEventListener("pointermove", onResizeMove);
			window.addEventListener("pointerup", stopResizing);
			window.addEventListener("pointercancel", stopResizing);
		},
		[onResizeEnd, onResizeMove, onResizeStart],
	);

	const handleResizeKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			onKeyDown?.(event);
		},
		[onKeyDown],
	);

	return {
		handleResizeKeyDown,
		handleResizeStart,
		isResizing,
	};
}

function useResizableSidePanel({
	isMobile,
	side,
	desktopStorageKey,
	mobileStorageKey,
	defaultDesktopWidth,
	desktopMinWidth,
	desktopMaxWidth,
	mobileMinWidth,
	keyboardStep = DEFAULT_KEYBOARD_STEP,
	desktopMinContentWidth = DEFAULT_DESKTOP_MIN_CONTENT_WIDTH,
	desktopLeadingOffset = 0,
	desktopTrailingOffset = 0,
}: UseResizableSidePanelOptions) {
	const [viewportWidth, setViewportWidth] = React.useState(() =>
		typeof window === "undefined" ? defaultDesktopWidth : window.innerWidth,
	);
	const effectiveDesktopLeadingOffset = isMobile ? 0 : desktopLeadingOffset;
	const effectiveDesktopTrailingOffset = isMobile ? 0 : desktopTrailingOffset;
	const bounds = React.useMemo(
		() =>
			getPanelWidthBounds(
				viewportWidth,
				isMobile,
				desktopMinWidth,
				desktopMaxWidth,
				mobileMinWidth,
				desktopMinContentWidth,
				effectiveDesktopLeadingOffset,
				effectiveDesktopTrailingOffset,
			),
		[
			desktopMaxWidth,
			effectiveDesktopLeadingOffset,
			effectiveDesktopTrailingOffset,
			desktopMinWidth,
			desktopMinContentWidth,
			isMobile,
			mobileMinWidth,
			viewportWidth,
		],
	);
	const [panelWidth, setPanelWidth] = React.useState(() =>
		clampPanelWidth(
			isMobile
				? typeof window === "undefined"
					? defaultDesktopWidth
					: window.innerWidth
				: defaultDesktopWidth,
			bounds,
		),
	);
	const panelWidthRef = React.useRef(panelWidth);
	const resizeGrabOffsetRef = React.useRef(0);
	const pendingPanelWidthRef = React.useRef<number | null>(null);
	const resizeAnimationFrameRef = React.useRef<number | null>(null);
	const storageKey = isMobile ? mobileStorageKey : desktopStorageKey;
	const persistPanelWidth = React.useCallback(
		(width: number) => {
			if (typeof window === "undefined") {
				return;
			}

			window.localStorage.setItem(storageKey, String(Math.round(width)));
		},
		[storageKey],
	);
	const commitPanelWidth = React.useCallback((nextWidth: number) => {
		if (resizeAnimationFrameRef.current !== null) {
			window.cancelAnimationFrame(resizeAnimationFrameRef.current);
			resizeAnimationFrameRef.current = null;
		}

		pendingPanelWidthRef.current = null;
		panelWidthRef.current = nextWidth;
		setPanelWidth((currentWidth) =>
			currentWidth === nextWidth ? currentWidth : nextWidth,
		);
	}, []);
	const schedulePanelWidth = React.useCallback((nextWidth: number) => {
		pendingPanelWidthRef.current = nextWidth;

		if (resizeAnimationFrameRef.current !== null) {
			return;
		}

		resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
			resizeAnimationFrameRef.current = null;
			const pendingWidth = pendingPanelWidthRef.current;
			pendingPanelWidthRef.current = null;

			if (pendingWidth === null) {
				return;
			}

			panelWidthRef.current = pendingWidth;
			setPanelWidth((currentWidth) =>
				currentWidth === pendingWidth ? currentWidth : pendingWidth,
			);
		});
	}, []);
	const flushScheduledPanelWidth = React.useCallback(() => {
		const pendingWidth = pendingPanelWidthRef.current;
		if (pendingWidth !== null) {
			commitPanelWidth(pendingWidth);
			persistPanelWidth(pendingWidth);
			return;
		}

		persistPanelWidth(panelWidthRef.current);
	}, [commitPanelWidth, persistPanelWidth]);
	const getRawWidthFromClientX = React.useCallback(
		(clientX: number) =>
			getWidthFromClientX(
				clientX,
				viewportWidth,
				side,
				effectiveDesktopLeadingOffset,
				effectiveDesktopTrailingOffset,
			),
		[
			effectiveDesktopLeadingOffset,
			effectiveDesktopTrailingOffset,
			side,
			viewportWidth,
		],
	);
	const updateWidthFromClientX = React.useCallback(
		(clientX: number, strategy: "commit" | "schedule" = "schedule") => {
			const nextWidth = clampPanelWidth(
				getRawWidthFromClientX(clientX) + resizeGrabOffsetRef.current,
				bounds,
			);

			if (strategy === "commit") {
				commitPanelWidth(nextWidth);
				return;
			}

			schedulePanelWidth(nextWidth);
		},
		[bounds, commitPanelWidth, getRawWidthFromClientX, schedulePanelWidth],
	);

	React.useEffect(() => {
		panelWidthRef.current = panelWidth;
	}, [panelWidth]);

	React.useEffect(() => {
		const animationFrameId = resizeAnimationFrameRef.current;
		return () => {
			if (animationFrameId !== null) {
				window.cancelAnimationFrame(animationFrameId);
			}
		};
	}, []);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const handleResize = () => {
			setViewportWidth(window.innerWidth);
		};

		window.addEventListener("resize", handleResize);
		return () => {
			window.removeEventListener("resize", handleResize);
		};
	}, []);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const storedValue = window.localStorage.getItem(storageKey);
		const parsedWidth = storedValue ? Number.parseFloat(storedValue) : NaN;
		const nextBounds = getPanelWidthBounds(
			window.innerWidth,
			isMobile,
			desktopMinWidth,
			desktopMaxWidth,
			mobileMinWidth,
			desktopMinContentWidth,
			effectiveDesktopLeadingOffset,
			effectiveDesktopTrailingOffset,
		);
		const defaultWidth = isMobile ? window.innerWidth : defaultDesktopWidth;
		const nextWidth = Number.isFinite(parsedWidth) ? parsedWidth : defaultWidth;

		// react-doctor-disable-next-line react-doctor/no-derived-state
		setPanelWidth(clampPanelWidth(nextWidth, nextBounds));
	}, [
		defaultDesktopWidth,
		desktopMaxWidth,
		effectiveDesktopLeadingOffset,
		effectiveDesktopTrailingOffset,
		desktopMinWidth,
		desktopMinContentWidth,
		isMobile,
		mobileMinWidth,
		storageKey,
	]);

	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setPanelWidth((currentWidth) => clampPanelWidth(currentWidth, bounds));
	}, [bounds]);

	const resizeHandleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			let nextWidth: number | null = null;

			switch (event.key) {
				case "ArrowLeft":
					nextWidth =
						panelWidth + (side === "right" ? keyboardStep : -keyboardStep);
					break;
				case "ArrowRight":
					nextWidth =
						panelWidth + (side === "right" ? -keyboardStep : keyboardStep);
					break;
				case "Home":
					nextWidth = bounds.min;
					break;
				case "End":
					nextWidth = bounds.max;
					break;
				default:
					return;
			}

			event.preventDefault();
			const clampedWidth = clampPanelWidth(nextWidth, bounds);
			commitPanelWidth(clampedWidth);
			persistPanelWidth(clampedWidth);
		},
		[
			bounds,
			commitPanelWidth,
			keyboardStep,
			panelWidth,
			persistPanelWidth,
			side,
		],
	);

	const { handleResizeKeyDown, handleResizeStart, isResizing } =
		useResizeHandle({
			cursor: "col-resize",
			onResizeStart: (event) => {
				resizeGrabOffsetRef.current =
					panelWidthRef.current - getRawWidthFromClientX(event.clientX);
			},
			onResizeMove: (event) => {
				updateWidthFromClientX(event.clientX);
			},
			onResizeEnd: () => {
				resizeGrabOffsetRef.current = 0;
				flushScheduledPanelWidth();
			},
			onKeyDown: resizeHandleKeyDown,
		});

	React.useEffect(() => {
		if (isResizing) {
			return;
		}

		persistPanelWidth(panelWidth);
	}, [isResizing, panelWidth, persistPanelWidth]);

	return {
		handleResizeKeyDown,
		handleResizeStart,
		isResizing,
		panelWidth,
	};
}

function ResizeHandleButton({
	label,
	title,
	orientation,
	isResizing,
	cursorClass,
	className,
	onPointerDown,
	onKeyDown,
}: {
	label: string;
	title: string;
	orientation: ResizeGripOrientation;
	isResizing: boolean;
	cursorClass: string;
	className?: string;
	onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={title}
			data-app-region="no-drag"
			className={cn(
				"touch-none outline-none",
				cursorClass,
				className,
				isResizing && orientation === "vertical" && "cursor-col-resize",
				isResizing && orientation === "horizontal" && "cursor-row-resize",
			)}
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
		>
			<ResizeHandleGrip orientation={orientation} active={isResizing} />
		</button>
	);
}

function ResizableSidePanelHandle({
	side,
	panelWidth,
	isResizing,
	onPointerDown,
	onKeyDown,
	label,
	className,
}: {
	side: PanelSide;
	panelWidth: number;
	isResizing: boolean;
	onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
	label: string;
	className?: string;
}) {
	return (
		<ResizeHandleButton
			label={label}
			title={`${label}: ${Math.round(panelWidth)}px`}
			orientation="vertical"
			isResizing={isResizing}
			cursorClass="cursor-ew-resize"
			className={cn(
				"absolute inset-y-0 z-20 flex w-5 items-center justify-center",
				side === "right" ? "left-0" : "right-0",
				className,
				isResizing && "opacity-100",
			)}
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
		/>
	);
}

function ResizableTopPanelHandle({
	label,
	title,
	isResizing,
	className,
	onPointerDown,
	onKeyDown,
}: {
	label: string;
	title: string;
	isResizing: boolean;
	className?: string;
	onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
	return (
		<div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-5 items-start justify-center">
			<ResizeHandleButton
				label={label}
				title={title}
				orientation="horizontal"
				isResizing={isResizing}
				cursorClass="cursor-row-resize"
				className={cn(
					"pointer-events-auto mt-1 flex h-4 w-24 items-center justify-center",
					className,
					isResizing && "opacity-100",
				)}
				onPointerDown={onPointerDown}
				onKeyDown={onKeyDown}
			/>
		</div>
	);
}

function ResizeHandleGrip({
	orientation,
	active = false,
	className,
}: {
	orientation: ResizeGripOrientation;
	active?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"rounded-full bg-border/80 transition-colors duration-150",
				orientation === "vertical" ? "h-16 w-1.5" : "h-1.5 w-16",
				active && "bg-foreground/40",
				className,
			)}
		/>
	);
}

export {
	ResizableSidePanelHandle,
	ResizableTopPanelHandle,
	useResizableSidePanel,
	useResizeHandle,
};
