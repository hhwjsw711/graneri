"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Separator } from "@workspace/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH_CSS,
	APP_SIDEBAR_EXPANDED_WIDTH_CSS,
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	MOBILE_DOCKED_PANEL_DEFAULT_WIDTH_CSS,
} from "@workspace/ui/lib/panel-dimensions";
import { markPanelLayoutTransition } from "@workspace/ui/lib/panel-layout-activity";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeftIcon } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { use } from "react";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_RIGHT_COOKIE_NAME = "sidebar_right_state";
const SIDEBAR_RIGHT_MODE_COOKIE_NAME = "sidebar_right_mode";
const SIDEBAR_RIGHT_WIDTH_STORAGE_KEY = "sidebar_right_width";
const SIDEBAR_RIGHT_WIDTH_MOBILE_STORAGE_KEY = "sidebar_right_width_mobile";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = APP_SIDEBAR_EXPANDED_WIDTH_CSS;
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_RIGHT_WIDTH = `${DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH}px`;
const SIDEBAR_RIGHT_WIDTH_MOBILE = MOBILE_DOCKED_PANEL_DEFAULT_WIDTH_CSS;
const SIDEBAR_WIDTH_ICON = APP_SIDEBAR_COLLAPSED_WIDTH_CSS;
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
const SIDEBAR_LAYOUT_TRANSITION_DURATION_MS = 320;

const persistSidebarState = (openState: boolean) => {
	void window.cookieStore?.set({
		name: SIDEBAR_COOKIE_NAME,
		value: String(openState),
		path: "/",
		expires: Date.now() + SIDEBAR_COOKIE_MAX_AGE * 1000,
	});
};

const getCookie = (name: string): string | null => {
	if (typeof document === "undefined") {
		return null;
	}

	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) {
		return parts.pop()?.split(";").shift() ?? null;
	}

	return null;
};

const getCookieBoolean = (name: string, defaultValue: boolean) => {
	const value = getCookie(name);
	if (value === null) {
		return defaultValue;
	}

	return value === "true";
};

const readStoredSidebarWidth = (key: string, fallback: string) => {
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const value = window.localStorage.getItem(key)?.trim();
		return value && value.length > 0 ? value : fallback;
	} catch {
		return fallback;
	}
};

const storeSidebarWidth = (key: string, width: string) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(key, width);
	} catch {
		// Ignore storage errors; width will fall back to defaults.
	}
};

export type RightSidebarMode = "sidebar" | "floating";

type SidebarShellContextProps = {
	state: "expanded" | "collapsed";
	open: boolean;
	setOpen: (open: boolean) => void;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	isMobile: boolean;
	toggleSidebar: () => void;
};

type SidebarRightContextProps = {
	rightOpen: boolean;
	setRightOpen: (open: boolean) => void;
	rightOpenMobile: boolean;
	setRightOpenMobile: (open: boolean) => void;
	toggleRightSidebar: () => void;
	rightMode: RightSidebarMode;
	setRightMode: (mode: RightSidebarMode) => void;
	rightSidebarWidth: string;
	setRightSidebarWidth: (width: string) => void;
	rightSidebarWidthMobile: string;
	setRightSidebarWidthMobile: (width: string) => void;
	rightSidebarWidthOverride: string | null;
	setRightSidebarWidthOverride: (width: string | null) => void;
	rightSidebarWidthMobileOverride: string | null;
	setRightSidebarWidthMobileOverride: (width: string | null) => void;
	hasRightSidebar: boolean;
	setHasRightSidebar: (hasRightSidebar: boolean) => void;
};

type SidebarDockedPanelsContextProps = {
	leftInsetPanelWidth: string | null;
	setLeftInsetPanelWidth: (width: string | null) => void;
	leftOverlayPanelWidth: string | null;
	setLeftOverlayPanelWidth: (width: string | null) => void;
	rightInsetPanelWidth: string | null;
	setRightInsetPanelWidth: (width: string | null) => void;
	rightOverlayPanelWidth: string | null;
	setRightOverlayPanelWidth: (width: string | null) => void;
	syncDockedPanelWidths: (widths: DockedPanelWidthsUpdate) => void;
};

type DockedPanelWidthsState = {
	leftInsetPanelWidth: string | null;
	leftOverlayPanelWidth: string | null;
	rightInsetPanelWidth: string | null;
	rightOverlayPanelWidth: string | null;
};

type DockedPanelWidthsUpdate = Partial<DockedPanelWidthsState>;

