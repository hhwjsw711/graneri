import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { openai } from "@ai-sdk/openai";
import { embed, generateText, tool } from "ai";
import { createBashTool } from "bash-tool";
import { aiLogger } from "./logger.mjs";
import { buildLocalFolderToolConfigs } from "./local-folder-tool-definitions.mjs";
import { DEFAULT_CHAT_MODEL_ID } from "./models.mjs";

export { buildLocalFolderSystemContext } from "./local-folder-tool-definitions.mjs";
export { extractTextFromUIMessage } from "./local-path-references.mjs";

const MAX_ROOTS = 4;
const MAX_DIRECTORY_ENTRIES = 200;
const MAX_WALK_FILES = 1000;
const MAX_FILE_BYTES = 120_000;
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILE_BYTES = 250_000;
const MAX_BASH_SNAPSHOT_FILES = 500;
const MAX_BASH_SNAPSHOT_FILE_BYTES = 250_000;
const MAX_BASH_SNAPSHOT_BYTES = 3_000_000;
const MAX_BASH_OUTPUT_LENGTH = 20_000;
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_IMAGE_ANALYSIS_PROMPT_LENGTH = 1_000;
const MAX_IMAGE_SEARCH_FILES = 12;
const MAX_IMAGE_SEARCH_RESULTS = 10;
const bashToolCache = new Map();
const imageMetadataCache = new Map();
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
const LOCAL_IMAGE_EXTENSIONS = new Set([
	".gif",
	".heic",
	".jpeg",
	".jpg",
	".png",
	".webp",
]);
const IMAGE_MEDIA_TYPES = {
	".gif": "image/gif",
	".heic": "image/heic",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};
const deferredOpenAIToolOptions = {
	openai: {
		deferLoading: true,
	},
};

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

const isSupportedImageFile = (path) =>
	LOCAL_IMAGE_EXTENSIONS.has(getExtension(path));

export const getImageMediaType = (path) =>
	IMAGE_MEDIA_TYPES[getExtension(path)] ?? "image/png";

const imageEmbeddingModel = openai.embedding("text-embedding-3-small");

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

