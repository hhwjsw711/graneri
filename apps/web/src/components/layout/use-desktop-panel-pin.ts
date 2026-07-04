"use client";

import * as React from "react";

const readStoredPinState = (storageKey: string, fallback: boolean) => {
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const value = window.localStorage.getItem(storageKey);
		return value === null ? fallback : value === "true";
	} catch {
		return fallback;
	}
};

export function useDesktopPanelPin({
	storageKey,
	defaultPinned = false,
	onPinnedChange,
}: {
	storageKey: string;
	defaultPinned?: boolean;
	onPinnedChange?: (isPinned: boolean) => void;
}) {
	const [pinState, setPinState] = React.useState(() => ({
		defaultPinned,
		isPinned: readStoredPinState(storageKey, defaultPinned),
		storageKey,
	}));
	const isPinned =
		pinState.storageKey === storageKey &&
		pinState.defaultPinned === defaultPinned
			? pinState.isPinned
			: readStoredPinState(storageKey, defaultPinned);

	const commitPinned = React.useCallback(
		(nextPinned: boolean) => {
			setPinState({
				defaultPinned,
				isPinned: nextPinned,
				storageKey,
			});
			onPinnedChange?.(nextPinned);
		},
		[defaultPinned, onPinnedChange, storageKey],
	);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		try {
			window.localStorage.setItem(storageKey, String(isPinned));
		} catch {
			// Ignore storage failures and keep the in-memory state.
		}
	}, [isPinned, storageKey]);

	const togglePinned = React.useCallback(() => {
		commitPinned(!isPinned);
	}, [commitPinned, isPinned]);

	return {
		isPinned,
		setIsPinned: commitPinned,
		togglePinned,
	};
}
