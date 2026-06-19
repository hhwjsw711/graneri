import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import { startLocalServer } from "../src/local-server.mjs";

test("enhance-note hosted proxy does not forward stale body encoding headers", async () => {
	const originalFetch = globalThis.fetch;
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	const upstreamBody = {
		note: {
			title: "Generated note",
			overview: ["Summary"],
			sections: [{ title: "Details", items: ["Item"] }],
		},
	};

	process.env.SITE_URL = "https://example.com";
	delete process.env.OPENAI_API_KEY;

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.com") {
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

		if (originalSiteUrl === undefined) {
			delete process.env.SITE_URL;
		} else {
			process.env.SITE_URL = originalSiteUrl;
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
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	let hostedFetchCount = 0;

	process.env.SITE_URL = "https://example.com";
	delete process.env.OPENAI_API_KEY;

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.com") {
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

		if (originalSiteUrl === undefined) {
			delete process.env.SITE_URL;
		} else {
			process.env.SITE_URL = originalSiteUrl;
		}

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("chat steer requests are proxied to the hosted steer route", async () => {
	const originalFetch = globalThis.fetch;
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	let hostedFetchCount = 0;

	process.env.SITE_URL = "https://example.com";
	delete process.env.OPENAI_API_KEY;

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.com") {
			return await originalFetch(input, init);
		}

		hostedFetchCount += 1;
		assert.equal(url.pathname, "/api/chat/steer");
		const forwardedBody = JSON.parse(String(init?.body ?? "{}"));
		assert.equal(forwardedBody.continueRunId, "run_1");
		assert.equal(forwardedBody.steerQueuedMessageId, "queued_1");
		return new Response("event: finish\ndata: {}\n\n", {
			status: 200,
			headers: {
				"content-type": "text/event-stream",
				"x-graneri-steer-accepted": "true",
				"x-graneri-turn-id": "run_1",
				"x-graneri-queued-message-id": "queued_1",
			},
		});
	};

	try {
		server = await startLocalServer();
		const response = await originalFetch(`${server.origin}/api/chat/steer`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				continueRunId: "run_1",
				steerQueuedMessageId: "queued_1",
			}),
		});

		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-graneri-steer-accepted"), "true");
		assert.equal(response.headers.get("x-graneri-turn-id"), "run_1");
		assert.equal(
			response.headers.get("x-graneri-queued-message-id"),
			"queued_1",
		);
		assert.equal(hostedFetchCount, 1);
	} finally {
		await server?.close();
		globalThis.fetch = originalFetch;

		if (originalSiteUrl === undefined) {
			delete process.env.SITE_URL;
		} else {
			process.env.SITE_URL = originalSiteUrl;
		}

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat steer rejects empty active run ids before Convex", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	let convexClientCreated = false;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer({
			createConvexClient: () => {
				convexClientCreated = true;
				throw new Error("Convex must not be reached for invalid steering.");
			},
		});
		const response = await fetch(`${server.origin}/api/chat/steer`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				continueRunId: "",
				steerQueuedMessageId: "queued_1",
			}),
		});

		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), {
			error: "continueRunId must be a non-empty string.",
			errorCode: "continue_run_id_invalid",
		});
		assert.equal(convexClientCreated, false);
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat steer returns structured Convex queue errors", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		let queryCount = 0;
		server = await startLocalServer({
			createConvexClient: () => ({
				async query(_functionRef, args) {
					queryCount += 1;
					if (queryCount === 1 && "workspaceId" in args && "chatId" in args) {
						return { model: "gpt-5.4", title: "Existing chat" };
					}
					throw {
						data: {
							code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
							message: "Chat has multiple active assistant runs.",
						},
					};
				},
				async mutation() {
					throw new Error("Mutation must not be reached.");
				},
			}),
		});
		const response = await fetch(`${server.origin}/api/chat/steer`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
				model: "gpt-5.4",
				continueRunId: "run_1",
				steerQueuedMessageId: "queued_1",
			}),
		});

		assert.equal(response.status, 409);
		assert.deepEqual(await response.json(), {
			error: "Chat has multiple active assistant runs.",
			errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
		});
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat stop returns structured Convex lifecycle errors", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer({
			createConvexClient: () => ({
				async query() {
					throw {
						data: {
							code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
							message: "Chat has multiple active assistant runs.",
						},
					};
				},
				async mutation() {
					throw new Error("Mutation must not be reached.");
				},
			}),
		});
		const response = await fetch(`${server.origin}/api/chat/stop`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
			}),
		});

		assert.equal(response.status, 409);
		assert.deepEqual(await response.json(), {
			error: "Chat has multiple active assistant runs.",
			errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
		});
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat reconnect returns structured Convex lifecycle errors", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer({
			createConvexClient: () => ({
				async query() {
					throw {
						data: {
							code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
							message: "Chat has multiple active assistant runs.",
						},
					};
				},
				async mutation() {
					throw new Error("Mutation must not be reached.");
				},
			}),
		});
		const response = await fetch(
			`${server.origin}/api/chat/chat_1/stream?workspaceId=workspace_1`,
			{
				method: "GET",
				headers: {
					authorization: "Bearer test-convex-token",
					origin: server.origin,
				},
			},
		);

		assert.equal(response.status, 409);
		assert.deepEqual(await response.json(), {
			error: "Chat has multiple active assistant runs.",
			errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
		});
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("hosted AI proxy requires SITE_URL instead of falling back to CONVEX_SITE_URL", async () => {
	const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;

	process.env.CONVEX_SITE_URL = "https://example.convex.site";
	delete process.env.SITE_URL;
	delete process.env.OPENAI_API_KEY;

	try {
		server = await startLocalServer();
		const response = await fetch(`${server.origin}/api/chat`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
				model: "gpt-5.4",
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
				messages: [],
			}),
		});

		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), {
			error: "OPENAI_API_KEY is not configured.",
		});
	} finally {
		await server?.close();

		if (originalConvexSiteUrl === undefined) {
			delete process.env.CONVEX_SITE_URL;
		} else {
			process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
		}

		if (originalSiteUrl === undefined) {
			delete process.env.SITE_URL;
		} else {
			process.env.SITE_URL = originalSiteUrl;
		}

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat requests reject unsupported models instead of falling back", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer();
		const response = await fetch(`${server.origin}/api/chat`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
				model: "unsupported-model",
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
				messages: [],
			}),
		});

		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), {
			error: "Unsupported model: unsupported-model.",
		});
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat replay preserves accepted headers after stream start failure", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	const originalConvexUrl = process.env.CONVEX_URL;
	const calls = [];
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";
	process.env.CONVEX_URL = "https://example.convex.cloud";

	try {
		server = await startLocalServer({
			createConvexClient: (convexToken) => ({
				async query(_functionRef, args) {
					calls.push({ args, convexToken, kind: "query" });
					if (calls.length === 1) {
						return {
							model: "gpt-5.4",
							title: "Existing chat",
						};
					}
					if (calls.length === 2) {
						return null;
					}
					if (calls.length === 3) {
						return {
							_id: "queued_1",
							messageId: "message_1",
							partsJson: JSON.stringify([
								{ type: "text", text: "queued replay" },
							]),
							metadataJson: undefined,
						};
					}
					if (calls.length === 4) {
						return [];
					}
					return null;
				},
				async mutation(_functionRef, args) {
					calls.push({ args, convexToken, kind: "mutation" });
					if (calls.length === 8) {
						throw new Error("start failed");
					}
					if (calls.length === 7) {
						return { _id: "run_2" };
					}
					return null;
				},
			}),
		});

		const response = await fetch(`${server.origin}/api/chat`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
				model: "gpt-5.4",
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
			}),
		});

		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), {
			error: "Failed to start assistant stream.",
		});
		assert.equal(response.headers.get(hostedChatReplayAcceptedHeader), "true");
		assert.equal(
			response.headers.get(hostedChatReplayQueuedMessageIdHeader),
			"queued_1",
		);
		assert.deepEqual(calls[5]?.args, {
			workspaceId: "workspace_1",
			chatId: "chat_1",
			noteId: undefined,
			model: "gpt-5.4",
			reasoningEffort: "medium",
			queuedMessageId: "queued_1",
			message: {
				id: "message_1",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "queued replay" }]),
				metadataJson: undefined,
				text: "queued replay",
				createdAt: calls[5]?.args.message.createdAt,
			},
			preview: "queued replay",
			title: undefined,
		});
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}

		if (originalConvexUrl === undefined) {
			delete process.env.CONVEX_URL;
		} else {
			process.env.CONVEX_URL = originalConvexUrl;
		}
	}
});

