export type LocalFolderReference = {
	id: string;
	name: string;
	path: string;
};

export declare const extractLocalPathReferences: (text: string) => string[];

export declare const extractTextFromUIMessage: (message: unknown) => string;

export declare const mergeLocalFolders: (
	...folderGroups: Array<Array<LocalFolderReference> | null | undefined>
) => LocalFolderReference[];
