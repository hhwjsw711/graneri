import assert from "node:assert/strict";
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
