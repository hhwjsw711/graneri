const normalizePathname = (pathname) => {
	const normalizedPathname = pathname.replace(/\/+$/, "");
	return normalizedPathname.length > 0 ? normalizedPathname : "/";
};

const isGoogleMeetCodePath = (pathname) =>
	/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(normalizePathname(pathname));

const isGoogleMeetLookupPath = (pathname) =>
	/^\/lookup\/[\w.-]+$/i.test(normalizePathname(pathname));

export const desktopMeetingSourceProviders = [
	{
		bundleIds: ["com.apple.facetime"],
		names: ["FaceTime"],
		provider: "FaceTime",
	},
	{
		bundleIds: ["com.hnc.discord"],
		names: ["Discord"],
		provider: "Discord",
	},
	{
		bundleIds: ["com.microsoft.teams", "com.microsoft.teams2"],
		names: ["Microsoft Teams"],
		provider: "Microsoft Teams",
	},
	{
		bundleIds: ["com.tinyspeck.slackmacgap"],
		names: ["Slack"],
		provider: "Slack Huddle",
	},
	{
		bundleIds: ["net.whatsapp.WhatsApp"],
		names: ["WhatsApp"],
		provider: "WhatsApp",
	},
	{
		bundleIds: ["us.zoom.xos"],
		names: ["zoom.us"],
		provider: "Zoom",
	},
];

export const desktopMeetingBrowserApps = [
	{
		appName: "Arc",
		processNames: ["Arc"],
	},
	{
		appName: "Google Chrome",
		processNames: ["Google Chrome"],
	},
	{
		appName: "Safari",
		processNames: ["Safari"],
	},
	{
		appName: "Brave Browser",
		processNames: ["Brave Browser"],
	},
	{
		appName: "Microsoft Edge",
		processNames: ["Microsoft Edge"],
	},
	{
		appName: "Firefox",
		processNames: ["Firefox"],
	},
	{
		appName: "Chromium",
		processNames: ["Chromium"],
	},
];

const meetingUrlProviders = [
	{
		matches: ({ hostname, pathname }) =>
			hostname === "meet.google.com" &&
			(isGoogleMeetCodePath(pathname) || isGoogleMeetLookupPath(pathname)),
		provider: "Google Meet",
	},
	{
		matches: ({ hostname, pathname }) =>
			hostname.endsWith(".zoom.us") &&
			(pathname.startsWith("/j/") ||
				pathname.startsWith("/wc/") ||
				pathname.startsWith("/s/")),
		provider: "Zoom",
	},
	{
		matches: ({ hostname, pathname }) =>
			(hostname === "telemost.yandex.ru" ||
				hostname === "telemost.360.yandex.ru") &&
			/^\/j\/[^/]+$/i.test(normalizePathname(pathname)),
		provider: "Yandex Telemost",
	},
	{
		matches: ({ hostname, pathname }) =>
			(hostname === "teams.microsoft.com" ||
				hostname.endsWith(".teams.microsoft.com")) &&
			(pathname.includes("/meet") || pathname.includes("/l/meetup-join")),
		provider: "Microsoft Teams",
	},
];

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

	const urlParts = {
		hostname: parsedUrl.hostname.toLowerCase(),
		pathname: parsedUrl.pathname,
	};
	const match = meetingUrlProviders.find((urlProvider) =>
		urlProvider.matches(urlParts),
	);

	return match?.provider ?? null;
};
