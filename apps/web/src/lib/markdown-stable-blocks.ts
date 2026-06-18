export const parseMarkdownIntoStableBlocks = (markdown: string) => {
	const blocks: string[] = [];
	const lines = markdown.split("\n");
	let currentBlock: string[] = [];
	let codeFenceMarker: string | null = null;

	const pushBlock = () => {
		if (currentBlock.length === 0) {
			return;
		}

		blocks.push(currentBlock.join("\n"));
		currentBlock = [];
	};

	for (const line of lines) {
		const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);

		if (fenceMatch) {
			const marker = fenceMatch[1]?.[0] ?? null;
			currentBlock.push(line);

			if (codeFenceMarker === marker) {
				codeFenceMarker = null;
				pushBlock();
				continue;
			}

			if (!codeFenceMarker) {
				codeFenceMarker = marker;
			}

			continue;
		}

		if (codeFenceMarker) {
			currentBlock.push(line);
			continue;
		}

		if (line.trim().length === 0) {
			pushBlock();
			continue;
		}

		currentBlock.push(line);
	}

	pushBlock();
	return blocks;
};
