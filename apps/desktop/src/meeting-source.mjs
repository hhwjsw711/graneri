import { execFile } from "node:child_process";

const browserAppNames = new Set([
	"Arc",
	"Brave Browser",
	"Chromium",
	"Google Chrome",
	"Microsoft Edge",
	"Safari",
]);
const browserProviderLookupOrder = [
	"Arc",
	"Google Chrome",
	"Safari",
	"Brave Browser",
	"Microsoft Edge",
	"Chromium",
];

const desktopSourceNames = new Map([
	["FaceTime", "FaceTime"],
	["Microsoft Teams", "Microsoft Teams"],
	["Slack", "Slack Huddle"],
	["WhatsApp", "WhatsApp"],
	["zoom.us", "Zoom"],
]);

export const normalizeMeetingDetectionSourceName = (value) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const normalizePathname = (pathname) => {
	const normalizedPathname = pathname.replace(/\/+$/, "");
	return normalizedPathname.length > 0 ? normalizedPathname : "/";
};

const isGoogleMeetCodePath = (pathname) =>
	/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(normalizePathname(pathname));

const isGoogleMeetLookupPath = (pathname) =>
	/^\/lookup\/[\w.-]+$/i.test(normalizePathname(pathname));

export const getMeetingProviderNameFromUrl = (value) => {
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}

	let parsedUrl;
	try {
		parsedUrl = new URL(value);
	} catch {
		return null;
	}

	if (parsedUrl.protocol !== "https:") {
		return null;
	}

	const hostname = parsedUrl.hostname.toLowerCase();
	if (
		hostname === "meet.google.com" &&
		(isGoogleMeetCodePath(parsedUrl.pathname) ||
			isGoogleMeetLookupPath(parsedUrl.pathname))
	) {
		return "Google Meet";
	}

	if (
		hostname === "telemost.yandex.ru" ||
		hostname === "telemost.360.yandex.ru"
	) {
		return "Yandex Telemost";
	}

	if (
		hostname.endsWith(".zoom.us") &&
		(parsedUrl.pathname.startsWith("/j/") ||
			parsedUrl.pathname.startsWith("/wc/") ||
			parsedUrl.pathname.startsWith("/s/"))
	) {
		return "Zoom";
	}

	if (
		(hostname === "teams.microsoft.com" ||
			hostname.endsWith(".teams.microsoft.com")) &&
		(parsedUrl.pathname.includes("/meet") ||
			parsedUrl.pathname.includes("/l/meetup-join"))
	) {
		return "Microsoft Teams";
	}

	return null;
};

export const getBrowserActiveTabUrlScript = (appName) => {
	const escapedAppName = appName
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"');

	if (appName === "Safari") {
		return `tell application "${escapedAppName}" to if (count of windows) > 0 then get URL of current tab of front window`;
	}

	return `tell application "${escapedAppName}" to if (count of windows) > 0 then get URL of active tab of front window`;
};

export const runAppleScript = (script, timeoutMs = 750) =>
	new Promise((resolvePromise) => {
		const child = execFile(
			"osascript",
			["-e", script],
			{ timeout: timeoutMs, windowsHide: true },
			(error, stdout) => {
				if (error) {
					resolvePromise(null);
					return;
				}

				const value = stdout.trim();
				resolvePromise(value.length > 0 ? value : null);
			},
		);

		child.on("error", () => resolvePromise(null));
	});

export const resolveNativeMeetingDetectionSourceName = async (value) => {
	const sourceName = normalizeMeetingDetectionSourceName(value);
	if (!sourceName) {
		return null;
	}

	const desktopSourceName = desktopSourceNames.get(sourceName);
	if (desktopSourceName) {
		return desktopSourceName;
	}

	if (!browserAppNames.has(sourceName)) {
		if (sourceName.toLowerCase() === "helper") {
			return await resolveActiveBrowserMeetingProviderName();
		}

		return sourceName;
	}

	const activeTabUrl = await runAppleScript(
		getBrowserActiveTabUrlScript(sourceName),
	);
	return getMeetingProviderNameFromUrl(activeTabUrl) ?? null;
};

const resolveActiveBrowserMeetingProviderName = async () => {
	for (const appName of browserProviderLookupOrder) {
		const activeTabUrl = await runAppleScript(
			getBrowserActiveTabUrlScript(appName),
		);
		const providerName = getMeetingProviderNameFromUrl(activeTabUrl);
		if (providerName) {
			return providerName;
		}
	}

	return null;
};
