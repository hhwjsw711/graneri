import type {
	DesktopMeetingDetectionState,
	DesktopNavigation,
	DesktopPermissionId,
	DesktopPlatform,
	DesktopThemeSource,
	GraneriDesktopBridge,
} from "./desktop-bridge";

export type DesktopBridge = GraneriDesktopBridge;

export const getDesktopBridge = (): DesktopBridge | null => {
	if (typeof window === "undefined") {
		return null;
	}

	return window.graneriDesktop ?? null;
};

export const getRequiredDesktopBridge = (): DesktopBridge => {
	const bridge = getDesktopBridge();

	if (!bridge) {
		throw new Error("Desktop bridge is unavailable.");
	}

	return bridge;
};

export const isDesktopRuntime = () => getDesktopBridge() !== null;

export const isDesktopPlatform = (platform: DesktopPlatform) =>
	getDesktopBridge()?.platform === platform;

export const getDesktopMeta = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.getMeta) {
		return null;
	}

	return await bridge.getMeta();
};

export const supportsDesktopTranscriptionController = () => {
	const bridge = getDesktopBridge();

	return Boolean(bridge?.getTranscriptionSessionState);
};

export const supportsDesktopNativeAudioCapture = () => {
	const bridge = getDesktopBridge();

	return Boolean(bridge?.startMicrophoneCapture);
};

export const openDesktopExternalUrl = async (url: string) => {
	const bridge = getDesktopBridge();

	if (!bridge?.openExternalUrl) {
		return false;
	}

	await bridge.openExternalUrl(url);
	return true;
};

export const getDesktopAuthCallbackUrl = async (fallbackUrl: string) => {
	const bridge = getDesktopBridge();

	if (!bridge?.getAuthCallbackUrl) {
		return fallbackUrl;
	}

	return (await bridge.getAuthCallbackUrl()).url;
};

export const getDesktopPermissionsStatus = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.getPermissionsStatus) {
		return null;
	}

	return await bridge.getPermissionsStatus();
};

export const requestDesktopPermission = async (
	permissionId: DesktopPermissionId,
) => {
	const bridge = getDesktopBridge();

	if (!bridge?.requestPermission) {
		return null;
	}

	return await bridge.requestPermission(permissionId);
};

export const openDesktopPermissionSettings = async (
	permissionId: DesktopPermissionId,
) => {
	const bridge = getDesktopBridge();

	if (!bridge?.openPermissionSettings) {
		return false;
	}

	await bridge.openPermissionSettings(permissionId);
	return true;
};

export const getDesktopPreferences = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.getPreferences) {
		return null;
	}

	return await bridge.getPreferences();
};

export const setDesktopNativeTheme = async (
	themeSource: DesktopThemeSource,
) => {
	const bridge = getDesktopBridge();

	if (!bridge?.setNativeTheme) {
		return null;
	}

	return await bridge.setNativeTheme(themeSource);
};

export const setDesktopLaunchAtLogin = async (enabled: boolean) => {
	const bridge = getDesktopBridge();

	if (!bridge?.setLaunchAtLogin) {
		return null;
	}

	return await bridge.setLaunchAtLogin(enabled);
};

export const setDesktopActiveWorkspaceId = async (
	workspaceId: string | null,
) => {
	const bridge = getDesktopBridge();

	if (!bridge?.setActiveWorkspaceId) {
		return false;
	}

	await bridge.setActiveWorkspaceId(workspaceId);
	return true;
};

export const setDesktopActiveWorkspaceNotificationPreferences =
	async (payload: {
		workspaceId: string | null;
		notifyForScheduledMeetings: boolean;
		notifyForAutoDetectedMeetings: boolean;
	}) => {
		const bridge = getDesktopBridge();

		if (!bridge?.setActiveWorkspaceNotificationPreferences) {
			return false;
		}

		await bridge.setActiveWorkspaceNotificationPreferences(payload);
		return true;
	};

export const onDesktopNavigate = (
	listener: (navigation: DesktopNavigation) => void,
) => getDesktopBridge()?.onNavigate?.(listener) ?? undefined;

export const onDesktopMeetingDetectionState = (
	listener: (state: DesktopMeetingDetectionState) => void,
) => getDesktopBridge()?.onMeetingDetectionState?.(listener) ?? undefined;

export const getDesktopMeetingDetectionState = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.getMeetingDetectionState) {
		return null;
	}

	return await bridge.getMeetingDetectionState();
};

export const reportDesktopMeetingWidgetSize = (size: {
	width: number;
	height: number;
}) => getDesktopBridge()?.reportMeetingWidgetSize?.(size);

export const dismissDesktopDetectedMeetingWidget = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.dismissDetectedMeetingWidget) {
		return false;
	}

	await bridge.dismissDetectedMeetingWidget();
	return true;
};

export const startDesktopDetectedMeetingNote = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.startDetectedMeetingNote) {
		return false;
	}

	await bridge.startDetectedMeetingNote();
	return true;
};

export const canOpenDesktopSoundSettings = () =>
	Boolean(getDesktopBridge()?.openSoundSettings);

export const openDesktopSoundSettings = async () => {
	const bridge = getDesktopBridge();

	if (!bridge?.openSoundSettings) {
		return false;
	}

	await bridge.openSoundSettings();
	return true;
};

export const saveDesktopTextFile = async (
	defaultFileName: string,
	content: string,
) => {
	const bridge = getDesktopBridge();

	if (!bridge?.saveTextFile) {
		return null;
	}

	return await bridge.saveTextFile(defaultFileName, content);
};
