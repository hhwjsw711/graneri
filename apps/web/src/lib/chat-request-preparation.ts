import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import {
	rehydrateSharedLocalFolders,
	shareLocalFoldersFromText,
	storeSharedLocalFolders,
} from "@/lib/local-folder-sharing";

export const prepareSharedLocalFoldersForChatRequest = async ({
	storageScope,
	text,
}: {
	storageScope: string;
	text: string;
}): Promise<DesktopLocalFolder[]> => {
	const currentSharedLocalFolders =
		await rehydrateSharedLocalFolders(storageScope);
	const { allFolders } = await shareLocalFoldersFromText({
		currentFolders: currentSharedLocalFolders,
		text,
	});

	storeSharedLocalFolders(storageScope, allFolders);
	return allFolders;
};
