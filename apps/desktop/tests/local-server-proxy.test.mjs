import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLocalServer } from "../src/local-server.mjs";

test("enhance-note hosted proxy does not forward stale body encoding headers", async () => {
	const originalFetch = globalThis.fetch;
	const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	const upstreamBody = {
		note: {
			title: "Generated note",
			overview: ["Summary"],
			sections: [{ title: "Details", items: ["Item"] }],
		},
	};

	process.env.CONVEX_SITE_URL = "https://example.convex.site";
	delete process.env.OPENAI_API_KEY;

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.convex.site") {
			return await originalFetch(input, init);
		}

		assert.equal(url.pathname, "/api/enhance-note");
		return new Response(JSON.stringify(upstreamBody), {
			status: 200,
			headers: {
				"content-encoding": "gzip",
				"content-type": "application/json",
			},
		});
	};

	try {
		server = await startLocalServer();
		const response = await originalFetch(`${server.origin}/api/enhance-note`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({ transcript: "hello world" }),
		});

		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-encoding"), null);
		assert.deepEqual(await response.json(), upstreamBody);
	} finally {
		await server?.close();
		globalThis.fetch = originalFetch;

		if (originalConvexSiteUrl === undefined) {
			delete process.env.CONVEX_SITE_URL;
		} else {
			process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
		}

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("chat requests with shared local folders are proxied to hosted", async () => {
	const originalFetch = globalThis.fetch;
	const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	let hostedFetchCount = 0;

	process.env.CONVEX_SITE_URL = "https://example.convex.site";
	delete process.env.OPENAI_API_KEY;

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.convex.site") {
			return await originalFetch(input, init);
		}

		hostedFetchCount += 1;
		assert.equal(url.pathname, "/api/chat");
		const forwardedBody = JSON.parse(String(init?.body ?? "{}"));
		assert.deepEqual(forwardedBody.localFolders, [
			{ id: "folder_1", name: "graneri" },
		]);
		return new Response("event: finish\ndata: {}\n\n", {
			status: 200,
			headers: {
				"content-type": "text/event-stream",
			},
		});
	};

	try {
		server = await startLocalServer({
			getSharedLocalFolders: () => [
				{
					id: "folder_1",
					name: "graneri",
					path: "/Users/test/graneri",
				},
			],
		});
		const response = await originalFetch(`${server.origin}/api/chat`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "what is in /Users/test/graneri?" }],
				},
				messages: [],
				localFolders: [{ id: "folder_1", name: "graneri" }],
			}),
		});

		assert.equal(response.status, 200);
		assert.equal(hostedFetchCount, 1);
	} finally {
		await server?.close();
		globalThis.fetch = originalFetch;

		if (originalConvexSiteUrl === undefined) {
			delete process.env.CONVEX_SITE_URL;
		} else {
			process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
		}

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local folder tool requests execute against shared desktop folders", async () => {
	const rootPath = await mkdtemp(join(tmpdir(), "graneri-local-tool-"));
	await writeFile(join(rootPath, "note.txt"), "hello", "utf8");
	let requestedFolderIds = null;
	let server = null;

	try {
		server = await startLocalServer({
			getSharedLocalFolders: (folderIds) => {
				requestedFolderIds = folderIds;
				return [
					{
						id: "folder_1",
						name: "graneri",
						path: rootPath,
					},
				];
			},
		});

		const response = await fetch(`${server.origin}/api/local-folder-tool`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				input: {
					rootIndex: 0,
					relativePath: ".",
				},
				localFolders: [{ id: "folder_1", name: "graneri" }],
				toolCallId: "tool_call_1",
				toolName: "list_local_directory",
			}),
		});

		assert.equal(response.status, 200);
		assert.deepEqual(requestedFolderIds, ["folder_1"]);
		const payload = await response.json();
		assert.equal(payload.output.path, ".");
		assert.equal(payload.output.entries[0].name, "note.txt");
	} finally {
		await server?.close();
		await rm(rootPath, { force: true, recursive: true });
	}
});