test("local chat stop terminalizes runs after stream cleanup failure", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	const calls = [];
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer({
			createConvexClient: (convexToken) => ({
				async query(_functionRef, args) {
					calls.push({ args, convexToken, kind: "query" });
					return { _id: "run_1", status: "running" };
				},
				async mutation(_functionRef, args) {
					calls.push({ args, convexToken, kind: "mutation" });
					if ("workspaceId" in args && "chatId" in args && "runId" in args) {
						throw new Error("active stream cleanup failed");
					}
					return null;
				},
			}),
		});

		const response = await fetch(`${server.origin}/api/chat/stop`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
			}),
		});

		assert.equal(response.status, 500);
		assert.deepEqual(
			calls.map((call) => call.args),
			[
				{ workspaceId: "workspace_1", chatId: "chat_1" },
				{ runId: "run_1", stopReason: "user_requested" },
				{
					workspaceId: "workspace_1",
					chatId: "chat_1",
					runId: "run_1",
				},
				{ runId: "run_1" },
			],
		);
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat reconnect interrupts orphaned active runs in direct mode", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	const calls = [];
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer({
			createConvexClient: (convexToken) => ({
				async query(_functionRef, args) {
					calls.push({ args, convexToken, kind: "query" });
					return { _id: "run_1" };
				},
				async mutation(_functionRef, args) {
					calls.push({ args, convexToken, kind: "mutation" });
					return null;
				},
			}),
		});

		const response = await fetch(
			`${server.origin}/api/chat/chat_1/stream?workspaceId=workspace_1`,
			{
				method: "GET",
				headers: {
					authorization: "Bearer test-convex-token",
					origin: server.origin,
				},
			},
		);

		assert.equal(response.status, 204);
		assert.deepEqual(calls, [
			{
				args: { workspaceId: "workspace_1", chatId: "chat_1" },
				convexToken: "test-convex-token",
				kind: "query",
			},
			{
				args: { runId: "run_1", stopReason: "cleanup_failed" },
				convexToken: "test-convex-token",
				kind: "mutation",
			},
			{
				args: {
					workspaceId: "workspace_1",
					chatId: "chat_1",
					runId: "run_1",
				},
				convexToken: "test-convex-token",
				kind: "mutation",
			},
			{
				args: { runId: "run_1" },
				convexToken: "test-convex-token",
				kind: "mutation",
			},
		]);
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}
	}
});

test("local chat reconnect terminalizes orphaned runs after stream cleanup failure", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	const calls = [];
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";

	try {
		server = await startLocalServer({
			createConvexClient: (convexToken) => ({
				async query(_functionRef, args) {
					calls.push({ args, convexToken, kind: "query" });
					return { _id: "run_1" };
				},
				async mutation(_functionRef, args) {
					calls.push({ args, convexToken, kind: "mutation" });
					if ("workspaceId" in args && "chatId" in args && "runId" in args) {
						throw new Error("active stream cleanup failed");
					}
					return null;
				},
			}),
		});

		const response = await fetch(
			`${server.origin}/api/chat/chat_1/stream?workspaceId=workspace_1`,
			{
				method: "GET",
				headers: {
					authorization: "Bearer test-convex-token",
					origin: server.origin,
				},
			},
		);

		assert.equal(response.status, 500);
		assert.deepEqual(
			calls.map((call) => call.args),
			[
				{ workspaceId: "workspace_1", chatId: "chat_1" },
				{ runId: "run_1", stopReason: "cleanup_failed" },
				{
					workspaceId: "workspace_1",
					chatId: "chat_1",
					runId: "run_1",
				},
				{ runId: "run_1" },
			],
		);
	} finally {
		await server?.close();

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
