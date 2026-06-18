import { beforeEach, describe, expect, it } from "vitest";
import {
	clampPanelHeight,
	getCurrentPanelViewportPlatform,
	getNoteScopedStorageKey,
	getNoteScopedStorageKeyForViewport,
	getNoteStorageScopeKey,
	getPanelMaxHeight,
	INLINE_POPOVER_DEFAULT_HEIGHT,
	isMobilePanelViewport,
	NOTE_CHAT_PANEL_MAX_HEIGHT,
	NOTE_CHAT_PANEL_MIN_HEIGHT,
	readStoredPanelHeight,
	storePanelHeight,
} from "@/components/note/note-composer-panel-storage";

describe("note composer panel storage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("builds stable storage keys for draft and persisted notes", () => {
		expect(getNoteStorageScopeKey(null)).toBe("note:draft");
		expect(getNoteStorageScopeKey("note-1")).toBe("note:note-1");
		expect(
			getNoteScopedStorageKey({
				prefix: "graneri.noteComposer.inlinePopoverHeight",
				noteScopeKey: "note:note-1",
				platform: "desktop",
			}),
		).toBe("graneri.noteComposer.inlinePopoverHeight.note:note-1.desktop");
		expect(
			getNoteScopedStorageKeyForViewport({
				prefix: "graneri.noteComposer.inlinePopoverHeight",
				noteScopeKey: "note:draft",
				isMobileViewport: true,
			}),
		).toBe("graneri.noteComposer.inlinePopoverHeight.note:draft.mobile");
	});

	it("reads the first finite stored height and stores all requested keys", () => {
		window.localStorage.setItem("legacy", "not-a-number");
		window.localStorage.setItem("current", "456");

		expect(readStoredPanelHeight(["legacy", "current"], 384)).toBe(456);

		storePanelHeight(["legacy", "current"], 512);

		expect(window.localStorage.getItem("legacy")).toBe("512");
		expect(window.localStorage.getItem("current")).toBe("512");
	});

	it("falls back when no stored panel height is usable", () => {
		window.localStorage.setItem("panel", "Infinity");

		expect(readStoredPanelHeight("panel", INLINE_POPOVER_DEFAULT_HEIGHT)).toBe(
			INLINE_POPOVER_DEFAULT_HEIGHT,
		);
		expect(readStoredPanelHeight("missing", 420)).toBe(420);
	});

	it("clamps panel heights against viewport-derived limits", () => {
		expect(getPanelMaxHeight({ innerHeight: undefined })).toBe(
			NOTE_CHAT_PANEL_MAX_HEIGHT,
		);
		expect(getPanelMaxHeight({ innerHeight: 1000 })).toBe(
			NOTE_CHAT_PANEL_MAX_HEIGHT,
		);
		expect(getPanelMaxHeight({ innerHeight: 520 })).toBe(408);
		expect(getPanelMaxHeight({ innerHeight: 350 })).toBe(
			NOTE_CHAT_PANEL_MIN_HEIGHT,
		);
		expect(clampPanelHeight({ nextHeight: 100, maxHeight: 500 })).toBe(
			NOTE_CHAT_PANEL_MIN_HEIGHT,
		);
		expect(clampPanelHeight({ nextHeight: 640, maxHeight: 500 })).toBe(500);
	});

	it("detects mobile panel viewports by width", () => {
		expect(isMobilePanelViewport({ innerWidth: 767 })).toBe(true);
		expect(isMobilePanelViewport({ innerWidth: 768 })).toBe(false);
		expect(getCurrentPanelViewportPlatform()).toBe("desktop");
	});
});
