import { readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { protocol } from "electron";
import { isRendererAppRoutePath } from "../../../packages/platform/src/renderer-routes.mjs";

const appProtocolScheme = "app";
const appProtocolHost = "ui";

const mimeTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

export const appRendererOrigin = `${appProtocolScheme}://${appProtocolHost}`;

export const isDesktopAppProtocolUrl = (url) =>
	url.protocol === `${appProtocolScheme}:` && url.host === appProtocolHost;

export const isSameRendererUrl = (nextUrl, rendererUrl) =>
	isDesktopAppProtocolUrl(rendererUrl)
		? isDesktopAppProtocolUrl(nextUrl)
		: nextUrl.origin === rendererUrl.origin;

export const registerDesktopAppProtocolScheme = () => {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: appProtocolScheme,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
			},
		},
	]);
};

const createForbiddenResponse = () =>
	new Response("Forbidden", {
		status: 403,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});

const createNotFoundResponse = () =>
	new Response("Not found", {
		status: 404,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});

const resolveAssetPath = (pathname, rendererDistDir) => {
	let decodedPathname;
	try {
		decodedPathname = decodeURIComponent(pathname);
	} catch {
		return null;
	}

	const relativePath = decodedPathname.replace(/^\/+/u, "");
	const assetPath = resolve(rendererDistDir, relativePath);
	const relativeAssetPath = relative(rendererDistDir, assetPath);

	if (relativeAssetPath.startsWith("..") || isAbsolute(relativeAssetPath)) {
		return null;
	}

	return assetPath;
};

const tryCreateFileResponse = (filePath) => {
	let fileContents;
	try {
		fileContents = readFileSync(filePath);
	} catch {
		return null;
	}

	return new Response(fileContents, {
		headers: {
			"Content-Type":
				mimeTypes[extname(filePath)] ?? "application/octet-stream",
		},
	});
};

export const registerDesktopAppProtocol = ({
	protocolRegistrar = protocol,
	rendererDistDir,
}) => {
	protocolRegistrar.handle(appProtocolScheme, async (request) => {
		const url = new URL(request.url);

		if (url.host !== appProtocolHost) {
			return createForbiddenResponse();
		}

		const assetPath = resolveAssetPath(url.pathname, rendererDistDir);
		if (!assetPath) {
			return createForbiddenResponse();
		}

		const assetResponse = tryCreateFileResponse(assetPath);
		if (assetResponse) {
			return assetResponse;
		}

		if (isRendererAppRoutePath(url.pathname)) {
			const indexResponse = tryCreateFileResponse(
				resolve(rendererDistDir, "index.html"),
			);
			if (indexResponse) {
				return indexResponse;
			}
		}

		return createNotFoundResponse();
	});
};

export const registerDesktopAppProtocols = ({
	protocolRegistrars,
	rendererDistDir,
}) => {
	for (const protocolRegistrar of protocolRegistrars) {
		registerDesktopAppProtocol({ protocolRegistrar, rendererDistDir });
	}
};