const INITIAL_DOCKED_PANEL_WIDTHS: DockedPanelWidthsState = {
	leftInsetPanelWidth: null,
	leftOverlayPanelWidth: null,
	rightInsetPanelWidth: null,
	rightOverlayPanelWidth: null,
};

const DOCKED_PANEL_WIDTH_KEYS = [
	"leftInsetPanelWidth",
	"leftOverlayPanelWidth",
	"rightInsetPanelWidth",
	"rightOverlayPanelWidth",
] as const satisfies Array<keyof DockedPanelWidthsState>;

type SidebarProviderState = {
	hasRightSidebar: boolean;
	open: boolean;
	openMobile: boolean;
	rightMode: RightSidebarMode;
	rightOpen: boolean;
	rightOpenMobile: boolean;
	rightSidebarWidth: string;
	rightSidebarWidthMobile: string;
	rightSidebarWidthMobileOverride: string | null;
	rightSidebarWidthOverride: string | null;
};

type SidebarProviderAction =
	| {
			type: "hydrateFromStorage";
			value: Pick<
				SidebarProviderState,
				| "open"
				| "rightMode"
				| "rightOpen"
				| "rightSidebarWidth"
				| "rightSidebarWidthMobile"
			>;
	  }
	| { type: "setHasRightSidebar"; value: boolean }
	| { type: "setOpen"; value: boolean }
	| { type: "setOpenMobile"; value: boolean }
	| { type: "setRightMode"; value: RightSidebarMode }
	| { type: "setRightOpen"; value: boolean }
	| { type: "setRightOpenMobile"; value: boolean }
	| { type: "setRightSidebarWidth"; value: string }
	| { type: "setRightSidebarWidthMobile"; value: string }
	| { type: "setRightSidebarWidthMobileOverride"; value: string | null }
	| { type: "setRightSidebarWidthOverride"; value: string | null };

const createSidebarProviderState = (
	defaultOpen: boolean,
): SidebarProviderState => ({
	hasRightSidebar: false,
	open: defaultOpen,
	openMobile: false,
	rightMode: "sidebar",
	rightOpen: false,
	rightOpenMobile: false,
	rightSidebarWidth: SIDEBAR_RIGHT_WIDTH,
	rightSidebarWidthMobile: SIDEBAR_RIGHT_WIDTH_MOBILE,
	rightSidebarWidthMobileOverride: null,
	rightSidebarWidthOverride: null,
});

function sidebarProviderReducer(
	state: SidebarProviderState,
	action: SidebarProviderAction,
): SidebarProviderState {
	switch (action.type) {
		case "hydrateFromStorage":
			return {
				...state,
				...action.value,
			};
		case "setHasRightSidebar":
			return state.hasRightSidebar === action.value
				? state
				: {
						...state,
						hasRightSidebar: action.value,
					};
		case "setOpen":
			return state.open === action.value
				? state
				: {
						...state,
						open: action.value,
					};
		case "setOpenMobile":
			return state.openMobile === action.value
				? state
				: {
						...state,
						openMobile: action.value,
					};
		case "setRightMode":
			return state.rightMode === action.value
				? state
				: {
						...state,
						rightMode: action.value,
					};
		case "setRightOpen":
			return state.rightOpen === action.value
				? state
				: {
						...state,
						rightOpen: action.value,
					};
		case "setRightOpenMobile":
			return state.rightOpenMobile === action.value
				? state
				: {
						...state,
						rightOpenMobile: action.value,
					};
		case "setRightSidebarWidth":
			return state.rightSidebarWidth === action.value
				? state
				: {
						...state,
						rightSidebarWidth: action.value,
					};
		case "setRightSidebarWidthMobile":
			return state.rightSidebarWidthMobile === action.value
				? state
				: {
						...state,
						rightSidebarWidthMobile: action.value,
					};
		case "setRightSidebarWidthMobileOverride":
			return state.rightSidebarWidthMobileOverride === action.value
				? state
				: {
						...state,
						rightSidebarWidthMobileOverride: action.value,
					};
		case "setRightSidebarWidthOverride":
			return state.rightSidebarWidthOverride === action.value
				? state
				: {
						...state,
						rightSidebarWidthOverride: action.value,
					};
		default:
			return state;
	}
}

