import {
	browserAppNames,
	resolveActiveBrowserMeetingProviderName,
	resolveBrowserMeetingProviderName,
	runAppleScript,
} from "./browser-meeting-source.mjs";
import { desktopMeetingSourceProviders } from "./meeting-provider-registry.mjs";

const normalizeBundleId = (value) =>
	typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;

const normalizeSourceClient = (value) => {
	if (typeof value === "string") {
		return {
			bundleId: null,
			name: normalizeMeetingDetectionSourceName(value),
		};
	}

	return {
		bundleId: normalizeBundleId(value?.bundleId),
		name: normalizeMeetingDetectionSourceName(value?.name),
	};
};

const resolveDesktopSourceProviderName = ({ bundleId, name }) => {
	for (const sourceProvider of desktopMeetingSourceProviders) {
		if (
			bundleId &&
			sourceProvider.bundleIds.some(
				(sourceBundleId) => sourceBundleId.toLowerCase() === bundleId,
			)
		) {
			return sourceProvider.provider;
		}

		if (name && sourceProvider.names.includes(name)) {
			return sourceProvider.provider;
		}
	}

	return null;
};

export const normalizeMeetingDetectionSourceName = (value) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const resolveNativeMeetingDetectionSourceName = async (
	value,
	{ isBrowserAppRunningImpl, runAppleScriptImpl = runAppleScript } = {},
) => {
	const sourceClient = normalizeSourceClient(value);
	const sourceName = sourceClient.name;
	if (!sourceName) {
		return null;
	}

	const desktopSourceName = resolveDesktopSourceProviderName(sourceClient);
	if (desktopSourceName) {
		return desktopSourceName;
	}

	if (!browserAppNames.has(sourceName)) {
		if (sourceName.toLowerCase() === "helper") {
			return await resolveActiveBrowserMeetingProviderName({
				isBrowserAppRunningImpl,
				runAppleScriptImpl,
			});
		}

		return null;
	}

	return await resolveBrowserMeetingProviderName(sourceName, {
		isBrowserAppRunningImpl,
		runAppleScriptImpl,
	});
};
