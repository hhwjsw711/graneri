import { getDesktopBridge } from "@workspace/platform/desktop";

type AppRuntimeConfig = {
	convexUrl: string;
	convexSiteUrl: string;
	isDesktop: boolean;
	localApiOrigin?: string;
};

let runtimeConfigSnapshot: AppRuntimeConfig | null = null;

function getEnv(...names: Array<keyof ImportMetaEnv>) {
	for (const name of names) {
		const value = import.meta.env[name];

		if (value) {
			return value;
		}
	}

	throw new Error(
		`Missing required client environment variable: ${names.join(" or ")}`,
	);
}

export async function loadRuntimeConfig(): Promise<AppRuntimeConfig> {
	const desktopBridge = getDesktopBridge();

	if (desktopBridge?.getRuntimeConfig) {
		const config = await desktopBridge.getRuntimeConfig();

		runtimeConfigSnapshot = {
			...config,
			isDesktop: true,
		};
		return runtimeConfigSnapshot;
	}

	runtimeConfigSnapshot = {
		convexUrl: getEnv("VITE_CONVEX_URL"),
		convexSiteUrl: getEnv("VITE_CONVEX_SITE_URL"),
		isDesktop: false,
	};
	return runtimeConfigSnapshot;
}

export function getChatApiUrl() {
	return runtimeConfigSnapshot?.localApiOrigin
		? `${runtimeConfigSnapshot.localApiOrigin}/api/chat`
		: "/api/chat";
}

export function getLocalFolderToolApiUrl() {
	return runtimeConfigSnapshot?.localApiOrigin
		? `${runtimeConfigSnapshot.localApiOrigin}/api/local-folder-tool`
		: null;
}
