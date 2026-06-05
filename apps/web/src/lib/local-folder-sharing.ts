import { shareDesktopLocalFolders } from "@workspace/platform/desktop";
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

	if (storedFolders.length === 0) {
		return storedFolders;
	}

	const result = await shareDesktopLocalFolders(
		storedFolders.map((folder) => folder.path),
	).catch(() => null);

	if (!result) {
		return storedFolders;
	}

	storeSharedLocalFolders(scope, result.folders);
	return result.folders;
};

export const requireRehydratedSharedLocalFolders = async (
	scope: string,
): Promise<DesktopLocalFolder[]> => {
	const storedFolders = loadStoredSharedLocalFolders(scope);

	if (storedFolders.length === 0) {
		return storedFolders;
	}

	let result: Awaited<ReturnType<typeof shareDesktopLocalFolders>>;
	try {
		result = await shareDesktopLocalFolders(
			storedFolders.map((folder) => folder.path),
		);
	} catch (error) {
		throw new Error(
			error instanceof Error
				? error.message
				: "Failed to re-register shared local folders with the desktop app.",
		);
	}

	if (!result) {
		throw new Error(
			"Desktop local folder sharing is unavailable. Restart the desktop app, then try again.",
		);
	}

	storeSharedLocalFolders(scope, result.folders);
	return result.folders;
};

export const shareLocalFoldersFromText = async ({
	currentFolders,
	text,
}: {
	currentFolders: DesktopLocalFolder[];
	text: string;
}) => {
	const paths = extractLocalPathReferences(text);

	if (paths.length === 0) {
		return {
			allFolders: currentFolders,
			newFolders: [],
		};
	}

	const result = await shareDesktopLocalFolders(paths).catch(
		(error: unknown) => {
			throw new Error(
				error instanceof Error
					? error.message
					: "Failed to share local folders with the desktop app.",
			);
		},
	);

	if (!result) {
		throw new Error(
			"Desktop local folder sharing is unavailable. Restart the desktop app, then try again.",
		);
	}
	const allFolders = mergeLocalFolders(currentFolders, result.folders);

	return {
		allFolders,
		newFolders: result.folders,
	};
};
