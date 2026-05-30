import { ConvexError } from "convex/values";

export const MAX_SIDEBAR_REORDER_ITEMS = 100;

export const assertSidebarReorderInputSize = ({
	count,
	errorCode,
}: {
	count: number;
	errorCode: string;
}) => {
	if (count <= MAX_SIDEBAR_REORDER_ITEMS) {
		return;
	}

	throw new ConvexError({
		code: errorCode,
		message: "Sidebar order contains too many items.",
	});
};

export const assertSidebarStoredReorderSize = ({
	count,
	errorCode,
}: {
	count: number;
	errorCode: string;
}) => {
	if (count <= MAX_SIDEBAR_REORDER_ITEMS) {
		return;
	}

	throw new ConvexError({
		code: errorCode,
		message: "Sidebar order contains too many stored items.",
	});
};
