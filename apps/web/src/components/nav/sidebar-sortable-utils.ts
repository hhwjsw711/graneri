export function resolveSidebarSortableItems<T>(
	ids: Array<string>,
	itemsById: ReadonlyMap<string, T>,
): Array<T> | null {
	const items: Array<T> = [];
	for (const id of ids) {
		const item = itemsById.get(id);
		if (item === undefined) {
			return null;
		}
		items.push(item);
	}

	return items;
}
