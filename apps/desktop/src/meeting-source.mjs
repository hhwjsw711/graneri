const browserAppNames = new Set([
	"Arc",
	"Brave Browser",
	"Chromium",
	"Google Chrome",
	"Microsoft Edge",
	"Safari",
]);

const desktopSourceNames = new Map([
	["FaceTime", "FaceTime"],
	["Microsoft Teams", "Microsoft Teams"],
	["Slack", "Slack Huddle"],
	["WhatsApp", "WhatsApp"],
	["zoom.us", "Zoom"],
]);

export const normalizeMeetingDetectionSourceName = (value) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const resolveNativeMeetingDetectionSourceName = (value) => {
	const sourceName = normalizeMeetingDetectionSourceName(value);
	if (!sourceName) {
		return null;
	}

	const desktopSourceName = desktopSourceNames.get(sourceName);
	if (desktopSourceName) {
		return desktopSourceName;
	}

	if (sourceName.toLowerCase() === "helper") {
		return null;
	}

	if (browserAppNames.has(sourceName)) {
		return sourceName;
	}

	return sourceName;
};
