import { describe, expect, it } from "vitest";
import {
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
	loadSelectedAppSourceConnections,
} from "../../../packages/ai/src/capability-metadata.mjs";

describe("chat source selection", () => {
	it("treats empty selection as no external context", () => {
		expect(getSelectedAppSourceIds([])).toEqual([]);
		expect(getSelectedNoteSourceIds({ mentions: [] })).toEqual([]);
	});

	it("loads only explicitly selected app sources", () => {
		expect(getSelectedAppSourceIds(["app:notion", "note-1"])).toEqual([
			"app:notion",
		]);
	});

	it("loads only explicitly selected or mentioned notes", () => {
		expect(
			getSelectedNoteSourceIds({
				mentions: ["note-1"],
			}),
		).toEqual(["note-1"]);
	});

	it("loads selected Google sources without app connection lookups", async () => {
		const connections = await loadSelectedAppSourceConnections({
			selectedSourceIds: ["app:google-drive"],
			listGoogleSources: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
				},
				{
					id: "app:google-drive",
					provider: "google-drive",
					title: "Google Drive",
				},
			],
			getAppConnections: async () => {
				throw new Error("app connections should not load");
			},
		});

		expect(connections).toEqual([
			{
				id: "app:google-drive",
				provider: "google-drive",
				title: "Google Drive",
			},
		]);
	});

	it("loads selected app connections and Google sources with one policy", async () => {
		const connections = await loadSelectedAppSourceConnections({
			selectedSourceIds: ["app:notion", "app:google-calendar"],
			listGoogleSources: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
				},
			],
			getAppConnections: async (sourceIds) =>
				sourceIds.map((id) => ({
					id,
					provider: id.replace("app:", ""),
					displayName: "Notion workspace",
				})),
		});

		expect(connections).toEqual([
			{
				id: "app:notion",
				provider: "notion",
				displayName: "Notion workspace",
			},
			{
				id: "app:google-calendar",
				provider: "google-calendar",
				title: "Google Calendar",
			},
		]);
	});

	it("tolerates Google source listing failures", async () => {
		await expect(
			loadSelectedAppSourceConnections({
				selectedSourceIds: ["app:google-drive"],
				listGoogleSources: async () => {
					throw new Error("Google unavailable");
				},
			}),
		).resolves.toEqual([]);
	});
});
