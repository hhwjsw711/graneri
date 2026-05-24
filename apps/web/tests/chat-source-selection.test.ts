import { describe, expect, it } from "vitest";
import {
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
} from "../../../packages/ai/src/app-source-providers.mjs";

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
});
