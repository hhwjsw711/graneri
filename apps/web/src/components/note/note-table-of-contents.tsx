import type {
	TableOfContentData,
	TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";
import {
	CompactNavigationRail,
	type CompactNavigationRailItem,
} from "@/components/navigation/compact-navigation-rail";

type NoteTableOfContentsItem = CompactNavigationRailItem & {
	anchor: TableOfContentDataItem;
};

const getHeadingPreviewText = (anchor: TableOfContentDataItem) => {
	const previewParts: string[] = [];
	let element = anchor.dom.nextElementSibling;

	while (element) {
		if (/^H[1-6]$/u.test(element.tagName)) {
			break;
		}

		const text = element.textContent?.trim();

		if (text) {
			previewParts.push(text);
		}

		element = element.nextElementSibling;
	}

	return previewParts.join(" ").trim();
};

const getTableOfContentsItems = (
	anchors: TableOfContentData,
): NoteTableOfContentsItem[] =>
	anchors.map((anchor) => ({
		anchor,
		ariaLabel: anchor.textContent,
		id: anchor.id,
	}));

export function NoteTableOfContents({
	anchors,
	onSelect,
}: {
	anchors: TableOfContentData;
	onSelect: (anchor: TableOfContentDataItem, behavior?: ScrollBehavior) => void;
}) {
	if (anchors.length === 0) {
		return null;
	}

	const activeIndex = anchors.findIndex((anchor) => anchor.isActive);
	const effectiveActiveIndex = activeIndex >= 0 ? activeIndex : 0;
	const items = getTableOfContentsItems(anchors);

	const revealItem = (
		item: NoteTableOfContentsItem,
		behavior: ScrollBehavior,
	) => {
		onSelect(item.anchor, behavior);
	};

	return (
		<CompactNavigationRail
			activeIndex={effectiveActiveIndex}
			ariaLabel="Table of contents"
			items={items}
			onReveal={revealItem}
			renderPreview={(item) => (
				<NoteTableOfContentsPreview anchor={item.anchor} />
			)}
		/>
	);
}

function NoteTableOfContentsPreview({
	anchor,
}: {
	anchor: TableOfContentDataItem;
}) {
	const previewText = getHeadingPreviewText(anchor);

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="min-w-0 truncate font-medium">{anchor.textContent}</div>
			{previewText ? (
				<div className="line-clamp-3 text-muted-foreground">{previewText}</div>
			) : null}
		</div>
	);
}
