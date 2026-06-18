export const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const createTextMatchRanges = ({
	element,
	query,
}: {
	element: HTMLElement;
	query: string;
}) => {
	const ranges: Range[] = [];
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return ranges;
	}

	const matcher = new RegExp(escapeRegExp(normalizedQuery), "gu");
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let currentNode = walker.nextNode();

	while (currentNode) {
		const textNode = currentNode as Text;
		const normalizedText = textNode.data.toLocaleLowerCase();
		let match = matcher.exec(normalizedText);

		while (match) {
			const searchIndex = match.index;
			const range = document.createRange();
			range.setStart(textNode, searchIndex);
			range.setEnd(textNode, searchIndex + normalizedQuery.length);
			ranges.push(range);
			match = matcher.exec(normalizedText);
		}

		matcher.lastIndex = 0;
		currentNode = walker.nextNode();
	}

	return ranges;
};
