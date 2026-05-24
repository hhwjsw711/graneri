import * as React from "react";

export type NavigationHistoryState = {
	canGoBack: boolean;
	canGoForward: boolean;
};

type OpenGranHistoryState = {
	__openGranNavigationIndex: number;
};

type NavigationHistoryStore = {
	currentIndex: number;
	maxIndex: number;
	originalPushState: History["pushState"];
	originalReplaceState: History["replaceState"];
	snapshot: NavigationHistoryState;
};

declare global {
	interface Window {
		__openGranNavigationHistoryStore?: NavigationHistoryStore;
	}
}

const navigationStateChangedEvent = "opengran:navigation-state-changed";

const initialSnapshot: NavigationHistoryState = {
	canGoBack: false,
	canGoForward: false,
};

const isOpenGranHistoryState = (
	state: unknown,
): state is OpenGranHistoryState =>
	state !== null &&
	typeof state === "object" &&
	"__openGranNavigationIndex" in state &&
	typeof state.__openGranNavigationIndex === "number" &&
	Number.isInteger(state.__openGranNavigationIndex);

const markHistoryState = (
	index: number,
	state: unknown,
): OpenGranHistoryState => ({
	...(state !== null && typeof state === "object" ? state : {}),
	__openGranNavigationIndex: index,
});

const emitNavigationStateChanged = () => {
	window.dispatchEvent(new Event(navigationStateChangedEvent));
};

const getNextSnapshot = (store: NavigationHistoryStore) => ({
	canGoBack: store.currentIndex > 0,
	canGoForward: store.currentIndex < store.maxIndex,
});

const refreshSnapshot = (store: NavigationHistoryStore) => {
	const nextSnapshot = getNextSnapshot(store);

	if (
		nextSnapshot.canGoBack !== store.snapshot.canGoBack ||
		nextSnapshot.canGoForward !== store.snapshot.canGoForward
	) {
		store.snapshot = nextSnapshot;
	}

	return store.snapshot;
};

export function installNavigationHistoryState() {
	if (typeof window === "undefined") {
		return;
	}

	if (window.__openGranNavigationHistoryStore) {
		return;
	}

	const initialIndex = isOpenGranHistoryState(window.history.state)
		? window.history.state.__openGranNavigationIndex
		: 0;
	const store: NavigationHistoryStore = {
		currentIndex: initialIndex,
		maxIndex: initialIndex,
		originalPushState: window.history.pushState.bind(window.history),
		originalReplaceState: window.history.replaceState.bind(window.history),
		snapshot: initialSnapshot,
	};

	window.__openGranNavigationHistoryStore = store;
	refreshSnapshot(store);

	store.originalReplaceState(
		markHistoryState(store.currentIndex, window.history.state),
		"",
		window.location.href,
	);

	window.history.pushState = (state, unused, url) => {
		store.currentIndex += 1;
		store.maxIndex = store.currentIndex;
		store.originalPushState(
			markHistoryState(store.currentIndex, state),
			unused,
			url,
		);
		emitNavigationStateChanged();
	};

	window.history.replaceState = (state, unused, url) => {
		store.originalReplaceState(
			markHistoryState(store.currentIndex, state),
			unused,
			url,
		);
		emitNavigationStateChanged();
	};

	window.addEventListener("popstate", (event) => {
		if (isOpenGranHistoryState(event.state)) {
			store.currentIndex = event.state.__openGranNavigationIndex;
		}
		emitNavigationStateChanged();
	});
}

const getNavigationStateSnapshot = (): NavigationHistoryState => {
	const store = window.__openGranNavigationHistoryStore;
	return store ? refreshSnapshot(store) : initialSnapshot;
};

const subscribeNavigationState = (onStoreChange: () => void) => {
	window.addEventListener(navigationStateChangedEvent, onStoreChange);

	return () => {
		window.removeEventListener(navigationStateChangedEvent, onStoreChange);
	};
};

export function useNavigationHistoryState(): NavigationHistoryState {
	return React.useSyncExternalStore(
		subscribeNavigationState,
		getNavigationStateSnapshot,
		() => initialSnapshot,
	);
}

export function useNavigationHistoryShortcuts() {
	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const store = window.__openGranNavigationHistoryStore;
			if (
				!store ||
				!event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.shiftKey
			) {
				return;
			}

			if (event.key === "[" && store.currentIndex > 0) {
				event.preventDefault();
				window.history.back();
				return;
			}

			if (event.key === "]" && store.currentIndex < store.maxIndex) {
				event.preventDefault();
				window.history.forward();
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);
}
