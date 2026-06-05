import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopStorage } from "../src/desktop-storage.mjs";

const createTestStorage = async () => {
	const rootDir = await mkdtemp(join(tmpdir(), "graneri-desktop-storage-"));

	return {
		rootDir,
		storage: createDesktopStorage({
			noteDraftsDirPath: join(rootDir, "note-drafts"),
			transcriptDraftsDirPath: join(rootDir, "transcript-drafts"),
		}),
	};
};

test("stores and clears transcript drafts", async () => {
	const { storage } = await createTestStorage();
	const noteKey = "note:test";
	const draft = {
		liveTranscript: {
			them: { speaker: "them", startedAt: null, text: "" },
			you: { speaker: "you", startedAt: 10, text: "hello" },
		},
		pendingGenerateTranscript: "hello",
		utterances: [],
	};

	await storage.saveTranscriptDraft({ noteKey, draft });

	const loaded = await storage.loadTranscriptDraft(noteKey);
	assert.equal(loaded.draft.noteKey, noteKey);
	assert.equal(loaded.draft.version, 1);
	assert.equal(loaded.draft.pendingGenerateTranscript, "hello");
	assert.equal(typeof loaded.draft.updatedAt, "number");

	await storage.clearTranscriptDraft(noteKey);
	assert.deepEqual(await storage.loadTranscriptDraft(noteKey), { draft: null });
});

test("stores and clears note drafts", async () => {
	const { storage } = await createTestStorage();
	const noteKey = "note_123";
	const draft = {
		content: "{}",
		searchableText: "meeting notes",
		title: "Meeting notes",
		workspaceId: "workspace_123",
	};

	await storage.saveNoteDraft({ noteKey, draft });

	const loaded = await storage.loadNoteDraft(noteKey);
	assert.equal(loaded.draft.noteId, noteKey);
	assert.equal(loaded.draft.version, 1);
	assert.equal(loaded.draft.title, "Meeting notes");
	assert.equal(typeof loaded.draft.updatedAt, "number");

	await storage.clearNoteDraft(noteKey);
	assert.deepEqual(await storage.loadNoteDraft(noteKey), { draft: null });
});

test("shares local folders and returns shared folders by id", async () => {
	const { rootDir, storage } = await createTestStorage();
	const sharedDir = join(rootDir, "shared");
	await mkdir(sharedDir);
	const sharedRealPath = await realpath(sharedDir);

	const result = await storage.shareLocalFolders([sharedDir]);
	assert.equal(result.folders.length, 1);
	assert.equal(result.folders[0].name, "shared");
	assert.equal(result.folders[0].path, sharedRealPath);

	assert.deepEqual(storage.getSharedLocalFolders([result.folders[0].id]), [
		result.folders[0],
	]);
});
