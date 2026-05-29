import { createHash } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const transcriptDraftStorageVersion = 1;
const transcriptDraftMaxAgeMs = 72 * 60 * 60 * 1000;
const noteDraftStorageVersion = 1;
const noteDraftMaxAgeMs = 72 * 60 * 60 * 1000;
const maxLocalFolderShareRequestPaths = 8;
const maxLocalFolderPathLength = 4096;
const maxSharedLocalFolders = 12;

const createLocalFolderId = (folderPath) =>
	createHash("sha256").update(folderPath).digest("hex").slice(0, 24);

const toSharedLocalFolderPayload = (folder) => ({
	id: folder.id,
	name: folder.name,
	path: folder.path,
});

const getDraftPath = ({ draftsDirPath, noteKey }) =>
	join(
		draftsDirPath,
		`${Buffer.from(noteKey, "utf8").toString("base64url")}.json`,
	);

const ensureDraftsDir = async (draftsDirPath) => {
	await mkdir(draftsDirPath, { recursive: true });
};

const pruneDrafts = async ({ draftsDirPath, maxAgeMs, label }) => {
	try {
		await ensureDraftsDir(draftsDirPath);
		const entries = await readdir(draftsDirPath, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				if (!entry.isFile()) {
					return;
				}

				const filePath = join(draftsDirPath, entry.name);

				try {
					const fileStats = await stat(filePath);

					if (Date.now() - fileStats.mtimeMs > maxAgeMs) {
						await rm(filePath, { force: true });
					}
				} catch {
					await rm(filePath, { force: true });
				}
			}),
		);
	} catch (error) {
		console.warn(`Failed to prune ${label} drafts.`, error);
	}
};

const loadDraft = async ({
	draftsDirPath,
	maxAgeMs,
	noteKey,
	storedKeyField,
	version,
	label,
}) => {
	await pruneDrafts({ draftsDirPath, maxAgeMs, label });

	const filePath = getDraftPath({ draftsDirPath, noteKey });

	try {
		const rawValue = await readFile(filePath, "utf8");
		const parsed = JSON.parse(rawValue);

		if (
			parsed?.version !== version ||
			parsed?.[storedKeyField] !== noteKey ||
			typeof parsed?.updatedAt !== "number" ||
			Date.now() - parsed.updatedAt > maxAgeMs
		) {
			await rm(filePath, { force: true });
			return { draft: null };
		}

		return { draft: parsed };
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return { draft: null };
		}

		await rm(filePath, { force: true }).catch(() => {});
		return { draft: null };
	}
};

const saveDraft = async ({
	draft,
	draftsDirPath,
	noteKey,
	storedKeyField,
	version,
	maxAgeMs,
	label,
}) => {
	await pruneDrafts({ draftsDirPath, maxAgeMs, label });
	await ensureDraftsDir(draftsDirPath);

	await writeFile(
		getDraftPath({ draftsDirPath, noteKey }),
		JSON.stringify(
			{
				...draft,
				version,
				[storedKeyField]: noteKey,
				updatedAt: Date.now(),
			},
			null,
			2,
		),
		"utf8",
	);

	return { ok: true };
};

const clearDraft = async ({ draftsDirPath, noteKey }) => {
	await rm(getDraftPath({ draftsDirPath, noteKey }), { force: true });
	return { ok: true };
};

export const createDesktopStorage = ({
	transcriptDraftsDirPath,
	noteDraftsDirPath,
}) => {
	const sharedLocalFolders = new Map();

	return {
		getSharedLocalFolders: (ids) =>
			ids
				.map((id) => sharedLocalFolders.get(id))
				.filter(Boolean)
				.map(toSharedLocalFolderPayload),
		shareLocalFolders: async (paths) => {
			if (!Array.isArray(paths)) {
				throw new Error("Local folder paths must be an array.");
			}

			if (paths.length > maxLocalFolderShareRequestPaths) {
				throw new Error(
					`At most ${maxLocalFolderShareRequestPaths} local folders can be shared at once.`,
				);
			}

			const folders = [];

			for (const value of paths) {
				if (typeof value !== "string" || !value.trim()) {
					continue;
				}

				const requestedPath = value.trim();

				if (requestedPath.length > maxLocalFolderPathLength) {
					throw new Error("Local folder path is too long.");
				}

				const folderPath = await realpath(requestedPath);
				const folderStat = await stat(folderPath);

				if (!folderStat.isDirectory()) {
					throw new Error("Only folders can be shared with Ask AI.");
				}

				const folder = {
					id: createLocalFolderId(folderPath),
					name: folderPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? folderPath,
					path: folderPath,
				};

				sharedLocalFolders.set(folder.id, folder);
				folders.push(toSharedLocalFolderPayload(folder));
			}

			while (sharedLocalFolders.size > maxSharedLocalFolders) {
				const firstKey = sharedLocalFolders.keys().next().value;
				if (!firstKey) {
					break;
				}
				sharedLocalFolders.delete(firstKey);
			}

			return { folders };
		},
		loadTranscriptDraft: (noteKey) =>
			loadDraft({
				draftsDirPath: transcriptDraftsDirPath,
				label: "transcript",
				maxAgeMs: transcriptDraftMaxAgeMs,
				noteKey,
				storedKeyField: "noteKey",
				version: transcriptDraftStorageVersion,
			}),
		saveTranscriptDraft: ({ noteKey, draft }) =>
			saveDraft({
				draft,
				draftsDirPath: transcriptDraftsDirPath,
				label: "transcript",
				maxAgeMs: transcriptDraftMaxAgeMs,
				noteKey,
				storedKeyField: "noteKey",
				version: transcriptDraftStorageVersion,
			}),
		clearTranscriptDraft: (noteKey) =>
			clearDraft({ draftsDirPath: transcriptDraftsDirPath, noteKey }),
		loadNoteDraft: (noteKey) =>
			loadDraft({
				draftsDirPath: noteDraftsDirPath,
				label: "note",
				maxAgeMs: noteDraftMaxAgeMs,
				noteKey,
				storedKeyField: "noteId",
				version: noteDraftStorageVersion,
			}),
		saveNoteDraft: ({ noteKey, draft }) =>
			saveDraft({
				draft,
				draftsDirPath: noteDraftsDirPath,
				label: "note",
				maxAgeMs: noteDraftMaxAgeMs,
				noteKey,
				storedKeyField: "noteId",
				version: noteDraftStorageVersion,
			}),
		clearNoteDraft: (noteKey) =>
			clearDraft({ draftsDirPath: noteDraftsDirPath, noteKey }),
	};
};
