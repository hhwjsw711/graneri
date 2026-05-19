import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { tool } from "ai";
import { z } from "zod";

export { extractTextFromUIMessage } from "./local-path-references.mjs";

const MAX_ROOTS = 4;
const MAX_DIRECTORY_ENTRIES = 200;
const MAX_WALK_FILES = 1000;
const MAX_FILE_BYTES = 120_000;
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILE_BYTES = 250_000;
const IGNORED_DIRECTORY_NAMES = new Set([
	".cache",
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
]);
const TEXT_FILE_EXTENSIONS = new Set([
	".c",
	".cc",
	".conf",
	".cpp",
	".cs",
	".css",
	".csv",
	".go",
	".h",
	".hpp",
	".html",
	".java",
	".js",
	".json",
	".jsx",
	".kt",
	".log",
	".md",
	".mdx",
	".mjs",
	".py",
	".rb",
	".rs",
	".sh",
	".sql",
	".swift",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
]);

const isIgnoredDirectory = (name) => IGNORED_DIRECTORY_NAMES.has(name);

const getExtension = (path) => {
	const name = basename(path);
	const index = name.lastIndexOf(".");
	return index >= 0 ? name.slice(index).toLowerCase() : "";
};

const isProbablyTextFile = (path) => {
	const name = basename(path).toLowerCase();
	return (
		TEXT_FILE_EXTENSIONS.has(getExtension(path)) ||
		name === "makefile" ||
		name === "dockerfile" ||
		name === "license"
	);
};

const resolveInsideRoot = ({ relativePath = ".", root }) => {
	const candidate = resolve(root.path, relativePath);
	const rootRelativePath = relative(root.path, candidate);

	if (
		rootRelativePath.startsWith("..") ||
		rootRelativePath === ".." ||
		isAbsolute(rootRelativePath)
	) {
		throw new Error("Path is outside the shared folder.");
	}

	return candidate;
};

const withDuration = async (operation) => {
	const startedAt = Date.now();
	const output = await operation();

	return {
		...output,
		totalDurationMs: Date.now() - startedAt,
	};
};

const toRootSummary = (root, index) => ({
	index,
	name: root.name,
	path: root.path,
	source: root.source,
});

export const resolveLocalFolderRoots = async (references) => {
	const roots = [];
	const seen = new Set();

	for (const source of references.slice(0, MAX_ROOTS * 2)) {
		try {
			const resolvedPath = await realpath(source);
			const pathStat = await stat(resolvedPath);
			const rootPath = pathStat.isDirectory()
				? resolvedPath
				: dirname(resolvedPath);

			if (seen.has(rootPath)) {
				continue;
			}

			seen.add(rootPath);
			roots.push({
				name: basename(rootPath) || rootPath,
				path: rootPath,
				source,
			});

			if (roots.length >= MAX_ROOTS) {
				break;
			}
		} catch {
			// Ignore stale pasted paths; the assistant can still answer normally.
		}
	}

	return roots;
};

const listDirectory = async ({ relativePath = ".", root }) => {
	const directoryPath = resolveInsideRoot({ relativePath, root });
	const directoryStat = await stat(directoryPath);

	if (!directoryStat.isDirectory()) {
		throw new Error("Path is not a directory.");
	}

	const entries = await readdir(directoryPath, { withFileTypes: true });
	const displayableEntries = entries
		.filter(
			(entry) => !entry.name.startsWith(".") || entry.name === ".env.example",
		)
		.filter(
			(entry) => !(entry.isDirectory() && isIgnoredDirectory(entry.name)),
		);
	const visibleEntries = displayableEntries.slice(0, MAX_DIRECTORY_ENTRIES);

	return {
		path: relative(root.path, directoryPath) || ".",
		truncated: displayableEntries.length > visibleEntries.length,
		entries: visibleEntries.map((entry) => ({
			name: entry.name,
			type: entry.isDirectory()
				? "directory"
				: entry.isFile()
					? "file"
					: "other",
		})),
	};
};

const readLocalFile = async ({ relativePath, root }) => {
	const filePath = resolveInsideRoot({ relativePath, root });
	const fileStat = await stat(filePath);

	if (!fileStat.isFile()) {
		throw new Error("Path is not a file.");
	}

	if (!isProbablyTextFile(filePath)) {
		throw new Error("Only text-like files can be read.");
	}

	const buffer = await readFile(filePath);
	const truncated = buffer.byteLength > MAX_FILE_BYTES;
	const content = buffer.subarray(0, MAX_FILE_BYTES).toString("utf8");

	return {
		path: relative(root.path, filePath),
		sizeBytes: fileStat.size,
		truncated,
		content,
	};
};

