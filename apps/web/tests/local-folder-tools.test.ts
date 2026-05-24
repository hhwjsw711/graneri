import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
	getImageMediaType,
	getTranscriptionMediaType,
} from "../../../packages/ai/src/local-folder-tools.mjs";

describe("local folder tools", () => {
	it("instructs the model to use tools for shared local path questions", () => {
		const context = buildLocalFolderSystemContext([
			{
				name: "shared",
				path: "/Users/test/Documents/shared",
			},
		]);

		expect(context).toContain("use the local folder tools before answering");
		expect(context).toContain("do not ask the user to run terminal commands");
		expect(context).toContain("Do not use connected app tools");
		expect(context).toContain("local audio");
		expect(context).toContain("For local images");
		expect(context).toContain("run_local_bash");
	});

	it("exposes a sandboxed local audio transcription tool", async () => {
		const directory = await mkdtemp(join(tmpdir(), "opengran-local-tools-"));
		try {
			const filePath = join(directory, "notes.txt");
			await writeFile(filePath, "not audio");

			const tools = buildLocalFolderTools([
				{
					name: "shared",
					path: directory,
				},
			]);

			expect(Object.keys(tools)).toContain("transcribe_local_audio");
			await expect(
				tools.transcribe_local_audio.execute?.(
					{
						rootIndex: 0,
						relativePath: "notes.txt",
					},
					{
						messages: [],
						toolCallId: "test",
					},
				),
			).rejects.toThrow(
				"Only supported audio or video files can be transcribed",
			);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("rejects local audio files that exceed the source transcription size cap", async () => {
		const directory = await mkdtemp(join(tmpdir(), "opengran-local-tools-"));
		try {
			const filePath = join(directory, "large.m4a");
			await writeFile(filePath, "");
			await truncate(filePath, 250_000_001);

			const tools = buildLocalFolderTools([
				{
					name: "shared",
					path: directory,
				},
			]);

			await expect(
				tools.transcribe_local_audio.execute?.(
					{
						rootIndex: 0,
						relativePath: "large.m4a",
					},
					{
						messages: [],
						toolCallId: "test",
					},
				),
			).rejects.toThrow("Audio file is too large to transcribe directly");
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("uses explicit media types for OpenAI transcription uploads", () => {
		expect(getTranscriptionMediaType("meeting.m4a")).toBe("audio/mp4");
		expect(getTranscriptionMediaType("meeting.mp4")).toBe("video/mp4");
		expect(getTranscriptionMediaType("meeting.mp3")).toBe("audio/mpeg");
		expect(getTranscriptionMediaType("meeting.wav")).toBe("audio/wav");
	});

	it("exposes local image inspection and semantic search tools", async () => {
		const directory = await mkdtemp(join(tmpdir(), "opengran-local-tools-"));
		try {
			await writeFile(join(directory, "notes.txt"), "not an image");

			const tools = buildLocalFolderTools([
				{
					name: "shared",
					path: directory,
				},
			]);

			expect(Object.keys(tools)).toContain("inspect_local_image");
			expect(Object.keys(tools)).toContain("search_local_images");
			expect(getImageMediaType("screen.png")).toBe("image/png");
			expect(getImageMediaType("photo.jpg")).toBe("image/jpeg");
			await expect(
				tools.inspect_local_image.execute?.(
					{
						rootIndex: 0,
						relativePath: "notes.txt",
					},
					{
						messages: [],
						toolCallId: "test",
					},
				),
			).rejects.toThrow("Only supported image files can be inspected");
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("marks local folder tools as deferred for OpenAI tool search", async () => {
		const directory = await mkdtemp(join(tmpdir(), "opengran-local-tools-"));
		try {
			const tools = buildLocalFolderTools([
				{
					name: "shared",
					path: directory,
				},
			]);

			for (const tool of Object.values(tools)) {
				expect(tool.providerOptions?.openai?.deferLoading).toBe(true);
			}
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("runs bash commands against a text-only virtual snapshot", async () => {
		const directory = await mkdtemp(join(tmpdir(), "opengran-local-tools-"));
		try {
			await writeFile(join(directory, "notes.txt"), "alpha\nbeta\nalpha\n");
			await writeFile(join(directory, "image.png"), "not mounted as text");

			const tools = buildLocalFolderTools([
				{
					name: "shared",
					path: directory,
				},
			]);

			expect(Object.keys(tools)).toContain("run_local_bash");
			const result = await tools.run_local_bash.execute?.(
				{
					rootIndex: 0,
					command: "cat notes.txt",
				},
				{
					messages: [],
					toolCallId: "test",
				},
			);

			expect(result?.stdout).toContain("alpha");
			expect(result?.stdout).not.toContain("image.png");
			expect(result?.snapshot.mountedFileCount).toBe(1);
			expect(result?.snapshot.skippedFileCount).toBe(1);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});
});