function dockedPanelWidthsReducer(
	state: DockedPanelWidthsState,
	widths: DockedPanelWidthsUpdate,
) {
	let hasChanges = false;
	const nextState = { ...state };

	for (const key of DOCKED_PANEL_WIDTH_KEYS) {
		if (!(key in widths)) {
			continue;
		}

		const nextWidth = widths[key] ?? null;
		if (nextState[key] === nextWidth) {
			continue;
		}

		nextState[key] = nextWidth;
		hasChanges = true;
	}

	return hasChanges ? nextState : state;
}

const SidebarShellContext =
	React.createContext<SidebarShellContextProps | null>(null);
const SidebarRightContext =
	React.createContext<SidebarRightContextProps | null>(null);
const SidebarDockedPanelsContext =
	React.createContext<SidebarDockedPanelsContextProps | null>(null);

function useSidebarShell() {
	const context = use(SidebarShellContext);
	if (!context) {
		throw new Error("useSidebarShell must be used within a SidebarProvider.");
	}

	return context;
}

function useOptionalSidebarShell() {
	return use(SidebarShellContext);
}

function useSidebarRight() {
	const context = use(SidebarRightContext);
	if (!context) {
		throw new Error("useSidebarRight must be used within a SidebarProvider.");
	}

	return context;
}

function useDockedPanelWidths() {
	const context = use(SidebarDockedPanelsContext);
	if (!context) {
		throw new Error(
			"useDockedPanelWidths must be used within a SidebarProvider.",
		);
	}

	return context;
}

function useOptionalDockedPanelWidths() {
	return use(SidebarDockedPanelsContext);
}

