import { app } from "electron";
import { createDesktopAuthCookieStore } from "./desktop-auth-cookie-store.mjs";
import { fetchWithRetry } from "./network.mjs";

const cookieStore = createDesktopAuthCookieStore({
	userDataPath: app.getPath("userData"),
});
const authBasePath = "/api/auth";

const getAuthBaseUrl = () => {
	const value = process.env.CONVEX_SITE_URL?.trim();

	if (!value) {
		throw new Error("CONVEX_SITE_URL is not configured.");
	}

	return value;
};

const getAuthOrigin = () => new URL(getAuthBaseUrl()).origin;

const readCookieJars = () => {
	return cookieStore.readCookieJars();
};

const writeCookieJars = (value) => {
	cookieStore.writeCookieJars(value);
};

const readCookieJar = (authOrigin) => {
	const stored = readCookieJars()[authOrigin];
	return stored && typeof stored === "object" ? stored : {};
};

const writeCookieJar = (authOrigin, value) => {
	writeCookieJars({
		...readCookieJars(),
		[authOrigin]: value,
	});
};

const parseSetCookieHeader = (headerValue) => {
	const [nameValue, ...attributeEntries] = headerValue.split(";");
	const [name, ...valueParts] = nameValue.trim().split("=");
	const value = valueParts.join("=");

	if (!name || !value) {
		return null;
	}

	const attributes = {};

	for (const entry of attributeEntries) {
		const [attributeName, ...attributeValueParts] = entry.trim().split("=");
		attributes[attributeName.toLowerCase()] = attributeValueParts.join("=");
	}

	return {
		name,
		value,
		attributes,
	};
};

const getSetCookieHeaders = (headers) => {
	if (typeof headers.getSetCookie === "function") {
		return headers.getSetCookie();
	}

	const combined = headers.get("set-cookie");
	return combined ? [combined] : [];
};

const mergeSetCookieHeaders = (headers, authOrigin) => {
	const nextCookieJar = {
		...readCookieJar(authOrigin),
	};

	for (const headerValue of getSetCookieHeaders(headers)) {
		const parsed = parseSetCookieHeader(headerValue);

		if (!parsed) {
			continue;
		}

		const maxAge =
			typeof parsed.attributes["max-age"] === "string"
				? Number(parsed.attributes["max-age"])
				: null;
		const expires =
			maxAge !== null && Number.isFinite(maxAge)
				? new Date(Date.now() + maxAge * 1000).toISOString()
				: typeof parsed.attributes.expires === "string"
					? new Date(parsed.attributes.expires).toISOString()
					: null;

		nextCookieJar[parsed.name] = {
			value: parsed.value,
			expires,
		};
	}

	writeCookieJar(authOrigin, nextCookieJar);
};

const getCookie = (authOrigin) => {
	const now = Date.now();
	const currentCookieJar = readCookieJar(authOrigin);
	const nextCookieJar = {};
	const cookieParts = [];

	for (const [name, entry] of Object.entries(currentCookieJar)) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.value !== "string"
		) {
			continue;
		}

		if (
			typeof entry.expires === "string" &&
			Number.isFinite(Date.parse(entry.expires)) &&
			Date.parse(entry.expires) <= now
		) {
			continue;
		}

		nextCookieJar[name] = entry;
		cookieParts.push(`${name}=${entry.value}`);
	}

	writeCookieJar(authOrigin, nextCookieJar);
	return cookieParts.join("; ");
};

const parseResponse = async (response) => {
	if (response.status === 204) {
		return null;
	}

	const contentType = response.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		return await response.json();
	}

	const text = await response.text();
	return text ? text : null;
};

const toAbsoluteUrl = (path) =>
	new URL(`${authBasePath}${path}`, getAuthBaseUrl()).toString();

const createAuthRequestError = (message, status, statusText) => {
	const error = new Error(message);
	error.status = status;
	error.statusText = statusText;
	return error;
};

const authFetch = async (path, options = {}) => {
	const requestHeaders = new Headers(options.headers ?? {});
	const authBaseUrl = getAuthBaseUrl();
	const authOrigin = getAuthOrigin();
	const cookie = getCookie(authOrigin);
	const method = options.method ?? "GET";

	if (cookie && !requestHeaders.has("cookie")) {
		requestHeaders.set("cookie", cookie);
	}

	if (!requestHeaders.has("origin")) {
		requestHeaders.set("origin", authOrigin);
	}

	if (!requestHeaders.has("referer")) {
		requestHeaders.set("referer", `${authBaseUrl.replace(/\/$/u, "")}/`);
	}

	const request = {
		method,
		headers: requestHeaders,
		body: options.body,
		redirect: "follow",
	};
	const response =
		method === "GET" || method === "HEAD"
			? await fetchWithRetry(toAbsoluteUrl(path), request)
			: await fetch(toAbsoluteUrl(path), request);

	mergeSetCookieHeaders(response.headers, authOrigin);

	const data = await parseResponse(response);

	if (!response.ok && options.throw) {
		const message =
			data &&
			typeof data === "object" &&
			"message" in data &&
			typeof data.message === "string"
				? data.message
				: response.statusText || "Request failed.";

		throw createAuthRequestError(message, response.status, response.statusText);
	}

	return data;
};

export const getDesktopAuthClient = () => ({
	getCookie: () => getCookie(getAuthOrigin()),
	$fetch: authFetch,
});
