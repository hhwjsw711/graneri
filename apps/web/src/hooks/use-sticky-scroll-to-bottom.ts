import * as React from "react";

const BOTTOM_OFFSET_PX = 96;
const PRESERVE_SCROLL_ON_TOGGLE_SELECTOR = "[data-preserve-scroll-on-toggle]";

export function useStickyScrollToBottom() {
	const containerElementRef = React.useRef<HTMLDivElement | null>(null);
	const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
	const [isAtBottom, setIsAtBottom] = React.useState(true);
	const isAtBottomRef = React.useRef(true);
	const isUserScrollingRef = React.useRef(false);
	const previousScrollHeightRef = React.useRef(0);
	const containerRef = React.useCallback((node: HTMLDivElement | null) => {
		containerElementRef.current = node;
		setContainer(node);
	}, []);

	const checkIfAtBottom = React.useCallback(() => {
		const container = containerElementRef.current;
		if (!container) {
			return true;
		}

		return (
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - BOTTOM_OFFSET_PX
		);
	}, []);

	const scrollToBottom = React.useCallback(
		(behavior: ScrollBehavior = "smooth") => {
			const container = containerElementRef.current;
			if (!container) {
				return;
			}

			container.scrollTo({
				top: container.scrollHeight,
				behavior,
			});
		},
		[],
	);

	React.useEffect(() => {
		isAtBottomRef.current = isAtBottom;
	}, [isAtBottom]);

	React.useEffect(() => {
		if (!container) {
			return;
		}

		let scrollTimeout: ReturnType<typeof setTimeout> | undefined;

		const handleScroll = () => {
			isUserScrollingRef.current = true;
			if (scrollTimeout) {
				clearTimeout(scrollTimeout);
			}

			const nextIsAtBottom = checkIfAtBottom();
			setIsAtBottom(nextIsAtBottom);
			isAtBottomRef.current = nextIsAtBottom;

			scrollTimeout = setTimeout(() => {
				isUserScrollingRef.current = false;
			}, 150);
		};

		container.addEventListener("scroll", handleScroll, { passive: true });
		return () => {
			container.removeEventListener("scroll", handleScroll);
			if (scrollTimeout) {
				clearTimeout(scrollTimeout);
			}
		};
	}, [checkIfAtBottom, container]);

	React.useEffect(() => {
		if (!container) {
			return;
		}

		previousScrollHeightRef.current = container.scrollHeight;

		const scrollIfNeeded = () => {
			const nextScrollHeight = container.scrollHeight;

			if (!isAtBottomRef.current || isUserScrollingRef.current) {
				previousScrollHeightRef.current = nextScrollHeight;
				return;
			}

			if (
				document.activeElement instanceof HTMLElement &&
				document.activeElement.closest(PRESERVE_SCROLL_ON_TOGGLE_SELECTOR)
			) {
				previousScrollHeightRef.current = nextScrollHeight;
				return;
			}

			requestAnimationFrame(() => {
				const viewport = containerElementRef.current;
				if (!viewport) {
					return;
				}

				viewport.scrollTop = viewport.scrollHeight;
				previousScrollHeightRef.current = viewport.scrollHeight;
				setIsAtBottom(true);
				isAtBottomRef.current = true;
			});
		};

		scrollIfNeeded();

		const mutationObserver = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (node instanceof HTMLElement) {
						resizeObserver.observe(node);
					}
				}
			}

			scrollIfNeeded();
		});
		mutationObserver.observe(container, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		const resizeObserver = new ResizeObserver(() => {
			scrollIfNeeded();
		});
		resizeObserver.observe(container);

		for (const child of container.children) {
			if (child instanceof HTMLElement) {
				resizeObserver.observe(child);
			}
		}

		return () => {
			mutationObserver.disconnect();
			resizeObserver.disconnect();
		};
	}, [container]);

	return {
		containerRef,
		isAtBottom,
		scrollToBottom,
	};
}
