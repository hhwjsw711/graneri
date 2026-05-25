import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const mobileMediaQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const getMobileSnapshot = () =>
	typeof window !== "undefined" && window.matchMedia(mobileMediaQuery).matches;

const subscribeToMobileSnapshot = (onStoreChange: () => void) => {
	const mql = window.matchMedia(mobileMediaQuery);
	mql.addEventListener("change", onStoreChange);
	return () => mql.removeEventListener("change", onStoreChange);
};

export function useIsMobile() {
	return React.useSyncExternalStore(
		subscribeToMobileSnapshot,
		getMobileSnapshot,
		() => false,
	);
}
