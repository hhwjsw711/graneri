export const createInitialMeetingWindowState = () => ({
	appName: null,
	bundleId: null,
	permissionGranted: false,
	pid: null,
	provider: null,
	source: "accessibility",
	status: "unavailable",
	title: null,
});

export const createInactiveBrowserMeetingWindowState = () => ({
	appName: null,
	bundleId: null,
	permissionGranted: true,
	pid: null,
	provider: null,
	source: "browser",
	status: "inactive",
	title: null,
});

export const normalizeActiveMicApps = (value) => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((client) => {
			const name =
				typeof client?.name === "string" && client.name.trim()
					? client.name.trim()
					: null;
			if (!name) {
				return null;
			}

			const bundleId =
				typeof client?.bundleId === "string" && client.bundleId.trim()
					? client.bundleId.trim()
					: null;
			const pid =
				Number.isInteger(client?.pid) && client.pid > 0 ? client.pid : null;

			return {
				bundleId,
				name,
				pid,
			};
		})
		.filter(Boolean);
};

export const createUnavailableMeetingWindowState = ({
	permissionGranted = false,
	source = "accessibility",
} = {}) => ({
	appName: null,
	bundleId: null,
	permissionGranted,
	pid: null,
	provider: null,
	source,
	status: "unavailable",
	title: null,
});

export const normalizeMeetingWindowState = (value) => {
	const source = value?.source === "browser" ? "browser" : "accessibility";
	const permissionGranted = value?.permissionGranted === true;
	if (!permissionGranted) {
		return createUnavailableMeetingWindowState({
			permissionGranted,
			source,
		});
	}

	if (value?.active !== true) {
		return {
			appName: null,
			bundleId: null,
			permissionGranted,
			pid: null,
			provider: null,
			source,
			status: "inactive",
			title: null,
		};
	}

	const provider =
		typeof value.provider === "string" && value.provider.trim()
			? value.provider.trim()
			: null;
	const appName =
		typeof value.appName === "string" && value.appName.trim()
			? value.appName.trim()
			: provider;
	const bundleId =
		typeof value.bundleId === "string" && value.bundleId.trim()
			? value.bundleId.trim()
			: null;
	const title =
		typeof value.title === "string" && value.title.trim()
			? value.title.trim()
			: null;
	const pid = Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null;

	if (!provider) {
		return {
			appName: null,
			bundleId: null,
			permissionGranted,
			pid,
			provider: null,
			source,
			status: "inactive",
			title: null,
		};
	}

	return {
		appName,
		bundleId,
		permissionGranted,
		pid,
		provider,
		source,
		status: "active",
		title,
	};
};

export const aggregateMeetingWindowState = ({ browserState, nativeState }) => {
	if (nativeState.status === "active") {
		return nativeState;
	}

	if (browserState.status === "active") {
		return browserState;
	}

	if (nativeState.status === "inactive") {
		return nativeState;
	}

	if (browserState.status === "inactive") {
		return browserState;
	}

	return nativeState;
};

export const getMeetingWindowSourceName = (meetingWindowState) => {
	if (
		meetingWindowState?.status !== "active" ||
		typeof meetingWindowState.provider !== "string"
	) {
		return null;
	}

	const provider = meetingWindowState.provider.trim();
	return provider.length > 0 ? provider : null;
};