const logLocalToolEvent = (event, payload = {}) => {
	if (
		process.env.GRANERI_LOCAL_TOOLS_DEBUG !== "1" &&
		!event.startsWith("image_search_") &&
		!event.startsWith("image_metadata_")
	) {
		return;
	}

	aiLogger.info({
		event: `local_tools.${event}`,
		...payload,
	});
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

const buildImageCacheKey = ({ filePath, fileStat }) =>
	[filePath, fileStat.size, fileStat.mtimeMs].join(":");

const cosineSimilarity = (left, right) => {
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;
	const length = Math.min(left.length, right.length);

	for (let index = 0; index < length; index += 1) {
		dot += left[index] * right[index];
		leftMagnitude += left[index] * left[index];
		rightMagnitude += right[index] * right[index];
	}

	if (leftMagnitude === 0 || rightMagnitude === 0) {
		return 0;
	}

	return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

const tokenizeSearchQuery = (query) =>
	query
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);

const scoreImagePathCandidate = ({
	imagePath,
	queryTokens,
	rootRelativePath,
}) => {
	const normalizedPath = imagePath.toLowerCase();
	const normalizedName = basename(imagePath).toLowerCase();
	const depth = imagePath.split("/").length - 1;
	const tokenHits = queryTokens.filter((token) =>
		normalizedPath.includes(token),
	).length;
	const screenshotBoost =
		normalizedName.includes("screenshot") ||
		normalizedName.includes("screen shot")
			? 4
			: 0;
	const rootFolderBoost = rootRelativePath === "." && depth === 0 ? 3 : 0;
	const shallowBoost = Math.max(0, 3 - depth);

	return tokenHits * 5 + screenshotBoost + rootFolderBoost + shallowBoost;
};

const scoreImageDescriptionCandidate = ({ description, queryTokens }) => {
	const normalizedDescription = description.toLowerCase();
	const tokenHits = queryTokens.filter((token) =>
		normalizedDescription.includes(token),
	).length;
	const explicitMatchBoost =
		/\b(appears to match|matches|match: yes|yes[, -]|relevant)\b/iu.test(
			description,
		)
			? 0.35
			: 0;
	const explicitNonMatchPenalty =
		/\b(does not match|not a match|match: no|not relevant)\b/iu.test(
			description,
		)
			? 0.6
			: 0;

	return tokenHits * 0.08 + explicitMatchBoost - explicitNonMatchPenalty;
};

const createImageDetailProviderOptions = (detail) =>
	detail === "low" || detail === "high"
		? {
				openai: {
					imageDetail: detail,
				},
			}
		: undefined;

const inspectLocalImage = async ({
	detail = "auto",
	prompt,
	relativePath,
	root,
}) => {
	const filePath = resolveInsideRoot({ relativePath, root });
	const fileStat = await stat(filePath);

	if (!fileStat.isFile()) {
		throw new Error("Path is not a file.");
	}

	if (!isSupportedImageFile(filePath)) {
		throw new Error("Only supported image files can be inspected.");
	}

	if (fileStat.size > MAX_IMAGE_BYTES) {
		throw new Error(
			`Image file is too large to inspect directly. Maximum size is ${MAX_IMAGE_BYTES} bytes.`,
		);
	}

	const normalizedPrompt =
		typeof prompt === "string"
			? prompt.trim().slice(0, MAX_IMAGE_ANALYSIS_PROMPT_LENGTH)
			: "";
	const image = await readFile(filePath);
	const { text } = await generateText({
		model: openai(DEFAULT_CHAT_MODEL_ID),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text:
							normalizedPrompt ||
							"Inspect this local image. Describe what is visible, extract any readable text, and mention notable UI, document, chart, or scene details.",
					},
					{
						type: "image",
						image,
						mediaType: getImageMediaType(filePath),
						providerOptions: createImageDetailProviderOptions(detail),
					},
				],
			},
		],
	});

	return {
		path: relative(root.path, filePath),
		sizeBytes: fileStat.size,
		mediaType: getImageMediaType(filePath),
		analysis: text,
	};
};

const describeImageForSearch = async ({ filePath, fileStat, query }) => {
	const cacheKey = buildImageCacheKey({ filePath, fileStat });
	const cached = imageMetadataCache.get(cacheKey);
	if (cached) {
		logLocalToolEvent("image_metadata_cache_hit", {
			path: filePath,
			sizeBytes: fileStat.size,
		});
		return {
			...cached,
			cached: true,
		};
	}

	if (fileStat.size > MAX_IMAGE_BYTES) {
		throw new Error("Image file is too large to index.");
	}

	const image = await readFile(filePath);
	const startedAt = Date.now();
	logLocalToolEvent("image_metadata_start", {
		path: filePath,
		sizeBytes: fileStat.size,
	});
	const { text } = await generateText({
		model: openai(DEFAULT_CHAT_MODEL_ID),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: [
							"Create searchable metadata for this image.",
							"Include a concise title, a factual description, visible text/OCR if present, objects, people, UI elements, colors, and likely document/screenshot context.",
							query
								? `The user's image search query is: ${query}. Explicitly say whether the image appears to match it and why.`
								: "",
							"Do not invent details that are not visible.",
						]
							.filter(Boolean)
							.join(" "),
					},
					{
						type: "image",
						image,
						mediaType: getImageMediaType(filePath),
						providerOptions: createImageDetailProviderOptions("low"),
					},
				],
			},
		],
	});
	logLocalToolEvent("image_metadata_generated", {
		durationMs: Date.now() - startedAt,
		path: filePath,
		textLength: text.length,
	});
	const embeddingStartedAt = Date.now();
	const { embedding } = await embed({
		model: imageEmbeddingModel,
		value: text.replaceAll("\n", " "),
	});
	logLocalToolEvent("image_metadata_embedded", {
		durationMs: Date.now() - embeddingStartedAt,
		path: filePath,
	});
	const metadata = {
		description: text,
		embedding,
	};

	imageMetadataCache.set(cacheKey, metadata);

	return {
		...metadata,
		cached: false,
	};
};