function useSidebarProviderElement({
	defaultOpen = true,
	open: openProp,
	onOpenChange: setOpenProp,
	className,
	style,
	children,
	...props
}: React.ComponentProps<"div"> & {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const isMobile = useIsMobile();
	const [sidebarState, dispatchSidebarState] = React.useReducer(
		sidebarProviderReducer,
		defaultOpen,
		createSidebarProviderState,
	);
	const [dockedPanelWidths, dispatchDockedPanelWidths] = React.useReducer(
		dockedPanelWidthsReducer,
		INITIAL_DOCKED_PANEL_WIDTHS,
	);
	const {
		leftInsetPanelWidth,
		leftOverlayPanelWidth,
		rightInsetPanelWidth,
		rightOverlayPanelWidth,
	} = dockedPanelWidths;
	const {
		hasRightSidebar,
		open: uncontrolledOpen,
		openMobile,
		rightMode,
		rightOpen,
		rightOpenMobile,
		rightSidebarWidth,
		rightSidebarWidthMobile,
		rightSidebarWidthMobileOverride,
		rightSidebarWidthOverride,
	} = sidebarState;
	const open = openProp ?? uncontrolledOpen;
	const setOpen = React.useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const openState = typeof value === "function" ? value(open) : value;
			if (setOpenProp) {
				setOpenProp(openState);
			} else {
				dispatchSidebarState({ type: "setOpen", value: openState });
			}
			persistSidebarState(openState);
		},
		[setOpenProp, open],
	);

	const initRef = React.useRef({
		defaultOpen,
		initialized: false,
		isControlled: openProp !== undefined,
	});
	React.useEffect(() => {
		if (initRef.current.initialized) {
			return;
		}

		initRef.current.initialized = true;

		const savedLeftState = getCookieBoolean(
			SIDEBAR_COOKIE_NAME,
			initRef.current.defaultOpen,
		);
		const savedRightMode = getCookie(SIDEBAR_RIGHT_MODE_COOKIE_NAME);
		dispatchSidebarState({
			type: "hydrateFromStorage",
			value: {
				open: initRef.current.isControlled ? uncontrolledOpen : savedLeftState,
				rightMode:
					savedRightMode === "floating" || savedRightMode === "sidebar"
						? savedRightMode
						: "sidebar",
				rightOpen: getCookieBoolean(SIDEBAR_RIGHT_COOKIE_NAME, false),
				rightSidebarWidth: readStoredSidebarWidth(
					SIDEBAR_RIGHT_WIDTH_STORAGE_KEY,
					SIDEBAR_RIGHT_WIDTH,
				),
				rightSidebarWidthMobile: readStoredSidebarWidth(
					SIDEBAR_RIGHT_WIDTH_MOBILE_STORAGE_KEY,
					SIDEBAR_RIGHT_WIDTH_MOBILE,
				),
			},
		});
	}, [uncontrolledOpen]);

	const setRightOpenWithCookie = React.useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const nextOpen = typeof value === "function" ? value(rightOpen) : value;
			dispatchSidebarState({ type: "setRightOpen", value: nextOpen });
			document.cookie = `${SIDEBAR_RIGHT_COOKIE_NAME}=${nextOpen}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
		},
		[rightOpen],
	);

	const setRightMode = React.useCallback((mode: RightSidebarMode) => {
		dispatchSidebarState({ type: "setRightMode", value: mode });
		document.cookie = `${SIDEBAR_RIGHT_MODE_COOKIE_NAME}=${mode}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
	}, []);

	const setRightSidebarWidth = React.useCallback((width: string) => {
		dispatchSidebarState({ type: "setRightSidebarWidth", value: width });
		storeSidebarWidth(SIDEBAR_RIGHT_WIDTH_STORAGE_KEY, width);
	}, []);

	const setRightSidebarWidthMobile = React.useCallback((width: string) => {
		dispatchSidebarState({ type: "setRightSidebarWidthMobile", value: width });
		storeSidebarWidth(SIDEBAR_RIGHT_WIDTH_MOBILE_STORAGE_KEY, width);
	}, []);

	const setOpenMobile = React.useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const nextOpen = typeof value === "function" ? value(openMobile) : value;
			dispatchSidebarState({ type: "setOpenMobile", value: nextOpen });
		},
		[openMobile],
	);

	const setRightOpenMobile = React.useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const nextOpen =
				typeof value === "function" ? value(rightOpenMobile) : value;
			dispatchSidebarState({ type: "setRightOpenMobile", value: nextOpen });
		},
		[rightOpenMobile],
	);

	const setRightSidebarWidthOverride = React.useCallback(
		(width: string | null) => {
			dispatchSidebarState({
				type: "setRightSidebarWidthOverride",
				value: width,
			});
		},
		[],
	);

	const setRightSidebarWidthMobileOverride = React.useCallback(
		(width: string | null) => {
			dispatchSidebarState({
				type: "setRightSidebarWidthMobileOverride",
				value: width,
			});
		},
		[],
	);

	const setHasRightSidebar = React.useCallback(
		(nextHasRightSidebar: boolean) => {
			dispatchSidebarState({
				type: "setHasRightSidebar",
				value: nextHasRightSidebar,
			});
		},
		[],
	);

	const syncDockedPanelWidths = React.useCallback(
		(widths: DockedPanelWidthsUpdate) => {
			dispatchDockedPanelWidths(widths);
		},
		[],
	);
	const setLeftInsetPanelWidth = React.useCallback(
		(width: string | null) => {
			syncDockedPanelWidths({ leftInsetPanelWidth: width });
		},
		[syncDockedPanelWidths],
	);
	const setLeftOverlayPanelWidth = React.useCallback(
		(width: string | null) => {
			syncDockedPanelWidths({ leftOverlayPanelWidth: width });
		},
		[syncDockedPanelWidths],
	);
	const setRightInsetPanelWidth = React.useCallback(
		(width: string | null) => {
			syncDockedPanelWidths({ rightInsetPanelWidth: width });
		},
		[syncDockedPanelWidths],
	);
	const setRightOverlayPanelWidth = React.useCallback(
		(width: string | null) => {
			syncDockedPanelWidths({ rightOverlayPanelWidth: width });
		},
		[syncDockedPanelWidths],
	);

	const toggleSidebar = React.useCallback(() => {
		return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
	}, [isMobile, setOpen, setOpenMobile]);

	const toggleRightSidebar = React.useCallback(() => {
		return isMobile
			? setRightOpenMobile((open) => !open)
			: setRightOpenWithCookie((open) => !open);
	}, [isMobile, setRightOpenMobile, setRightOpenWithCookie]);

	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				!(event.metaKey || event.ctrlKey) ||
				event.key !== SIDEBAR_KEYBOARD_SHORTCUT
			) {
				return;
			}

			if (event.altKey) {
				event.preventDefault();
				toggleRightSidebar();
				return;
			}

			if (!event.shiftKey) {
				event.preventDefault();
				toggleSidebar();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [toggleRightSidebar, toggleSidebar]);

	const state = open ? "expanded" : "collapsed";

	const shellContextValue = React.useMemo<SidebarShellContextProps>(
		() => ({
			state,
			open,
			setOpen,
			isMobile,
			openMobile,
			setOpenMobile,
			toggleSidebar,
		}),
		[state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
	);
	const rightContextValue = React.useMemo<SidebarRightContextProps>(
		() => ({
			rightOpen,
			setRightOpen: setRightOpenWithCookie,
			rightOpenMobile,
			setRightOpenMobile,
			toggleRightSidebar,
			rightMode,
			setRightMode,
			rightSidebarWidth,
			setRightSidebarWidth,
			rightSidebarWidthMobile,
			setRightSidebarWidthMobile,
			rightSidebarWidthOverride,
			setRightSidebarWidthOverride,
			rightSidebarWidthMobileOverride,
			setRightSidebarWidthMobileOverride,
			hasRightSidebar,
			setHasRightSidebar,
		}),
		[
			rightOpen,
			setRightOpenWithCookie,
			rightOpenMobile,
			setRightOpenMobile,
			toggleRightSidebar,
			rightMode,
			setRightMode,
			rightSidebarWidth,
			setRightSidebarWidth,
			rightSidebarWidthMobile,
			setRightSidebarWidthMobile,
			rightSidebarWidthOverride,
			setRightSidebarWidthOverride,
			rightSidebarWidthMobileOverride,
			setRightSidebarWidthMobileOverride,
			hasRightSidebar,
			setHasRightSidebar,
		],
	);
	const dockedPanelsContextValue =
		React.useMemo<SidebarDockedPanelsContextProps>(
			() => ({
				leftInsetPanelWidth,
				setLeftInsetPanelWidth,
				leftOverlayPanelWidth,
				setLeftOverlayPanelWidth,
				rightInsetPanelWidth,
				setRightInsetPanelWidth,
				rightOverlayPanelWidth,
				setRightOverlayPanelWidth,
				syncDockedPanelWidths,
			}),
			[
				leftInsetPanelWidth,
				setLeftInsetPanelWidth,
				leftOverlayPanelWidth,
				setLeftOverlayPanelWidth,
				rightInsetPanelWidth,
				setRightInsetPanelWidth,
				rightOverlayPanelWidth,
				setRightOverlayPanelWidth,
				syncDockedPanelWidths,
			],
		);

	return (
		<SidebarShellContext.Provider value={shellContextValue}>
			<SidebarRightContext.Provider value={rightContextValue}>
				<SidebarDockedPanelsContext.Provider value={dockedPanelsContextValue}>
					<TooltipProvider>
						<div
							data-slot="sidebar-wrapper"
							style={
								{
									"--sidebar-width": SIDEBAR_WIDTH,
									"--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
									...style,
								} as React.CSSProperties
							}
							className={cn(
								"group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
								className,
							)}
							{...props}
						>
							{children}
						</div>
					</TooltipProvider>
				</SidebarDockedPanelsContext.Provider>
			</SidebarRightContext.Provider>
		</SidebarShellContext.Provider>
	);
}

