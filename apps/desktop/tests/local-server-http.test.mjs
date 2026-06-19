import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
	getAllowedLocalAppOrigins,
	getRequestOrigin,
	isAuthorizedLocalAppRequest,
	readJsonBody,
	sendJson,
	setCorsHeadersForLocalAppRequest,
} from "../src/local-server-http.mjs";

const createRequest = ({ body = "", headers = {} } = {}) => {
	const request = Readable.from(body ? [body] : []);
	request.headers = headers;
	return request;
};

const createResponse = () => {
	const headers = new Map();
	return {
		body: "",
		headers,
		statusCode: 200,
		end(value = "") {
			this.body = value;
		},
		setHeader(key, value) {
			headers.set(key, value);
		},
	};
};

test("local server HTTP module reads empty and JSON request bodies", async () => {
	assert.deepEqual(await readJsonBody(createRequest()), {});
	assert.deepEqual(
		await readJsonBody(createRequest({ body: JSON.stringify({ ok: true }) })),
		{ ok: true },
	);
});

test("local server HTTP module writes JSON responses", () => {
	const response = createResponse();

	sendJson(response, 403, { error: "Forbidden" }, { "X-Test": "accepted" });

	assert.equal(response.statusCode, 403);
	assert.equal(response.headers.get("Content-Type"), "application/json");
	assert.equal(response.headers.get("X-Test"), "accepted");
	assert.equal(response.body, JSON.stringify({ error: "Forbidden" }));
});

test("local server HTTP module normalizes allowed origins", () => {
	assert.deepEqual(
		getAllowedLocalAppOrigins([
			" http://127.0.0.1:42831/ ",
			"",
			null,
			"app://ui/",
		]),
		new Set(["http://127.0.0.1:42831", "app://ui"]),
	);
});

test("local server HTTP module authorizes origin and referer requests", () => {
	assert.equal(
		getRequestOrigin(
			createRequest({ headers: { origin: "http://127.0.0.1:42831/" } }),
		),
		"http://127.0.0.1:42831",
	);
	assert.equal(
		getRequestOrigin(
			createRequest({
				headers: { referer: "http://127.0.0.1:42831/home?from=test" },
			}),
		),
		"http://127.0.0.1:42831",
	);
	assert.equal(
		isAuthorizedLocalAppRequest(
			createRequest({ headers: { origin: "app://ui" } }),
			["app://ui"],
		),
		true,
	);
	assert.equal(
		isAuthorizedLocalAppRequest(
			createRequest({ headers: { origin: "https://example.com" } }),
			["app://ui"],
		),
		false,
	);
});

test("local server HTTP module sets CORS headers for allowed origins", () => {
	const request = createRequest({
		headers: {
			"access-control-request-headers": "content-type, x-test",
			origin: "app://ui",
		},
	});
	const response = createResponse();

	assert.equal(
		setCorsHeadersForLocalAppRequest(request, response, ["app://ui"]),
		true,
	);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), "app://ui");
	assert.equal(response.headers.get("Vary"), "Origin");
	assert.equal(
		response.headers.get("Access-Control-Allow-Headers"),
		"content-type, x-test",
	);
});
