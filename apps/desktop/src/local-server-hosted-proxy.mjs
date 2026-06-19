import { Readable } from "node:stream";

const getHostedApiBaseUrl = () => process.env.SITE_URL?.trim() || "";

export const shouldProxyHostedAiRequest = () =>
	!process.env.OPENAI_API_KEY && Boolean(getHostedApiBaseUrl());

export const proxyHostedAiRequest = async ({
	path,
	request,
	response,
	bodyOverride,
	headersOverride,
	responseMode = "stream",
}) => {
	const baseUrl = getHostedApiBaseUrl();

	if (!baseUrl) {
		throw new Error("SITE_URL is not configured.");
	}

	const proxyHeaders = new Headers();

	for (const [key, value] of Object.entries(request.headers)) {
		if (value == null || key.toLowerCase() === "host") {
			continue;
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				proxyHeaders.append(key, entry);
			}
			continue;
		}

		proxyHeaders.set(key, value);
	}

	for (const [key, value] of Object.entries(headersOverride ?? {})) {
		if (value == null) {
			proxyHeaders.delete(key);
			continue;
		}

		proxyHeaders.set(key, value);
	}

	const proxyResponse = await fetch(new URL(path, baseUrl), {
		method: request.method,
		headers: proxyHeaders,
		body:
			bodyOverride ??
			(request.method === "GET" || request.method === "HEAD"
				? undefined
				: Readable.toWeb(request)),
		duplex: "half",
	});

	response.statusCode = proxyResponse.status;

	if (responseMode === "bufferedJson") {
		const responseText = await proxyResponse.text();
		response.setHeader(
			"Content-Type",
			proxyResponse.headers.get("content-type") || "application/json",
		);
		response.end(responseText);
		return;
	}

	for (const [key, value] of proxyResponse.headers.entries()) {
		response.setHeader(key, value);
	}

	if (!proxyResponse.body) {
		response.end();
		return;
	}

	Readable.fromWeb(proxyResponse.body).pipe(response);
};
