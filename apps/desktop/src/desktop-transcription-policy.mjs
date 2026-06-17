export const createDesktopSystemAudioPolicy = ({
	helperPath,
	permissionState,
	platform,
}) => {
	if (platform === "darwin") {
		const hasHelper = Boolean(helperPath);
		const isBlocked = permissionState === "blocked";
		const sourceMode =
			hasHelper && !isBlocked ? "desktop-native" : "unsupported";

		return {
			platform: "desktop",
			systemAudioCapability: {
				isSupported: sourceMode !== "unsupported",
				sourceMode,
				shouldAutoBootstrap: sourceMode === "desktop-native",
			},
		};
	}

	if (platform === "win32") {
		return {
			platform: "desktop",
			systemAudioCapability: {
				isSupported: true,
				sourceMode: "display-media",
				shouldAutoBootstrap: false,
			},
		};
	}

	return {
		platform: "desktop",
		systemAudioCapability: {
			isSupported: false,
			sourceMode: "unsupported",
			shouldAutoBootstrap: false,
		},
	};
};
