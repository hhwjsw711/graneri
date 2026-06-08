import { execFile } from "node:child_process";
import {
	desktopMeetingBrowserApps,
	getMeetingProviderNameFromUrl,
} from "./meeting-provider-registry.mjs";

export const browserAppNames = new Set(
	desktopMeetingBrowserApps.map((browserApp) => browserApp.appName),
);

const browserProcessNames = new Map(
	desktopMeetingBrowserApps.map((browserApp) => [
		browserApp.appName,
		browserApp.processNames,
	]),
);

const pgrep = (processName, timeoutMs = 500) =>
	new Promise((resolvePromise) => {
		const child = execFile(
			"/usr/bin/pgrep",
			["-x", processName],
			{ timeout: timeoutMs, windowsHide: true },
			(error, stdout) => {
				resolvePromise(!error && stdout.trim().length > 0);
			},
		);

		child.on("error", () => resolvePromise(false));
	});

export const isBrowserAppRunning = async (
	appName,
	{ pgrepImpl = pgrep } = {},
) => {
	const processNames = browserProcessNames.get(appName) ?? [appName];
	for (const processName of processNames) {
		if (await pgrepImpl(processName)) {
			return true;
		}
	}

	return false;
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
					resolvePromise({ ok: false, value: null });
					return;
				}

				const value = stdout.trim();
				resolvePromise({ ok: true, value: value.length > 0 ? value : null });
			},
		);

		child.on("error", () => resolvePromise({ ok: false, value: null }));
	});

const normalizeAppleScriptResult = (result) => ({
	ok: result?.ok === true,
	value:
		typeof result?.value === "string" && result.value.length > 0
			? result.value
			: null,
});

const detectActiveBrowserMeetingProvider = async ({
	isBrowserAppRunningImpl = isBrowserAppRunning,
	runAppleScriptImpl,
}) => {
	let hasSuccessfulQuery = false;
	let hasRunningBrowser = false;

	for (const { appName } of desktopMeetingBrowserApps) {
		if (!(await isBrowserAppRunningImpl(appName))) {
			continue;
		}

		hasRunningBrowser = true;
		const activeTabUrl = normalizeAppleScriptResult(
			await runAppleScriptImpl(getBrowserActiveTabUrlScript(appName)),
		);
		hasSuccessfulQuery = hasSuccessfulQuery || activeTabUrl.ok;

		const providerName = getMeetingProviderNameFromUrl(activeTabUrl.value);
		if (providerName) {
			return { appName, providerName };
		}
	}

	return {
		appName: null,
		providerName: null,
		wasAvailable: hasSuccessfulQuery,
		wasRunning: hasRunningBrowser,
	};
};

export const resolveActiveBrowserMeetingProviderName = async ({
	isBrowserAppRunningImpl,
	runAppleScriptImpl,
}) =>
	(
		await detectActiveBrowserMeetingProvider({
			isBrowserAppRunningImpl,
			runAppleScriptImpl,
		})
	).providerName;

export const resolveBrowserMeetingProviderName = async (
	browserName,
	{ isBrowserAppRunningImpl = isBrowserAppRunning, runAppleScriptImpl },
) => {
	if (!(await isBrowserAppRunningImpl(browserName))) {
		return null;
	}

	const activeTabUrl = normalizeAppleScriptResult(
		await runAppleScriptImpl(getBrowserActiveTabUrlScript(browserName)),
	);
	return getMeetingProviderNameFromUrl(activeTabUrl.value);
};

export const detectActiveBrowserMeetingWindowState = async ({
	isBrowserAppRunningImpl = isBrowserAppRunning,
	runAppleScriptImpl = runAppleScript,
} = {}) => {
	const browserMeetingProvider = await detectActiveBrowserMeetingProvider({
		isBrowserAppRunningImpl,
		runAppleScriptImpl,
	});

	if (browserMeetingProvider.providerName) {
		return {
			active: true,
			appName: browserMeetingProvider.appName,
			bundleId: null,
			pid: null,
			permissionGranted: true,
			provider: browserMeetingProvider.providerName,
			source: "browser",
			title: `${browserMeetingProvider.appName}:${browserMeetingProvider.providerName}`,
		};
	}

	if (!browserMeetingProvider.wasRunning) {
		return {
			active: false,
			permissionGranted: true,
			source: "browser",
		};
	}

	if (!browserMeetingProvider.wasAvailable) {
		return {
			active: false,
			permissionGranted: false,
			source: "browser",
		};
	}

	return {
		active: false,
		permissionGranted: true,
		source: "browser",
	};
};