const walkFiles = async ({ directory, files, root }) => {
	if (files.length >= MAX_WALK_FILES) {
		return;
	}

	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => [],
	);

	for (const entry of entries) {
		if (files.length >= MAX_WALK_FILES) {
			return;
		}

		if (entry.name.startsWith(".") && entry.name !== ".env.example") {
			continue;
		}

		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			if (!isIgnoredDirectory(entry.name)) {
				await walkFiles({ directory: entryPath, files, root });
			}
			continue;
		}

		if (entry.isFile()) {
			files.push(relative(root.path, entryPath));
		}
	}
};

const searchLocalFiles = async ({ query, root }) => {
	const needle = query.trim().toLowerCase();

	if (!needle) {
		throw new Error("Search query is required.");
	}

	const files = [];
	await walkFiles({ directory: root.path, files, root });

	const matches = [];

	for (const relativePath of files) {
		if (matches.length >= MAX_SEARCH_MATCHES) {
			break;
		}

		const pathMatches = relativePath.toLowerCase().includes(needle);
		const absolutePath = resolveInsideRoot({ relativePath, root });
		const fileStat = await stat(absolutePath).catch(() => null);

		if (!fileStat?.isFile()) {
			continue;
		}

		const lineMatches = [];

		if (
			isProbablyTextFile(absolutePath) &&
			fileStat.size <= MAX_SEARCH_FILE_BYTES
		) {
			const content = await readFile(absolutePath, "utf8").catch(() => "");
			const lines = content.split(/\r?\n/u);

			for (let index = 0; index < lines.length; index += 1) {
				if (lines[index].toLowerCase().includes(needle)) {
					lineMatches.push({
						line: index + 1,
						text: lines[index].slice(0, 500),
					});
				}

				if (lineMatches.length >= 5) {
					break;
				}
			}
		}

		if (pathMatches || lineMatches.length > 0) {
			matches.push({
				path: relativePath,
				sizeBytes: fileStat.size,
				matches: lineMatches,
				matchedPath: pathMatches,
			});
		}
	}

	return {
		truncated:
			files.length >= MAX_WALK_FILES || matches.length >= MAX_SEARCH_MATCHES,
		matches,
	};
};

export const buildLocalFolderSystemContext = (roots) =>
	roots.length === 0
		? ""
		: [
				"The user shared local folders from the desktop app. You may inspect only these shared folders through the local folder tools. Do not claim access to other local paths.",
				"Shared local folders:",
				...roots.map((root, index) => `${index}: ${root.name} (${root.path})`),
			].join("\n");

export const buildLocalFolderTools = (roots) => {
	if (roots.length === 0) {
		return {};
	}

	const rootSchema = z
		.number()
		.int()
		.min(0)
		.max(Math.max(roots.length - 1, 0));
	const getRoot = (rootIndex) => {
		const root = roots[rootIndex];

		if (!root) {
			throw new Error("Unknown shared folder.");
		}

		return root;
	};

	return {
		list_local_directory: tool({
			description:
				"List files and folders inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				relativePath: z
					.string()
					.default(".")
					.describe("Path relative to the shared folder root."),
			}),
			execute: async ({ rootIndex, relativePath }) =>
				withDuration(() =>
					listDirectory({ relativePath, root: getRoot(rootIndex) }),
				),
		}),
		read_local_file: tool({
			description:
				"Read a text-like file inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				relativePath: z
					.string()
					.min(1)
					.describe("File path relative to the shared folder root."),
			}),
			execute: async ({ rootIndex, relativePath }) =>
				withDuration(() =>
					readLocalFile({ relativePath, root: getRoot(rootIndex) }),
				),
		}),
		search_local_files: tool({
			description:
				"Search file names and text-like file contents inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				query: z.string().min(1).describe("Case-insensitive text to find."),
			}),
			execute: async ({ rootIndex, query }) =>
				withDuration(() =>
					searchLocalFiles({ query, root: getRoot(rootIndex) }),
				),
		}),
		get_shared_local_folders: tool({
			description: "Return the local folders shared with this chat request.",
			inputSchema: z.object({}),
			execute: async () =>
				withDuration(async () => ({
					folders: roots.map(toRootSummary),
				})),
		}),
	};
};
