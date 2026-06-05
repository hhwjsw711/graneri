const trimConfigValue = (value) =>
	typeof value === "string" ? value.trim() : "";

const githubOwner = trimConfigValue(process.env.VITE_GITHUB_OWNER);
const githubRepo = trimConfigValue(process.env.VITE_GITHUB_REPO);

const publish =
	githubOwner && githubRepo
		? [
				{
					provider: "github",
					owner: githubOwner,
					repo: githubRepo,
					releaseType: "release",
				},
			]
		: undefined;

export default {
	appId:
		trimConfigValue(process.env.GRANERI_DESKTOP_APP_ID) ||
		"dev.graneri.desktop",
	productName:
		trimConfigValue(process.env.GRANERI_DESKTOP_PRODUCT_NAME) || "Graneri",
	directories: {
		output: "release",
	},
	extraMetadata: {
		main: ".bundle-root/apps/desktop/dist/main.mjs",
	},
	files: [".bundle-root/**/*", "package.json"],
	asar: false,
	disableSanityCheckAsar: true,
	mac: {
		target: ["dmg", "zip"],
		category: "public.app-category.productivity",
		icon: "build/icon.icns",
		identity: "-",
		hardenedRuntime: true,
		gatekeeperAssess: false,
		notarize: false,
		extendInfo: {
			NSMicrophoneUsageDescription:
				"During your meetings, Graneri transcribes your microphone.",
			NSAudioCaptureUsageDescription:
				"During your meetings, Graneri transcribes your system audio output.",
		},
		entitlements: "build/entitlements.mac.plist",
		entitlementsInherit: "build/entitlements.mac.plist",
	},
	publish,
};
