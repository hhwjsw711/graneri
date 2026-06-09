export const readJsonBody = async (request) => {
	const chunks = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}

	const rawBody = Buffer.concat(chunks).toString("utf8");

	if (!rawBody) {
		return {};
	}

	return JSON.parse(rawBody);
};

export const sendJson = (response, statusCode, payload) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(payload));
};

export const getRequestOrigin = (request) => {
	const originHeader = request.headers.origin;
	if (typeof originHeader === "string" && originHeader.length > 0) {
		return originHeader.replace(/\/$/, "");
	}

	const refererHeader = request.headers.referer;
	if (typeof refererHeader !== "string" || refererHeader.length === 0) {
		return null;
	}

	try {
		return new URL(refererHeader).origin;
	} catch {
		return null;
	}
};

export const getAllowedLocalAppOrigins = (allowedOrigins) =>
	new Set(
		allowedOrigins
			.map((origin) => (typeof origin === "string" ? origin.trim() : ""))
			.filter(Boolean)
			.map((origin) => origin.replace(/\/$/, "")),
	);

export const isAuthorizedLocalAppRequest = (request, allowedOrigins) => {
	const origins = getAllowedLocalAppOrigins(allowedOrigins);
	if (origins.size === 0) {
		return false;
	}

	const requestOrigin = getRequestOrigin(request);
	return requestOrigin !== null && origins.has(requestOrigin);
};

export const setCorsHeadersForLocalAppRequest = (
	request,
	response,
	allowedOrigins,
) => {
	const origins = getAllowedLocalAppOrigins(allowedOrigins);
	const requestOrigin = getRequestOrigin(request);

	if (requestOrigin === null || !origins.has(requestOrigin)) {
		return false;
	}

	response.setHeader("Access-Control-Allow-Origin", requestOrigin);
	response.setHeader("Vary", "Origin");
	response.setHeader("Access-Control-Allow-Credentials", "true");
	response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	response.setHeader(
		"Access-Control-Allow-Headers",
		request.headers["access-control-request-headers"] ?? "content-type",
	);
	return true;
};
