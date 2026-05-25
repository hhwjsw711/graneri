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
	const [isPinned, setIsPinned] = React.useState(() =>
		readStoredPinState(storageKey, defaultPinned),
	);

	// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-derived-state-effect
	React.useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-derived-state, react-doctor/no-derived-state-effect
		setIsPinned(readStoredPinState(storageKey, defaultPinned));
	}, [defaultPinned, storageKey]);

	const commitPinned = React.useCallback(
		(nextPinned: boolean) => {
			setIsPinned(nextPinned);
			onPinnedChange?.(nextPinned);
		},
		[onPinnedChange],
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
		setIsPinned((currentValue) => {
			const nextPinned = !currentValue;
			onPinnedChange?.(nextPinned);
			return nextPinned;
		});
	}, [onPinnedChange]);

	return {
		isPinned,
		setIsPinned: commitPinned,
		togglePinned,
	};
}
