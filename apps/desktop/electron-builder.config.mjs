import { desktopPackageContract } from "./scripts/desktop-package-contract.mjs";

const trimConfigValue = (value) =>
	typeof value === "string" ? value.trim() : "";

const defaultAppId =
	process.env.GRANERI_ENV_MODE?.trim() === "production"
		? "com.graneri.desktop"
		: "dev.graneri.desktop";
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
	appId: trimConfigValue(process.env.GRANERI_DESKTOP_APP_ID) || defaultAppId,
	productName:
		trimConfigValue(process.env.GRANERI_DESKTOP_PRODUCT_NAME) || "Graneri",
	directories: {
		app: desktopPackageContract.appDirectory,
		buildResources: "build",
		output: "release",
	},
	files: desktopPackageContract.builderFiles,
	asarUnpack: desktopPackageContract.asarUnpack,
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
