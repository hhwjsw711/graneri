import type { ToolSet } from "ai";

export type LocalFolderRoot = {
	name: string;
	path: string;
	source?: string;
};

export { extractTextFromUIMessage } from "./local-path-references.mjs";

export declare const resolveLocalFolderRoots: (
	references: string[],
) => Promise<LocalFolderRoot[]>;

export declare const buildLocalFolderSystemContext: (
	roots: LocalFolderRoot[],
) => string;

export declare const buildLocalFolderTools: (
	roots: LocalFolderRoot[],
) => ToolSet;
