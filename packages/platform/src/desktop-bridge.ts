export type DesktopPermissionId = "microphone" | "systemAudio";
export type DesktopPermissionState =
	| "granted"
	| "prompt"
	| "blocked"
	| "unsupported"
	| "unknown";
export type DesktopPlatform =
	| "aix"
	| "android"
	| "darwin"
	| "freebsd"
	| "haiku"
	| "linux"
	| "openbsd"
	| "sunos"
	| "win32"
	| "cygwin"
	| "netbsd";

export interface DesktopPermissionStatus {
	id: DesktopPermissionId;
	description: string;
	required: boolean;
	state: DesktopPermissionState;
	canRequest: boolean;
	canOpenSystemSettings: boolean;
}

export interface DesktopPermissionsStatus {
	isDesktop: boolean;
	platform: DesktopPlatform;
	permissions: DesktopPermissionStatus[];
}

export interface DesktopPreferences {
	launchAtLogin: boolean;
	canLaunchAtLogin: boolean;
	keepDictationBarVisible: boolean;
}

export type DesktopThemeSource = "dark" | "light" | "system";

export type DesktopTranscriptionControllerPhase =
	| "idle"
	| "starting"
	| "listening"
	| "reconnecting"
	| "stopping"
	| "failed";

export type DesktopTranscriptionControllerErrorCode =
	| "permission_denied"
	| "device_unavailable"
	| "connection_failed"
	| "configuration_failed"
	| "unknown";

export type DesktopMeetingDetectionState = {
	activeMicApps: Array<{
		bundleId: string | null;
		name: string;
		pid: number | null;
	}>;
	calendarEvent: {
		id: string;
		calendarName: string;
		endAt: string;
		startAt: string;
		title: string;
	} | null;
	candidateStartedAt: number | null;
	confidence: number;
	dismissedUntil: number | null;
	hasMeetingSignal: boolean;
	isMicrophoneActive: boolean;
	isSuppressed: boolean;
	meetingWindowState: {
		appName: string | null;
		bundleId: string | null;
		permissionGranted: boolean;
		pid: number | null;
		provider: string | null;
		source: "accessibility" | "browser";
		status: "active" | "inactive" | "unavailable";
		title: string | null;
	};
	sourceName: string | null;
	status: "idle" | "monitoring" | "prompting";
};

export type DesktopTrayCalendarEvent = {
	calendarId: string;
	calendarName: string;
	endAt: string;
	htmlLink: string | null;
	id: string;
	isAllDay: boolean;
	isMeeting: boolean;
	location: string | null;
	meetingUrl: string | null;
	startAt: string;
	title: string;
};

export type DesktopTrayCalendarState =
	| {
			status: "ready";
			connectedCalendarCount: number;
			events: DesktopTrayCalendarEvent[];
	  }
	| {
			status: "not_connected" | "error";
			connectedCalendarCount?: number;
			events?: [];
	  };

export type DesktopNavigation = {
	hash: string;
	pathname: string;
	search: string;
};

export type DesktopTranscriptionControllerState = {
	autoStartKey: string | number | null;
	error: {
		code: DesktopTranscriptionControllerErrorCode;
		message: string;
	} | null;
	isAvailable: boolean;
	isConnecting: boolean;
	isListening: boolean;
	liveTranscript: Record<
		"you" | "them",
		{
			speaker: "you" | "them";
			startedAt: number | null;
			text: string;
		}
	>;
	phase: DesktopTranscriptionControllerPhase;
	recoveryStatus: {
		attempt: number;
		maxAttempts: number;
		message: string | null;
		state: "idle" | "reconnecting" | "failed";
	};
	scopeKey: string | null;
	systemAudioStatus: {
		sourceMode: "desktop-native" | "display-media" | "unsupported";
		state: "unsupported" | "ready" | "connected";
	};
	utterances: Array<{
		endedAt: number;
		id: string;
		speaker: "you" | "them";
		startedAt: number;
		text: string;
	}>;
};

export type DesktopTranscriptionSessionEvent =
	| {
			type: "session.permission_failure";
			error: {
				code: DesktopTranscriptionControllerErrorCode;
				message: string;
			};
	  }
	| {
			type: "session.utterance_committed";
			utterance: DesktopTranscriptionControllerState["utterances"][number];
	  };

export type DesktopCaptureEvent = {
	type: "chunk" | "error" | "stopped";
	capturedAt?: number;
	pcm16?: string;
	message?: string;
	code?: number | null;
	signal?: string | number | null;
};

export type DesktopTranscriptDraft = {
	version: number;
	noteKey: string;
	updatedAt: number;
	utterances: Array<{
		id: string;
		speaker: "you" | "them";
		text: string;
		startedAt: number;
		endedAt: number;
	}>;
	liveTranscript: Record<
		"you" | "them",
		{
			speaker: "you" | "them";
			startedAt: number | null;
			text: string;
		}
	>;
	pendingGenerateTranscript: string;
};

export type DesktopNoteDraft = {
	version: number;
	workspaceId: string;
	noteId: string;
	updatedAt: number;
	title: string;
	content: string;
	searchableText: string;
};

export type DesktopLocalFolder = {
	id: string;
	name: string;
	path: string;
};

