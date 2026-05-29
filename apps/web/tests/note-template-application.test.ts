import { describe, expect, it, vi } from "vitest";
import {
	requestEnhancedStructuredNote,
	requestTemplateStructuredNote,
} from "../src/lib/note-template-application";

const createNdjsonResponse = (lines: string[]) =>
	new Response(
		new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				for (const line of lines) {
					controller.enqueue(encoder.encode(`${line}\n`));
				}
				controller.close();
			},
		}),
		{ status: 200 },
	);

describe("note template application requests", () => {
	it("requests enhanced structured notes", async () => {
		const note = {
			title: "Weekly sync",
			overview: ["Reviewed progress"],
			sections: [],
		};
		const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json({
				note,
			}),
		);

		await expect(
			requestEnhancedStructuredNote(
				{
					title: "Weekly sync",
					noteText: "Reviewed progress",
				},
				{ fetcher },
			),
		).resolves.toEqual(note);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/enhance-note",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					title: "Weekly sync",
					noteText: "Reviewed progress",
				}),
			}),
		);
	});

	it("parses streamed template rewrites and reports accumulated markdown", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
			createNdjsonResponse([
				JSON.stringify({ type: "text-delta", delta: "Intro" }),
				JSON.stringify({ type: "text-delta", delta: "\n- Item" }),
				JSON.stringify({
					type: "final-note",
					note: {
						overview: ["Intro"],
						sections: [{ title: "Next", items: ["Item"] }],
					},
				}),
			]),
		);
		const markdownUpdates: string[] = [];

		await expect(
			requestTemplateStructuredNote({
				title: "Weekly sync",
				noteText: "Intro",
				template: {
					slug: "weekly-team-meeting",
					name: "Weekly",
					meetingContext: "Team sync",
					sections: [],
				},
				onMarkdown: (markdown) => {
					markdownUpdates.push(markdown);
				},
				fetcher,
			}),
		).resolves.toEqual({
			overview: ["Intro"],
			sections: [{ title: "Next", items: ["Item"] }],
		});
		expect(markdownUpdates).toEqual(["Intro", "Intro\n- Item"]);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/apply-template",
			expect.objectContaining({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/x-ndjson",
				},
			}),
		);
	});
});
