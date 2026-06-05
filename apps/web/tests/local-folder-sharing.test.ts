import { afterEach, describe, expect, it, vi } from "vitest";
import {
	requireRehydratedSharedLocalFolders,
	shareLocalFoldersFromText,
	storeSharedLocalFolders,
} from "../src/lib/local-folder-sharing";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("local folder sharing", () => {
	it("does nothing when the prompt has no local path references", async () => {
		window.graneriDesktop = undefined;

		await expect(
			shareLocalFoldersFromText({
				currentFolders: [],
				text: "summarize this note",
			}),
		).resolves.toEqual({
			allFolders: [],
			newFolders: [],
		});
	});

	it("fails instead of dropping local path references when the desktop bridge is unavailable", async () => {
		window.graneriDesktop = undefined;

		await expect(
			shareLocalFoldersFromText({
				currentFolders: [],
				text: "what do you see here? /Users/test/Documents/graneri",
			}),
		).rejects.toThrow("Desktop local folder sharing is unavailable");
	});

	it("registers local path references with the desktop bridge", async () => {
		const shareLocalFolders = vi.fn().mockResolvedValue({
			folders: [
				{
					id: "folder_1",
					name: "graneri",
					path: "/Users/test/Documents/graneri",
				},
			],
		});
		window.graneriDesktop = {
			platform: "darwin",
			shareLocalFolders,
		} as Window["graneriDesktop"];

		await expect(
			shareLocalFoldersFromText({
				currentFolders: [],
				text: "what do you see here? /Users/test/Documents/graneri",
			}),
		).resolves.toEqual({
			allFolders: [
				{
					id: "folder_1",
					name: "graneri",
					path: "/Users/test/Documents/graneri",
				},
			],
			newFolders: [
				{
					id: "folder_1",
					name: "graneri",
					path: "/Users/test/Documents/graneri",
				},
			],
		});
		expect(shareLocalFolders).toHaveBeenCalledWith([
			"/Users/test/Documents/graneri",
		]);
	});

	it("fails strict rehydration instead of reusing stale folders without the desktop bridge", async () => {
		window.graneriDesktop = undefined;
		storeSharedLocalFolders("chat_1", [
			{
				id: "folder_1",
				name: "graneri",
				path: "/Users/test/Documents/graneri",
			},
		]);

		await expect(requireRehydratedSharedLocalFolders("chat_1")).rejects.toThrow(
			"Desktop local folder sharing is unavailable",
		);
	});
});
