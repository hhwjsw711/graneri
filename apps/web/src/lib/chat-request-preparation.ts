import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import {
	requireRehydratedSharedLocalFolders,
	shareLocalFoldersFromText,
	storeSharedLocalFolders,
} from "@/lib/local-folder-sharing";

type ChatRequestBase = {
	convexToken: string | null;
	localFolders: DesktopLocalFolder[];
	model: string;
	reasoningEffort: string | undefined;
	timezone: string;
};

export type WorkspaceChatRequestBody = ChatRequestBase & {
	mentions: string[];
	selectedSourceIds: string[];
	webSearchEnabled: boolean;
	workspaceId: string | null;
};

export type NoteChatRequestBody = ChatRequestBase & {
	noteContext: {
		noteId: string | null;
		title: string;
		text: string;
	};
	recipeSlug: string | null;
};

export const prepareSharedLocalFoldersForChatRequest = async ({
	storageScope,
	text,
}: {
	storageScope: string;
	text: string;
}): Promise<DesktopLocalFolder[]> => {
	const currentSharedLocalFolders =
		await requireRehydratedSharedLocalFolders(storageScope);
	const { allFolders } = await shareLocalFoldersFromText({
		currentFolders: currentSharedLocalFolders,
		text,
	});

	storeSharedLocalFolders(storageScope, allFolders);
	return allFolders;
};

const getTimezone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const buildChatRequestBase = async ({
	localFolders,
	model,
	reasoningEffort,
	resolveConvexToken,
}: {
	localFolders: DesktopLocalFolder[];
	model: string;
	reasoningEffort: string | undefined;
	resolveConvexToken: () => Promise<string | null>;
}): Promise<ChatRequestBase> => ({
	model,
	reasoningEffort,
	localFolders,
	convexToken: await resolveConvexToken(),
	timezone: getTimezone(),
});

const resolveChatRequestBase = async ({
	localFolderStorageScope,
	model,
	reasoningEffort,
	resolveConvexToken,
	text,
}: {
	localFolderStorageScope: string;
	model: string;
	reasoningEffort: string | undefined;
	resolveConvexToken: () => Promise<string | null>;
	text: string;
}): Promise<ChatRequestBase> => {
	const [convexToken, localFolders] = await Promise.all([
		resolveConvexToken(),
		prepareSharedLocalFoldersForChatRequest({
			storageScope: localFolderStorageScope,
			text,
		}),
	]);

	return {
		localFolders,
		model,
		reasoningEffort,
		convexToken,
		timezone: getTimezone(),
	};
};

export const buildWorkspaceChatRequestBodyFromLocalFolders = async ({
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
	...baseArgs
}: {
	localFolders: DesktopLocalFolder[];
	mentions: string[];
	model: string;
	reasoningEffort: string | undefined;
	resolveConvexToken: () => Promise<string | null>;
	selectedSourceIds: string[];
	webSearchEnabled: boolean;
	workspaceId: string | null;
}): Promise<WorkspaceChatRequestBody> => ({
	...(await buildChatRequestBase(baseArgs)),
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
});

export const buildWorkspaceChatRequestBody = async ({
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
	...baseArgs
}: {
	localFolderStorageScope: string;
	mentions: string[];
	model: string;
	reasoningEffort: string | undefined;
	resolveConvexToken: () => Promise<string | null>;
	selectedSourceIds: string[];
	text: string;
	webSearchEnabled: boolean;
	workspaceId: string | null;
}): Promise<WorkspaceChatRequestBody> => ({
	...(await resolveChatRequestBase(baseArgs)),
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
});

export const buildNoteChatRequestBody = async ({
	noteContext,
	recipeSlug,
	...baseArgs
}: {
	localFolderStorageScope: string;
	model: string;
	noteContext: NoteChatRequestBody["noteContext"];
	reasoningEffort: string | undefined;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	text: string;
}): Promise<NoteChatRequestBody> => ({
	...(await resolveChatRequestBase(baseArgs)),
	noteContext,
	recipeSlug,
});

export const buildNoteChatRequestBodyFromLocalFolders = async ({
	noteContext,
	recipeSlug,
	...baseArgs
}: {
	localFolders: DesktopLocalFolder[];
	model: string;
	noteContext: NoteChatRequestBody["noteContext"];
	reasoningEffort: string | undefined;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
}): Promise<NoteChatRequestBody> => ({
	...(await buildChatRequestBase(baseArgs)),
	noteContext,
	recipeSlug,
});