function SidebarProvider(
	props: React.ComponentProps<"div"> & {
		defaultOpen?: boolean;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	},
) {
	return useSidebarProviderElement(props);
}

function Sidebar({
	side = "left",
	variant = "sidebar",
	collapsible = "offcanvas",
	className,
	children,
	dir,
	style: styleProp,
	...props
}: React.ComponentProps<"div"> & {
	side?: "left" | "right";
	variant?: "sidebar" | "floating" | "inset";
	collapsible?: "offcanvas" | "icon" | "none";
}) {
	const { isMobile, state, openMobile, setOpenMobile } = useSidebarShell();
	const {
		rightOpen,
		rightOpenMobile,
		rightSidebarWidth,
		rightSidebarWidthMobile,
		rightSidebarWidthOverride,
		rightSidebarWidthMobileOverride,
		setRightOpenMobile,
	} = useSidebarRight();
	const isRightSide = side === "right";
	const currentOpen = isRightSide ? rightOpen : state === "expanded";
	const currentOpenMobile = isRightSide ? rightOpenMobile : openMobile;
	const setCurrentOpenMobile = isRightSide ? setRightOpenMobile : setOpenMobile;

	if (collapsible === "none") {
		return (
			<div
				data-slot="sidebar"
				className={cn(
					"flex h-full min-h-0 w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		);
	}

	if (isMobile) {
		return (
			<Sheet
				open={currentOpenMobile}
				onOpenChange={setCurrentOpenMobile}
				{...props}
			>
				<SheetContent
					dir={dir}
					data-sidebar="sidebar"
					data-slot="sidebar"
					data-mobile="true"
					className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
					style={
						{
							"--sidebar-width": isRightSide
								? (rightSidebarWidthMobileOverride ?? rightSidebarWidthMobile)
								: SIDEBAR_WIDTH_MOBILE,
						} as React.CSSProperties
					}
					side={side}
				>
					<SheetHeader className="sr-only">
						<SheetTitle>Sidebar</SheetTitle>
						<SheetDescription>Displays the mobile sidebar.</SheetDescription>
					</SheetHeader>
					<div className="flex h-full min-h-0 w-full flex-col">{children}</div>
				</SheetContent>
			</Sheet>
		);
	}

	const currentState = isRightSide
		? currentOpen
			? "expanded"
			: "collapsed"
		: state;
	const currentCollapsible = isRightSide
		? currentOpen
			? ""
			: collapsible
		: state === "collapsed"
			? collapsible
			: "";
	const desktopWidth = isRightSide
		? (rightSidebarWidthOverride ?? rightSidebarWidth)
		: SIDEBAR_WIDTH;
	const styleSidebarWidth = styleProp?.[
		"--sidebar-width" as keyof React.CSSProperties
	] as string | number | undefined;
	const effectiveDesktopWidth = styleSidebarWidth ?? desktopWidth;
	const desktopSidebarStyle = {
		...styleProp,
		"--sidebar-width": effectiveDesktopWidth,
	} as React.CSSProperties;

	return (
		<div
			className="group peer hidden text-sidebar-foreground md:block"
			data-state={currentState}
			data-collapsible={currentCollapsible}
			data-variant={variant}
			data-side={side}
			data-slot="sidebar"
		>
			{/* This is what handles the sidebar gap on desktop */}
			<div
				data-slot="sidebar-gap"
				className={cn(
					"relative w-(--sidebar-width) bg-transparent transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
					"group-data-[collapsible=offcanvas]:w-0",
					"group-data-[side=right]:group-data-[state=expanded]:w-0",
					"group-data-[side=right]:rotate-180",
					variant === "floating" || variant === "inset"
						? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
						: "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
				)}
				style={
					{
						"--sidebar-width": effectiveDesktopWidth,
					} as React.CSSProperties
				}
			/>
			<div
				data-slot="sidebar-container"
				className={cn(
					"fixed inset-y-0 z-10 hidden h-svh min-h-0 w-(--sidebar-width) transition-[left,right,width,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:flex",
					side === "left"
						? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
						: "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
					variant === "floating" || variant === "inset"
						? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
						: "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
					className,
				)}
				style={desktopSidebarStyle}
				{...props}
			>
				<div
					data-sidebar="sidebar"
					data-slot="sidebar-inner"
					className="flex size-full min-h-0 flex-col bg-sidebar transition-[transform,border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[side=left]:group-data-[collapsible=icon]:translate-x-0.5 group-data-[side=right]:group-data-[collapsible=icon]:-translate-x-0.5 group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border"
				>
					{children}
				</div>
			</div>
		</div>
	);
}

function SidebarTrigger({
	className,
	onClick,
	...props
}: React.ComponentProps<typeof Button>) {
	const { toggleSidebar } = useSidebarShell();

	return (
		<Button
			data-sidebar="trigger"
			data-slot="sidebar-trigger"
			variant="ghost"
			size="icon-sm"
			className={cn(className)}
			onClick={(event) => {
				onClick?.(event);
				toggleSidebar();
			}}
			{...props}
		>
			<PanelLeftIcon />
			<span className="sr-only">Toggle Sidebar</span>
		</Button>
	);
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
	const { toggleSidebar } = useSidebarShell();
	const { toggleRightSidebar } = useSidebarRight();
	const buttonRef = React.useRef<HTMLButtonElement>(null);

	const toggleNearestSidebar = () => {
		const sidebarElement = buttonRef.current?.closest("[data-side]");
		const side = sidebarElement?.getAttribute("data-side");

		if (side === "right") {
			toggleRightSidebar();
			return;
		}

		toggleSidebar();
	};

	return (
		<button
			type="button"
			ref={buttonRef}
			data-sidebar="rail"
			data-slot="sidebar-rail"
			aria-label="Toggle Sidebar"
			tabIndex={-1}
			onClick={toggleNearestSidebar}
			title="Toggle Sidebar"
			className={cn(
				"absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2",
				"in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
				"[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
				"group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
				"[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
				"[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarInset({
	className,
	reserveRightSidebar = true,
	style,
	...props
}: React.ComponentProps<"main"> & { reserveRightSidebar?: boolean }) {
	const { isMobile } = useSidebarShell();
	const {
		rightOpen,
		rightMode,
		hasRightSidebar,
		rightSidebarWidth,
		rightSidebarWidthOverride,
	} = useSidebarRight();
	const { leftInsetPanelWidth, rightInsetPanelWidth } = useDockedPanelWidths();
	const reservedRightSidebarWidth =
		reserveRightSidebar &&
		hasRightSidebar &&
		rightOpen &&
		!isMobile &&
		rightMode === "sidebar"
			? (rightSidebarWidthOverride ?? rightSidebarWidth)
			: null;
	const effectiveRightPadding =
		!isMobile && rightInsetPanelWidth
			? reservedRightSidebarWidth
				? `calc(${rightInsetPanelWidth} + ${reservedRightSidebarWidth})`
				: rightInsetPanelWidth
			: reservedRightSidebarWidth;
	const previousLayoutSignatureRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		const layoutSignature = [
			isMobile ? "mobile" : "desktop",
			leftInsetPanelWidth ?? "",
			rightInsetPanelWidth ?? "",
			reservedRightSidebarWidth ?? "",
			rightOpen ? "open" : "closed",
			rightMode,
			hasRightSidebar ? "present" : "absent",
		].join(":");

		if (previousLayoutSignatureRef.current === null) {
			previousLayoutSignatureRef.current = layoutSignature;
			return;
		}

		if (previousLayoutSignatureRef.current === layoutSignature) {
			return;
		}

		previousLayoutSignatureRef.current = layoutSignature;
		if (
			typeof document !== "undefined" &&
			document.documentElement.dataset.panelResizing === "true"
		) {
			return;
		}
		markPanelLayoutTransition(SIDEBAR_LAYOUT_TRANSITION_DURATION_MS);
	}, [
		hasRightSidebar,
		isMobile,
		leftInsetPanelWidth,
		reservedRightSidebarWidth,
		rightInsetPanelWidth,
		rightMode,
		rightOpen,
	]);

	return (
		<main
			data-slot="sidebar-inset"
			className={cn(
				"relative flex w-full min-w-0 flex-1 flex-col bg-background md:w-0 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-lg md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
				className,
			)}
			style={{
				...style,
				paddingLeft:
					!isMobile && leftInsetPanelWidth
						? leftInsetPanelWidth
						: style?.paddingLeft,
				paddingRight: effectiveRightPadding ?? style?.paddingRight,
			}}
			{...props}
		/>
	);
}

function SidebarInput({
	className,
	...props
}: React.ComponentProps<typeof Input>) {
	return (
		<Input
			data-slot="sidebar-input"
			data-sidebar="input"
			className={cn("h-8 w-full bg-background shadow-none", className)}
			{...props}
		/>
	);
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-header"
			data-sidebar="header"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-footer"
			data-sidebar="footer"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
}

function SidebarSeparator({
	className,
	...props
}: React.ComponentProps<typeof Separator>) {
	return (
		<Separator
			data-slot="sidebar-separator"
			data-sidebar="separator"
			className={cn("mx-2 w-auto bg-sidebar-border", className)}
			{...props}
		/>
	);
}

function SidebarContent({
	className,
	...props
}: React.ComponentProps<typeof ScrollArea>) {
	return (
		<ScrollArea
			data-slot="sidebar-content"
			data-sidebar="content"
			className={cn(
				"min-h-0 flex-1 group-data-[collapsible=icon]:overflow-hidden",
				className,
			)}
			viewportClassName="flex min-h-full min-w-0 flex-col gap-0 [&>div]:!block [&>div]:min-w-0 [&>div]:w-full"
			{...props}
		/>
	);
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group"
			data-sidebar="group"
			className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
			{...props}
		/>
	);
}

function SidebarGroupLabel({
	className,
	asChild = false,
	...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "div";

	return (
		<Comp
			data-slot="sidebar-group-label"
			data-sidebar="group-label"
			className={cn(
				"flex h-8 shrink-0 items-center rounded-lg px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:translate-x-1 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarGroupAction({
	className,
	asChild = false,
	...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="sidebar-group-action"
			data-sidebar="group-action"
			className={cn(
				"absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground/55 ring-sidebar-ring outline-hidden transition-[transform,color,background-color,opacity] group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:text-sidebar-accent-foreground aria-expanded:text-sidebar-accent-foreground data-[state=open]:text-sidebar-accent-foreground md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarGroupContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group-content"
			data-sidebar="group-content"
			className={cn("w-full text-sm", className)}
			{...props}
		/>
	);
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="sidebar-menu"
			data-sidebar="menu"
			className={cn("flex w-full min-w-0 flex-col gap-1", className)}
			{...props}
		/>
	);
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="sidebar-menu-item"
			data-sidebar="menu-item"
			className={cn("group/menu-item relative", className)}
			{...props}
		/>
	);
}

const sidebarMenuButtonVariants = cva(
	"peer/menu-button group/menu-button flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding,background-color,color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate [&>span:last-child]:transition-[opacity,transform] [&>span:last-child]:duration-150 [&>span:last-child]:ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[collapsible=icon]:[&>span:last-child]:translate-x-1 group-data-[collapsible=icon]:[&>span:last-child]:opacity-0",
	{
		variants: {
			variant: {
				default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				outline:
					"bg-background ring-1 ring-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:ring-sidebar-accent",
			},
			size: {
				default: "h-8 text-sm",
				sm: "h-7 text-xs",
				lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function SidebarMenuButton({
	asChild = false,
	isActive = false,
	variant = "default",
	size = "default",
	tooltip,
	className,
	...props
}: React.ComponentProps<"button"> & {
	asChild?: boolean;
	isActive?: boolean;
	tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
	const Comp = asChild ? Slot.Root : "button";
	const { isMobile, state } = useSidebarShell();

	const button = (
		<Comp
			data-slot="sidebar-menu-button"
			data-sidebar="menu-button"
			data-size={size}
			data-active={isActive}
			className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
			{...props}
		/>
	);

	if (!tooltip) {
		return button;
	}

	if (typeof tooltip === "string") {
		tooltip = {
			children: tooltip,
		};
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent
				side="right"
				align="center"
				hidden={state !== "collapsed" || isMobile}
				{...tooltip}
			/>
		</Tooltip>
	);
}

function SidebarMenuAction({
	className,
	asChild = false,
	showOnHover = false,
	...props
}: React.ComponentProps<"button"> & {
	asChild?: boolean;
	showOnHover?: boolean;
}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="sidebar-menu-action"
			data-sidebar="menu-action"
			className={cn(
				"absolute top-1.5 right-1 flex aspect-square w-5 cursor-pointer items-center justify-center rounded-lg p-0 text-sidebar-foreground/55 ring-sidebar-ring outline-hidden transition-[transform,color,background-color,opacity] group-data-[collapsible=icon]:hidden peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:text-sidebar-accent-foreground aria-expanded:text-sidebar-accent-foreground data-[state=open]:text-sidebar-accent-foreground md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
				showOnHover &&
					"group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarMenuBadge({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-menu-badge"
			data-sidebar="menu-badge"
			className={cn(
				"pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-lg px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarMenuSkeleton({
	className,
	showIcon = false,
	...props
}: React.ComponentProps<"div"> & {
	showIcon?: boolean;
}) {
	// Random width between 50 to 90%.
	const [width] = React.useState(() => {
		return `${Math.floor(Math.random() * 40) + 50}%`;
	});

	return (
		<div
			data-slot="sidebar-menu-skeleton"
			data-sidebar="menu-skeleton"
			className={cn("flex h-8 items-center gap-2 rounded-lg px-2", className)}
			{...props}
		>
			{showIcon && (
				<Skeleton
					className="size-4 rounded-lg"
					data-sidebar="menu-skeleton-icon"
				/>
			)}
			<Skeleton
				className="h-4 max-w-(--skeleton-width) flex-1"
				data-sidebar="menu-skeleton-text"
				style={
					{
						"--skeleton-width": width,
					} as React.CSSProperties
				}
			/>
		</div>
	);
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="sidebar-menu-sub"
			data-sidebar="menu-sub"
			className={cn(
				"mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarMenuSubItem({
	className,
	...props
}: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="sidebar-menu-sub-item"
			data-sidebar="menu-sub-item"
			className={cn("group/menu-sub-item relative", className)}
			{...props}
		/>
	);
}

function SidebarMenuSubButton({
	asChild = false,
	size = "md",
	isActive = false,
	className,
	...props
}: React.ComponentProps<"a"> & {
	asChild?: boolean;
	size?: "sm" | "md";
	isActive?: boolean;
}) {
	const Comp = asChild ? Slot.Root : "a";

	return (
		<Comp
			data-slot="sidebar-menu-sub-button"
			data-sidebar="menu-sub-button"
			data-size={size}
			data-active={isActive}
			className={cn(
				"flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-lg px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export {
	SIDEBAR_WIDTH,
	SIDEBAR_WIDTH_ICON,
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
	useDockedPanelWidths,
	useOptionalDockedPanelWidths,
	useOptionalSidebarShell,
	useSidebarRight,
	useSidebarShell,
};
