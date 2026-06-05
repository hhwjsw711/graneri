import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createDesktopAuthCookieStore,
	parseCookieJars,
} from "../src/desktop-auth-cookie-store.mjs";

test("desktop auth cookie store starts empty", () => {
	const userDataPath = mkdtempSync(join(tmpdir(), "graneri-auth-store-"));
	const store = createDesktopAuthCookieStore({ userDataPath });

	assert.deepEqual(store.readCookieJars(), {});
});

test("desktop auth cookie store persists cookie jars without safe storage", () => {
	const userDataPath = mkdtempSync(join(tmpdir(), "graneri-auth-store-"));
	const store = createDesktopAuthCookieStore({ userDataPath });
	const cookieJars = {
		"https://auth.example.com": {
			session: {
				value: "session-value",
				expires: "2026-06-05T12:00:00.000Z",
			},
			refresh: {
				value: "refresh-value",
				expires: null,
			},
		},
	};

	store.writeCookieJars(cookieJars);

	assert.deepEqual(store.readCookieJars(), cookieJars);

	const mode =
		statSync(join(userDataPath, "desktop-auth-cookies.json")).mode & 0o777;
	assert.equal(mode, 0o600);
});

test("desktop auth cookie store parses valid stored shape", () => {
	assert.deepEqual(
		parseCookieJars({
			"https://auth.example.com": {
				session: {
					value: "session-value",
					expires: null,
				},
			},
		}),
		{
			"https://auth.example.com": {
				session: {
					value: "session-value",
					expires: null,
				},
			},
		},
	);
});

test("desktop auth cookie store rejects malformed stored shape", () => {
	assert.throws(
		() =>
			parseCookieJars({
				"https://auth.example.com": {
					session: {
						value: 123,
						expires: null,
					},
				},
			}),
		/Desktop auth cookie entry https:\/\/auth\.example\.com\/session must include a string value/u,
	);
});
