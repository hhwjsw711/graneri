import {
	closestCenter,
	DndContext,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { CornerDownRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import * as React from "react";

export type QueuedFollowUpBarItem = {
	id: string;
	isDeleting: boolean;
	isEditing: boolean;
	isSendingNow: boolean;
	onDelete: () => void;
	onEdit: () => void;
	onSendNow: () => void;
	text: string;
};

const VERTICAL_SORT_KEYS = new Set(["ArrowUp", "ArrowDown"]);

const verticalKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
	if (!VERTICAL_SORT_KEYS.has(event.code)) {
		return undefined;
	}

	return sortableKeyboardCoordinates(event, args);
};

const getSortableIndex = (ids: Array<string>, targetId: UniqueIdentifier) =>
	ids.indexOf(String(targetId));

const getQueuedFollowUpDisplayText = (text: string) =>
	text.replace(/^queued\s+follow-up:\s*/i, "");

export function ChatQueuedFollowUpBar({
	onReorder,
	queuedFollowUps,
}: {
	onReorder?: (ids: Array<string>) => void;
	queuedFollowUps: Array<QueuedFollowUpBarItem>;
}) {
	const ids = React.useMemo(
		() => queuedFollowUps.map((queuedFollowUp) => queuedFollowUp.id),
		[queuedFollowUps],
	);
	const queuedFollowUpsById = React.useMemo(
		() =>
			new Map(
				queuedFollowUps.map((queuedFollowUp) => [
					queuedFollowUp.id,
					queuedFollowUp,
				]),
			),
		[queuedFollowUps],
	);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 6,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: verticalKeyboardCoordinates,
		}),
	);
	const handleDragEnd = React.useCallback(
		({
			active,
			over,
		}: {
			active: { id: UniqueIdentifier };
			over: { id: UniqueIdentifier } | null;
		}) => {
			if (!over || active.id === over.id) {
				return;
			}

			const activeIndex = getSortableIndex(ids, active.id);
			const overIndex = getSortableIndex(ids, over.id);
			if (activeIndex < 0 || overIndex < 0) {
				return;
			}

			onReorder?.(arrayMove(ids, activeIndex, overIndex));
		},
		[ids, onReorder],
	);
	const handleMove = React.useCallback(
		(id: string, direction: "up" | "down") => {
			const activeIndex = ids.indexOf(id);
			const nextIndex = direction === "up" ? activeIndex - 1 : activeIndex + 1;
			if (activeIndex < 0 || nextIndex < 0 || nextIndex >= ids.length) {
				return;
			}

			onReorder?.(arrayMove(ids, activeIndex, nextIndex));
		},
		[ids, onReorder],
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div
					className="mx-auto w-[calc(100%-1rem)] max-w-[548px] overflow-hidden rounded-t-lg rounded-b-none bg-transparent text-sm"
					// react-doctor-disable-next-line react-doctor/prefer-tag-over-role
					role="listbox"
					aria-label="Queued follow-ups"
				>
					{ids.map((id) => {
						const queuedFollowUp = queuedFollowUpsById.get(id);
						if (!queuedFollowUp) {
							return null;
						}

						return (
							<SortableQueuedFollowUpRow
								key={id}
								queuedFollowUp={queuedFollowUp}
								onMove={handleMove}
							/>
						);
					})}
				</div>
			</SortableContext>
		</DndContext>
	);
}

function SortableQueuedFollowUpRow({
	onMove,
	queuedFollowUp,
}: {
	onMove: (id: string, direction: "up" | "down") => void;
	queuedFollowUp: QueuedFollowUpBarItem;
}) {
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ id: queuedFollowUp.id });
	const style = React.useMemo<React.CSSProperties>(
		() => ({
			transform: CSS.Transform.toString(
				transform ? { ...transform, x: 0 } : null,
			),
			transition,
		}),
		[transform, transition],
	);
	const displayText = getQueuedFollowUpDisplayText(queuedFollowUp.text);
	const {
		role: _sortableRole,
		tabIndex: sortableTabIndex,
		...sortableAttributes
	} = attributes;
	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.defaultPrevented) {
				return;
			}

			if (event.key === "ArrowUp") {
				event.preventDefault();
				onMove(queuedFollowUp.id, "up");
				return;
			}

			if (event.key === "ArrowDown") {
				event.preventDefault();
				onMove(queuedFollowUp.id, "down");
			}
		},
		[onMove, queuedFollowUp.id],
	);
	const stopActionPointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			event.stopPropagation();
		},
		[],
	);

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"flex h-9 cursor-grab touch-none items-center justify-between gap-3 border-border/20 bg-muted/30 px-3.5 outline-none transition-colors first:rounded-t-lg not-last:border-b hover:bg-muted/45 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
				isDragging ? "relative z-10 bg-muted/60 opacity-90" : null,
			)}
			tabIndex={sortableTabIndex}
			// react-doctor-disable-next-line react-doctor/prefer-tag-over-role
			role="option"
			aria-selected="false"
			onKeyDown={handleKeyDown}
			{...sortableAttributes}
			{...listeners}
		>
			<div className="flex min-w-0 items-center gap-2 text-muted-foreground">
				<CornerDownRight className="size-4 shrink-0" aria-hidden="true" />
				<p className="min-w-0 truncate">
					<span className="font-medium text-foreground">Queued</span>{" "}
					<span>{displayText}</span>
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					disabled={queuedFollowUp.isSendingNow}
					onPointerDown={stopActionPointerDown}
					onClick={queuedFollowUp.onSendNow}
					className="inline-flex h-7 cursor-pointer items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
				>
					{queuedFollowUp.isSendingNow ? "Steering" : "Steer"}
				</button>
				<button
					type="button"
					disabled={queuedFollowUp.isEditing}
					onPointerDown={stopActionPointerDown}
					onClick={queuedFollowUp.onEdit}
					className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
					aria-label="Edit queued message"
				>
					<Pencil className="size-4" aria-hidden="true" />
				</button>
				<button
					type="button"
					disabled={queuedFollowUp.isDeleting}
					onPointerDown={stopActionPointerDown}
					onClick={queuedFollowUp.onDelete}
					className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
					aria-label="Delete queued message"
				>
					<Trash2 className="size-4" aria-hidden="true" />
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							onPointerDown={stopActionPointerDown}
							className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label="More queued message actions"
						>
							<Ellipsis className="size-4" aria-hidden="true" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="w-36"
						onPointerDown={(event) => event.stopPropagation()}
					>
						<DropdownMenuItem
							disabled={queuedFollowUp.isDeleting}
							onClick={queuedFollowUp.onDelete}
						>
							Turn off
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={queuedFollowUp.isEditing}
							onClick={queuedFollowUp.onEdit}
						>
							Edit
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
