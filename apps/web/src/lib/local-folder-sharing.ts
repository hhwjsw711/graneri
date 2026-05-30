import { getDesktopBridge } from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import {
	extractLocalPathReferences,
	mergeLocalFolders,
} from "../../../../packages/ai/src/local-path-references.mjs";

const STORAGE_KEY_PREFIX = "graneri.sharedLocalFolders";

const getStorageKey = (scope: string) => `${STORAGE_KEY_PREFIX}.${scope}`;

const isDesktopLocalFolder = (value: unknown): value is DesktopLocalFolder => {
	if (!value || typeof value !== "object") {
		return false;
	}

	const folder = value as Partial<DesktopLocalFolder>;
	return (
		typeof folder.id === "string" &&
		typeof folder.name === "string" &&
		typeof folder.path === "string"
	);
};

export const loadStoredSharedLocalFolders = (
	scope: string,
): DesktopLocalFolder[] => {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const raw = window.localStorage.getItem(getStorageKey(scope));
		if (!raw) {
			return [];
		}

		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isDesktopLocalFolder) : [];
	} catch {
		return [];
	}
};

export const storeSharedLocalFolders = (
	scope: string,
	folders: DesktopLocalFolder[],
) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(getStorageKey(scope), JSON.stringify(folders));
	} catch {
		// Local folder sharing should keep working even if storage is unavailable.
	}
};

export const rehydrateSharedLocalFolders = async (
	scope: string,
): Promise<DesktopLocalFolder[]> => {
	const storedFolders = loadStoredSharedLocalFolders(scope);
	const bridge = getDesktopBridge();

	if (!bridge?.shareLocalFolders || storedFolders.length === 0) {
		return storedFolders;
	}

	try {
		const result = await bridge.shareLocalFolders(
			storedFolders.map((folder) => folder.path),
		);
		storeSharedLocalFolders(scope, result.folders);
		return result.folders;
	} catch {
		return storedFolders;
	}
};

export const shareLocalFoldersFromText = async ({
	currentFolders,
	text,
}: {
	currentFolders: DesktopLocalFolder[];
	text: string;
}) => {
	const bridge = getDesktopBridge();
	const paths = extractLocalPathReferences(text);

	if (!bridge?.shareLocalFolders) {
		return {
			allFolders: currentFolders,
			newFolders: [],
		};
	}

	if (paths.length === 0) {
		return {
			allFolders: currentFolders,
			newFolders: [],
		};
	}

	let result: Awaited<ReturnType<typeof bridge.shareLocalFolders>>;
	try {
		result = await bridge.shareLocalFolders(paths);
	} catch {
		return {
			allFolders: currentFolders,
			newFolders: [],
		};
	}
	const allFolders = mergeLocalFolders(currentFolders, result.folders);

	return {
		allFolders,
		newFolders: result.folders,
	};
};
