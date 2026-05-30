const CSS_HIGHLIGHT_STYLE_ID = "graneri-css-highlight-styles";

export const ensureCssHighlightStyles = () => {
	if (typeof document === "undefined") {
		return;
	}

	if (document.getElementById(CSS_HIGHLIGHT_STYLE_ID)) {
		return;
	}

	const style = document.createElement("style");
	style.id = CSS_HIGHLIGHT_STYLE_ID;
	style.textContent = `
::highlight(chat-search-match),
::highlight(note-search-match) {
	background: var(--note-comment-background);
}

::highlight(chat-search-active-match),
::highlight(note-search-active-match) {
	background: var(--note-comment-active-background);
}
`;

	document.head.append(style);
};
