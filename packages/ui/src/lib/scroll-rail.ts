import * as React from "react";

const SCROLL_RAIL_ACTIVE_ATTRIBUTE = "data-scroll-rail-active";

export const SCROLL_RAIL_HIDE_DELAY_MS = 650;

function setScrollRailActive(element: Element, active: boolean) {
	if (active) {
		element.setAttribute(SCROLL_RAIL_ACTIVE_ATTRIBUTE, "true");
		return;
	}

	element.removeAttribute(SCROLL_RAIL_ACTIVE_ATTRIBUTE);
}

function ScrollRailVisibilityProvider() {
	React.useEffect(() => {
		const activeScrollElements = new WeakMap<Element, number>();

		const handleScroll = (event: Event) => {
			const target = event.target;

			if (!(target instanceof Element)) {
				return;
			}

			setScrollRailActive(target, true);

			const currentTimeout = activeScrollElements.get(target);
			if (currentTimeout) {
				window.clearTimeout(currentTimeout);
			}

			const nextTimeout = window.setTimeout(() => {
				setScrollRailActive(target, false);
				activeScrollElements.delete(target);
			}, SCROLL_RAIL_HIDE_DELAY_MS);

			activeScrollElements.set(target, nextTimeout);
		};

		document.addEventListener("scroll", handleScroll, {
			capture: true,
			passive: true,
		});

		return () => {
			document.removeEventListener("scroll", handleScroll, { capture: true });
		};
	}, []);

	return null;
}

export { ScrollRailVisibilityProvider };
