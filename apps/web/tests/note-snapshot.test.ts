import { describe, expect, it } from "vitest";
import {
	canFlushQueuedNoteSave,
	createNoteSnapshot,
	getFlushableQueuedNoteSave,
	isLatestNoteSaveRequest,
} from "../src/lib/note-snapshot";

describe("note snapshot coordination", () => {
	it("treats only the newest save request as saveable", () => {
		const staleSnapshot = createNoteSnapshot({
			title: "Interview",
			content: '{"type":"doc","content":[{"type":"paragraph"}]}',
			searchableText: "",
		});
		const latestSnapshot = createNoteSnapshot({
			title: "Generated title",
			content:
				'{"type":"doc","content":[{"type":"heading","attrs":{"level":2}}]}',
			searchableText: "Overview\nDecisions\nShip autosave fix",
		});

		expect(
			isLatestNoteSaveRequest({
				requestId: 1,
				latestRequestId: 2,
			}),
		).toBe(false);
		expect(
			isLatestNoteSaveRequest({
				requestId: 2,
				latestRequestId: 2,
			}),
		).toBe(true);
		expect(staleSnapshot).not.toBe(latestSnapshot);
	});

	it("flushes only queued snapshots that are still current and unsaved", () => {
		const staleSnapshot = createNoteSnapshot({
			title: "Interview",
			content: '{"type":"doc","content":[{"type":"paragraph"}]}',
			searchableText: "",
		});
		const latestSnapshot = createNoteSnapshot({
			title: "Generated title",
			content:
				'{"type":"doc","content":[{"type":"heading","attrs":{"level":2}}]}',
			searchableText: "Overview\nDecisions\nShip autosave fix",
		});

		expect(
			canFlushQueuedNoteSave({
				queuedRequestId: 1,
				latestRequestId: 2,
				queuedSnapshot: staleSnapshot,
				lastSavedSnapshot: null,
			}),
		).toBe(false);

		expect(
			canFlushQueuedNoteSave({
				queuedRequestId: 2,
				latestRequestId: 2,
				queuedSnapshot: latestSnapshot,
				lastSavedSnapshot: null,
			}),
		).toBe(true);

		expect(
			canFlushQueuedNoteSave({
				queuedRequestId: 2,
				latestRequestId: 2,
				queuedSnapshot: latestSnapshot,
				lastSavedSnapshot: latestSnapshot,
			}),
		).toBe(false);
	});

	it("returns only the queued save that should run after the in-flight save", () => {
		const latestSnapshot = createNoteSnapshot({
			title: "Generated title",
			content:
				'{"type":"doc","content":[{"type":"heading","attrs":{"level":2}}]}',
			searchableText: "Overview\nDecisions\nShip autosave fix",
		});
		const queuedSave = {
			requestId: 2,
			snapshot: latestSnapshot,
			payload: {
				title: "Generated title",
			},
		};

		expect(
			getFlushableQueuedNoteSave({
				queuedSave,
				latestRequestId: 2,
				lastSavedSnapshot: null,
			}),
		).toBe(queuedSave);
		expect(
			getFlushableQueuedNoteSave({
				queuedSave,
				latestRequestId: 3,
				lastSavedSnapshot: null,
			}),
		).toBeNull();
		expect(
			getFlushableQueuedNoteSave({
				queuedSave,
				latestRequestId: 2,
				lastSavedSnapshot: latestSnapshot,
			}),
		).toBeNull();
		expect(
			getFlushableQueuedNoteSave({
				queuedSave: null,
				latestRequestId: 2,
				lastSavedSnapshot: null,
			}),
		).toBeNull();
	});
});