const searchLocalImages = async ({
	maxResults = 5,
	query,
	relativePath = ".",
	root,
}) => {
	const needle = query.trim();

	if (!needle) {
		throw new Error("Search query is required.");
	}

	const directoryPath = resolveInsideRoot({ relativePath, root });
	const directoryStat = await stat(directoryPath);

	if (!directoryStat.isDirectory()) {
		throw new Error("Search path is not a directory.");
	}

	const files = [];
	const walkStartedAt = Date.now();
	await walkFiles({ directory: directoryPath, files, root });
	logLocalToolEvent("image_search_walk_complete", {
		durationMs: Date.now() - walkStartedAt,
		fileCount: files.length,
		path: directoryPath,
		query: needle,
	});

	const rootRelativePath = relative(root.path, directoryPath) || ".";
	const queryTokens = tokenizeSearchQuery(needle);
	const imageCandidates = files
		.filter(isSupportedImageFile)
		.map((imagePath) => ({
			path: imagePath,
			pathScore: scoreImagePathCandidate({
				imagePath,
				queryTokens,
				rootRelativePath,
			}),
		}))
		.sort(
			(left, right) =>
				right.pathScore - left.pathScore ||
				left.path.split("/").length - right.path.split("/").length ||
				left.path.localeCompare(right.path),
		);
	const totalImageCount = imageCandidates.length;
	const imagePaths = imageCandidates
		.slice(0, MAX_IMAGE_SEARCH_FILES)
		.map((candidate) => candidate.path);
	logLocalToolEvent("image_search_candidates", {
		candidateCount: imagePaths.length,
		candidates: imageCandidates
			.slice(0, MAX_IMAGE_SEARCH_FILES)
			.map((candidate) => ({
				path: candidate.path,
				pathScore: candidate.pathScore,
			})),
		maxCandidates: MAX_IMAGE_SEARCH_FILES,
		query: needle,
		queryTokens,
		totalImageCount,
		truncated: imagePaths.length < totalImageCount,
	});
	const queryEmbeddingStartedAt = Date.now();
	const { embedding: queryEmbedding } = await embed({
		model: imageEmbeddingModel,
		value: needle,
	});
	logLocalToolEvent("image_search_query_embedded", {
		durationMs: Date.now() - queryEmbeddingStartedAt,
		query: needle,
	});
	const results = [];
	let cachedMetadataCount = 0;

	for (const imagePath of imagePaths) {
		const imageStartedAt = Date.now();
		const absolutePath = resolveInsideRoot({ relativePath: imagePath, root });
		const fileStat = await stat(absolutePath).catch(() => null);

		if (!fileStat?.isFile() || fileStat.size > MAX_IMAGE_BYTES) {
			logLocalToolEvent("image_search_candidate_skipped", {
				path: imagePath,
				reason: !fileStat?.isFile() ? "not a file" : "too large",
				sizeBytes: fileStat?.size,
			});
			continue;
		}

		const metadata = await describeImageForSearch({
			filePath: absolutePath,
			fileStat,
			query: needle,
		});
		if (metadata.cached) {
			cachedMetadataCount += 1;
		}

		const pathSimilarity = imagePath
			.toLowerCase()
			.includes(needle.toLowerCase())
			? 0.25
			: 0;
		const pathCandidateScore =
			imageCandidates.find((candidate) => candidate.path === imagePath)
				?.pathScore ?? 0;
		const descriptionScore = scoreImageDescriptionCandidate({
			description: metadata.description,
			queryTokens,
		});
		results.push({
			path: imagePath,
			sizeBytes: fileStat.size,
			score:
				cosineSimilarity(queryEmbedding, metadata.embedding) +
				pathSimilarity +
				pathCandidateScore / 100 +
				descriptionScore,
			description: metadata.description,
		});
		logLocalToolEvent("image_search_candidate_complete", {
			cached: metadata.cached,
			durationMs: Date.now() - imageStartedAt,
			path: imagePath,
			score: results.at(-1)?.score,
			sizeBytes: fileStat.size,
		});
	}

	const normalizedMaxResults = Math.min(
		Math.max(Number.parseInt(String(maxResults), 10) || 5, 1),
		MAX_IMAGE_SEARCH_RESULTS,
	);

	return {
		path: rootRelativePath,
		indexedImageCount: imagePaths.length,
		cachedMetadataCount,
		truncated:
			files.length >= MAX_WALK_FILES || imagePaths.length < totalImageCount,
		results: results
			.sort((left, right) => right.score - left.score)
			.slice(0, normalizedMaxResults)
			.map((result) => ({
				...result,
				score: Number(result.score.toFixed(4)),
			})),
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

const buildBashSnapshotCacheKey = ({ files, root }) =>
	[
		root.path,
		...files.map((file) => [file.path, file.sizeBytes, file.mtimeMs].join(":")),
	].join("|");

const normalizeBashOutput = (output) => {
	if (!/^\d+(,\d+)*$/u.test(output.trim())) {
		return output;
	}

	const bytes = output
		.trim()
		.split(",")
		.map((value) => Number.parseInt(value, 10));

	if (
		bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
	) {
		return output;
	}

	return Buffer.from(bytes).toString("utf8");
};

const createLocalBashSnapshot = async ({ root }) => {
	const relativePaths = [];
	await walkFiles({ directory: root.path, files: relativePaths, root });

	const files = {};
	const mountedFiles = [];
	const skippedFiles = [];
	let totalBytes = 0;

	for (const relativePath of relativePaths) {
		if (mountedFiles.length >= MAX_BASH_SNAPSHOT_FILES) {
			skippedFiles.push({
				path: relativePath,
				reason: "snapshot file limit reached",
			});
			continue;
		}

		const absolutePath = resolveInsideRoot({ relativePath, root });
		const fileStat = await stat(absolutePath).catch(() => null);

		if (!fileStat?.isFile()) {
			continue;
		}

		if (!isProbablyTextFile(absolutePath)) {
			skippedFiles.push({
				path: relativePath,
				reason: "not a text-like file",
			});
			continue;
		}

		if (fileStat.size > MAX_BASH_SNAPSHOT_FILE_BYTES) {
			skippedFiles.push({
				path: relativePath,
				reason: "file too large",
			});
			continue;
		}

		if (totalBytes + fileStat.size > MAX_BASH_SNAPSHOT_BYTES) {
			skippedFiles.push({
				path: relativePath,
				reason: "snapshot byte limit reached",
			});
			continue;
		}

		const content = await readFile(absolutePath, "utf8").catch(() => null);
		if (content === null) {
			skippedFiles.push({
				path: relativePath,
				reason: "file could not be read",
			});
			continue;
		}

		files[relativePath] = content;
		totalBytes += fileStat.size;
		mountedFiles.push({
			path: relativePath,
			sizeBytes: fileStat.size,
			mtimeMs: fileStat.mtimeMs,
		});
	}

	return {
		files,
		mountedFiles,
		skippedFiles,
		totalBytes,
		truncated:
			relativePaths.length >= MAX_WALK_FILES ||
			mountedFiles.length >= MAX_BASH_SNAPSHOT_FILES ||
			totalBytes >= MAX_BASH_SNAPSHOT_BYTES,
	};
};

const getLocalBashTool = async ({ root }) => {
	const snapshot = await createLocalBashSnapshot({ root });
	const cacheKey = buildBashSnapshotCacheKey({
		files: snapshot.mountedFiles,
		root,
	});
	const cached = bashToolCache.get(cacheKey);
	if (cached) {
		return {
			...cached,
			cached: true,
		};
	}

	const { sandbox, tools } = await createBashTool({
		files: snapshot.files,
		maxFiles: MAX_BASH_SNAPSHOT_FILES,
		maxOutputLength: MAX_BASH_OUTPUT_LENGTH,
		extraInstructions:
			"This is a virtual snapshot of text-like files from one user-shared local folder. It is not the user's real filesystem. Use commands for read/search/analysis such as find, grep, cat, head, tail, wc, sort, uniq, sed, awk, and jq. Do not claim that snapshot writes change the user's real files.",
		onAfterBashCall: ({ result }) => ({
			result: {
				...result,
				stdout: normalizeBashOutput(result.stdout),
				stderr: normalizeBashOutput(result.stderr),
				snapshot: {
					mountedFileCount: snapshot.mountedFiles.length,
					skippedFileCount: snapshot.skippedFiles.length,
					totalBytes: snapshot.totalBytes,
					truncated: snapshot.truncated,
				},
			},
		}),
	});
	const value = {
		sandbox,
		tool: tools.bash,
		snapshot,
	};

	for (const cachedValue of bashToolCache.values()) {
		await cachedValue.sandbox?.stop?.();
	}
	bashToolCache.clear();
	bashToolCache.set(cacheKey, value);

	return {
		...value,
		cached: false,
	};
};

const runLocalBash = async ({ command, root }) => {
	const trimmedCommand = command.trim();

	if (!trimmedCommand) {
		throw new Error("Command is required.");
	}

	const { cached, snapshot, tool: bashTool } = await getLocalBashTool({ root });
	const result = await bashTool.execute(
		{
			command: trimmedCommand,
		},
		{
			messages: [],
			toolCallId: "run_local_bash",
		},
	);

	return {
		...result,
		cached,
		snapshot: {
			mountedFileCount: snapshot.mountedFiles.length,
			skippedFileCount: snapshot.skippedFiles.length,
			totalBytes: snapshot.totalBytes,
			truncated: snapshot.truncated,
		},
	};
};

export const buildLocalFolderTools = (roots) => {
	if (roots.length === 0) {
		return {};
	}

	const configs = buildLocalFolderToolConfigs(roots, {
		maxImageSearchResults: MAX_IMAGE_SEARCH_RESULTS,
		providerOptions: deferredOpenAIToolOptions,
	});
	const getRoot = (rootIndex) => {
		const root = roots[rootIndex];

		if (!root) {
			throw new Error("Unknown shared folder.");
		}

		return root;
	};

	return {
		list_local_directory: tool({
			...configs.list_local_directory,
			execute: async ({ rootIndex, relativePath }) =>
				withDuration(() =>
					listDirectory({ relativePath, root: getRoot(rootIndex) }),
				),
		}),
		read_local_file: tool({
			...configs.read_local_file,
			execute: async ({ rootIndex, relativePath }) =>
				withDuration(() =>
					readLocalFile({ relativePath, root: getRoot(rootIndex) }),
				),
		}),
		inspect_local_image: tool({
			...configs.inspect_local_image,
			execute: async ({ detail, prompt, rootIndex, relativePath }) =>
				withDuration(() =>
					inspectLocalImage({
						detail,
						prompt,
						relativePath,
						root: getRoot(rootIndex),
					}),
				),
		}),
		search_local_images: tool({
			...configs.search_local_images,
			execute: async ({ maxResults, query, relativePath, rootIndex }) =>
				withDuration(() =>
					searchLocalImages({
						maxResults,
						query,
						relativePath,
						root: getRoot(rootIndex),
					}),
				),
		}),
		search_local_files: tool({
			...configs.search_local_files,
			execute: async ({ rootIndex, query }) =>
				withDuration(() =>
					searchLocalFiles({ query, root: getRoot(rootIndex) }),
				),
		}),
		run_local_bash: tool({
			...configs.run_local_bash,
			execute: async ({ rootIndex, command }) =>
				withDuration(() => runLocalBash({ command, root: getRoot(rootIndex) })),
		}),
		get_shared_local_folders: tool({
			...configs.get_shared_local_folders,
			execute: async () =>
				withDuration(async () => ({
					folders: roots.map(toRootSummary),
				})),
		}),
	};
};
