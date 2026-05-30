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
import * as React from "react";

const VERTICAL_SORT_KEYS = new Set(["ArrowUp", "ArrowDown"]);

const verticalKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
	if (!VERTICAL_SORT_KEYS.has(event.code)) {
		return undefined;
	}

	return sortableKeyboardCoordinates(event, args);
};

const getSortableIndex = (ids: Array<string>, targetId: UniqueIdentifier) =>
	ids.indexOf(String(targetId));

export type SidebarSortableBindings = {
	buttonProps: React.HTMLAttributes<HTMLButtonElement>;
	isDragging: boolean;
	ref: (node: HTMLLIElement | null) => void;
	style: React.CSSProperties;
};

export function SidebarSortableList({
	children,
	ids,
	onReorder,
}: {
	children: React.ReactNode;
	ids: Array<string>;
	onReorder: (ids: Array<string>) => void;
}) {
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

			onReorder(arrayMove(ids, activeIndex, overIndex));
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
				{children}
			</SortableContext>
		</DndContext>
	);
}

export function useSidebarSortableBindings(
	id: string,
): SidebarSortableBindings {
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ id });
	const ref = React.useCallback(
		(node: HTMLLIElement | null) => {
			setNodeRef(node);
		},
		[setNodeRef],
	);
	const style = React.useMemo<React.CSSProperties>(
		() => ({
			transform: CSS.Transform.toString(
				transform ? { ...transform, x: 0 } : null,
			),
			transition,
		}),
		[transform, transition],
	);

	return React.useMemo(
		() => ({
			buttonProps: {
				...attributes,
				...listeners,
			},
			isDragging,
			ref,
			style,
		}),
		[attributes, isDragging, listeners, ref, style],
	);
}
