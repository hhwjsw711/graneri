import { getDesktopBridge } from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import {
	extractLocalPathReferences,
	mergeLocalFolders,
} from "../../../../packages/ai/src/local-path-references.mjs";

export const shareLocalFoldersFromText = async ({
	currentFolders,
	text,
}: {
	currentFolders: DesktopLocalFolder[];
	text: string;
}) => {
	const bridge = getDesktopBridge();

	if (!bridge?.shareLocalFolders) {
		return {
			allFolders: currentFolders,
			newFolders: [],
		};
	}

	const paths = extractLocalPathReferences(text);
	if (paths.length === 0) {
		return {
			allFolders: currentFolders,
			newFolders: [],
		};
	}

	const result = await bridge.shareLocalFolders(paths);
	const allFolders = mergeLocalFolders(currentFolders, result.folders);

	return {
		allFolders,
		newFolders: result.folders,
	};
};
