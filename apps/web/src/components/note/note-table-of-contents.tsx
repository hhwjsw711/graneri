import type {
	TableOfContentData,
	TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";

const INDENT_CLASS_BY_LEVEL: Record<number, string> = {
	1: "ml-0",
	2: "ml-0",
	3: "ml-3",
	4: "ml-6",
	5: "ml-9",
	6: "ml-12",
};

const LINE_WIDTH_CLASS_BY_HEADING_LEVEL: Record<number, string> = {
	1: "w-4",
	2: "w-3.5",
	3: "w-3",
	4: "w-3",
	5: "w-3",
	6: "w-3",
};

const MAX_VISIBLE_LINES = 8;

export function NoteTableOfContents({
	anchors,
	onSelect,
}: {
	anchors: TableOfContentData;
	onSelect: (anchor: TableOfContentDataItem) => void;
}) {
	if (anchors.length === 0) {
		return null;
	}

	const hasActiveAnchor = anchors.some((anchor) => anchor.isActive);
	const activeIndex = anchors.findIndex((anchor) => anchor.isActive);
	const effectiveActiveIndex = activeIndex >= 0 ? activeIndex : 0;
	const maxVisibleStart = Math.max(0, anchors.length - MAX_VISIBLE_LINES);
	const visibleStart = Math.min(
		Math.max(0, effectiveActiveIndex - Math.floor(MAX_VISIBLE_LINES / 2)),
		maxVisibleStart,
	);
	const visibleAnchors = anchors.slice(
		visibleStart,
		visibleStart + MAX_VISIBLE_LINES,
	);

	return (
		<div className="group/toc relative flex w-9 justify-end">
			<div
				aria-hidden="true"
				className="flex min-h-28 w-9 flex-col items-end gap-3 pr-1 pb-3 transition-opacity duration-150 group-hover/toc:opacity-0"
			>
				{visibleAnchors.map((anchor) => {
					const anchorIndex = anchors.findIndex(
						(candidate) => candidate.id === anchor.id,
					);
					const isActive =
						anchor.isActive || (!hasActiveAnchor && anchorIndex === 0);

					return (
						<button
							key={anchor.id}
							type="button"
							tabIndex={-1}
							className={cn(
								"h-0.5 rounded-full transition-colors",
								LINE_WIDTH_CLASS_BY_HEADING_LEVEL[anchor.originalLevel] ??
									"w-4",
								isActive ? "bg-foreground/80" : "bg-foreground/15",
							)}
							onClick={() => onSelect(anchor)}
						/>
					);
				})}
			</div>

			<div className="pointer-events-none absolute -top-3 right-0 z-20 opacity-0 transition-all duration-150 group-hover/toc:pointer-events-auto group-hover/toc:opacity-100">
				<Card
					size="sm"
					className="w-[243px] max-w-[calc(100vw-6rem)] rounded-2xl border-0 bg-popover/95 py-0 text-popover-foreground ring-0 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-popover/90"
				>
					<CardContent className="min-h-0 p-3">
						<ScrollArea
							className="w-full max-h-[218px]"
							viewportClassName="[&>div]:!block [&>div]:w-full [&>div]:min-w-0"
						>
							<nav
								aria-label="Table of contents"
								className="flex w-full min-w-0 flex-col"
							>
								{anchors.map((anchor, index) => {
									const isActive =
										anchor.isActive || (!hasActiveAnchor && index === 0);

									return (
										<Button
											key={anchor.id}
											type="button"
											variant="ghost"
											size="sm"
											aria-current={isActive ? "location" : undefined}
											className={cn(
												"h-auto min-w-0 w-full justify-start rounded-md border-0 bg-transparent px-2 py-1 text-left text-xs leading-4 font-normal whitespace-nowrap shadow-none hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent active:bg-transparent focus-visible:border-transparent focus-visible:ring-0 active:translate-y-0",
												INDENT_CLASS_BY_LEVEL[anchor.originalLevel] ?? "ml-12",
												isActive
													? "text-primary"
													: "text-muted-foreground hover:text-foreground",
											)}
											onClick={() => onSelect(anchor)}
										>
											<span className="truncate">{anchor.textContent}</span>
										</Button>
									);
								})}
							</nav>
						</ScrollArea>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