export interface GraneriDesktopBridge {
	platform: DesktopPlatform;
	getMeta: () => Promise<{
		name: string;
		version: string;
		platform: DesktopPlatform;
	}>;
	getRuntimeConfig: () => Promise<{
		convexUrl: string;
		convexSiteUrl: string;
		localApiOrigin?: string;
	}>;
	authFetch: (request: {
		path: string;
		method?: string;
		body?: unknown;
		headers?: Record<string, string>;
		throw?: boolean;
	}) => Promise<unknown>;
	getPermissionsStatus: () => Promise<DesktopPermissionsStatus>;
	getPreferences: () => Promise<DesktopPreferences>;
	setNativeTheme: (themeSource: DesktopThemeSource) => Promise<{
		ok: boolean;
		themeSource: DesktopThemeSource;
		usesDarkColors: boolean;
	}>;
	getAuthCallbackUrl: () => Promise<{ url: string }>;
	getShareBaseUrl: () => Promise<{ url: string }>;
	setActiveWorkspaceId: (
		workspaceId: string | null,
	) => Promise<{ ok: boolean }>;
	setActiveWorkspaceNotificationPreferences: (payload: {
		workspaceId: string | null;
		notifyForScheduledMeetings: boolean;
		notifyForAutoDetectedMeetings: boolean;
	}) => Promise<{ ok: boolean }>;
	refreshTrayCalendar: () => Promise<{ ok: boolean }>;
	setTrayCalendarState: (
		payload: DesktopTrayCalendarState,
	) => Promise<{ ok: boolean }>;
	openExternalUrl: (url: string) => Promise<{ ok: boolean }>;
	requestPermission: (
		permissionId: DesktopPermissionId,
	) => Promise<DesktopPermissionsStatus>;
	openPermissionSettings: (
		permissionId: DesktopPermissionId,
	) => Promise<{ ok: boolean }>;
	openSoundSettings: () => Promise<{ ok: boolean }>;
	setLaunchAtLogin: (enabled: boolean) => Promise<DesktopPreferences>;
	setKeepDictationBarVisible: (enabled: boolean) => Promise<DesktopPreferences>;
	getTranscriptionSessionState: () => Promise<DesktopTranscriptionControllerState>;
	getMeetingDetectionState: () => Promise<DesktopMeetingDetectionState>;
	configureTranscriptionSession: (options: {
		autoStartKey?: string | number | null;
		lang?: string;
		scopeKey?: string | null;
	}) => Promise<{ ok: boolean }>;
	startTranscriptionSession: () => Promise<boolean>;
	stopTranscriptionSession: (options?: {
		reason?: string;
	}) => Promise<{ ok: boolean }>;
	requestTranscriptionSystemAudio: () => Promise<boolean>;
	detachTranscriptionSystemAudio: () => Promise<{ ok: boolean }>;
	startDetectedMeetingNote: () => Promise<{ ok: boolean }>;
	dismissDetectedMeetingWidget: () => Promise<{ ok: boolean }>;
	reportMeetingWidgetSize: (size: { width: number; height: number }) => void;
	test?:
		| {
				showMeetingWidget: () => Promise<{ ok: boolean }>;
				resetMeetingDetection: () => Promise<{ ok: boolean }>;
		  }
		| undefined;
	onTranscriptionSessionState: (
		listener: (state: DesktopTranscriptionControllerState) => void,
	) => () => void;
	onTranscriptionSessionEvent: (
		listener: (event: DesktopTranscriptionSessionEvent) => void,
	) => () => void;
	onMeetingDetectionState: (
		listener: (state: DesktopMeetingDetectionState) => void,
	) => () => void;
	onNavigate: (listener: (navigation: DesktopNavigation) => void) => () => void;
	startSystemAudioCapture: () => Promise<{
		channels: number;
		sampleRate: number;
	}>;
	stopSystemAudioCapture: () => Promise<{ ok: boolean }>;
	startMicrophoneCapture: () => Promise<{
		channels: number;
		sampleRate: number;
	}>;
	stopMicrophoneCapture: () => Promise<{ ok: boolean }>;
	onMicrophoneCaptureEvent: (
		listener: (payload: DesktopCaptureEvent) => void,
	) => () => void;
	onSystemAudioCaptureEvent: (
		listener: (payload: DesktopCaptureEvent) => void,
	) => () => void;
	writeClipboardText: (value: string) => Promise<{ ok: boolean }>;
	writeClipboardRichText: (payload: {
		html: string;
		text: string;
	}) => Promise<{ ok: boolean }>;
	loadTranscriptDraft: (noteKey: string) => Promise<{
		draft: DesktopTranscriptDraft | null;
	}>;
	saveTranscriptDraft: (
		noteKey: string,
		draft: Omit<DesktopTranscriptDraft, "version" | "noteKey" | "updatedAt">,
	) => Promise<{ ok: boolean }>;
	clearTranscriptDraft: (noteKey: string) => Promise<{ ok: boolean }>;
	loadNoteDraft: (noteKey: string) => Promise<{
		draft: DesktopNoteDraft | null;
	}>;
	saveNoteDraft: (
		noteKey: string,
		draft: Omit<DesktopNoteDraft, "version" | "noteId" | "updatedAt">,
	) => Promise<{ ok: boolean }>;
	clearNoteDraft: (noteKey: string) => Promise<{ ok: boolean }>;
	shareLocalFolders: (paths: string[]) => Promise<{
		folders: DesktopLocalFolder[];
	}>;
	saveTextFile: (
		defaultFileName: string,
		content: string,
	) => Promise<{
		ok: boolean;
		canceled: boolean;
		filePath?: string;
	}>;
}

declare global {
	interface Window {
		graneriDesktop?: GraneriDesktopBridge;
	}
}
