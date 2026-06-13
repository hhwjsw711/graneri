import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { BrowserWindow, clipboard, screen } from "electron";
import { transcribeDictationAudio } from "../../../packages/ai/src/dictation-transcription.mjs";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";

const execFileAsync = promisify(execFile);
const maxDictationPcmBytes = 25_000_000;
const pasteRestoreDelayMs = 400;
const idleOverlayStatus = {
	status: "idle",
};
const overlayBoundsByStatus = {
	default: {
		height: 84,
		width: 720,
	},
	error: {
		height: 84,
		width: 720,
	},
};

export const resolveGlobalDictationHotkeyHelperPath = ({ runtimeDir }) =>
	resolveDesktopRuntimeExecutablePath({
		envPath: process.env.GRANERI_GLOBAL_DICTATION_HOTKEY_HELPER_PATH,
		executableName: "graneri-global-dictation-hotkey-helper",
		runtimeDir,
	});

const createWavBuffer = ({ pcm16, sampleRate }) => {
	const header = Buffer.alloc(44);
	const byteRate = sampleRate * 2;
	const blockAlign = 2;

	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm16.byteLength, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm16.byteLength, 40);

	return Buffer.concat([header, pcm16]);
};

const pasteTextToFocusedInput = async (text) => {
	const previousText = clipboard.readText();

	clipboard.writeText(text);
	await execFileAsync("osascript", [
		"-e",
		'tell application "System Events" to keystroke "v" using command down',
	]);

	setTimeout(() => {
		if (clipboard.readText() === text) {
			clipboard.writeText(previousText);
		}
	}, pasteRestoreDelayMs);
};

const createOverlayHtml = () => `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<style>
			* {
				box-sizing: border-box;
			}

			html,
			body {
				width: 100%;
				height: 100%;
				margin: 0;
				overflow: hidden;
				background: transparent;
				color: #fafafa;
				font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
			}

			body {
				display: flex;
				align-items: flex-end;
				justify-content: center;
				position: relative;
				padding-bottom: 18px;
			}

			.dictation-target {
				display: flex;
				align-items: flex-end;
				justify-content: center;
				width: 120px;
				height: 30px;
			}

			.hint {
				position: absolute;
				left: 50%;
				bottom: 38px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 5px;
				min-width: 0;
				max-width: calc(100vw - 32px);
				height: auto;
				padding: 0;
				border: 0;
				border-radius: 0;
				background: transparent;
				box-shadow: none;
				-webkit-backdrop-filter: none;
				backdrop-filter: none;
				opacity: 0;
				transform: translateX(-50%) translateY(5px) scale(0.98);
				transition:
					opacity 120ms ease,
					transform 120ms ease;
				color: hsl(0 0% 98% / 0.86);
				font-size: 12px;
				font-weight: 500;
				line-height: 16px;
				letter-spacing: 0;
				white-space: nowrap;
				pointer-events: none;
			}

			body[data-target-hovered="true"] .hint {
				opacity: 1;
				transform: translateX(-50%) translateY(0) scale(1);
			}

			.kbd {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				height: 18px;
				min-width: 28px;
				padding: 0 6px;
				border-radius: 5px;
				border: 1px solid hsl(0 0% 100% / 0.14);
				background: hsl(0 0% 100% / 0.09);
				color: hsl(0 0% 98% / 0.92);
				font-size: 11px;
				font-weight: 500;
				line-height: 16px;
			}

			.dots-pill,
			.loading-pill {
				position: relative;
				display: flex;
				align-items: center;
				justify-content: center;
				width: 40px;
				height: 8px;
				border: 0;
				border-radius: 0;
				background: transparent;
				box-shadow: none;
				-webkit-backdrop-filter: blur(18px);
				backdrop-filter: blur(18px);
				transition:
					width 100ms cubic-bezier(0.77, 0, 0.175, 1),
					height 100ms cubic-bezier(0.77, 0, 0.175, 1),
					border-radius 100ms cubic-bezier(0.77, 0, 0.175, 1),
					border-color 100ms cubic-bezier(0.77, 0, 0.175, 1);
			}

			.dots-pill::before {
				position: absolute;
				width: 34px;
				height: 6px;
				border: 1px solid hsl(0 0% 98% / 0.42);
				border-radius: 4px;
				background: transparent;
				content: "";
			}

			body[data-target-hovered="true"] .dots-pill,
			body[data-status="loading"] .loading-pill {
				width: 40px;
				height: 18px;
				border-color: transparent;
				border-radius: 0;
			}

			body[data-target-hovered="true"] .dots-pill::before,
			body[data-status="recording"] .dots-pill::before,
			body[data-status="loading"] .dots-pill::before,
			body[data-status="error"] .dots-pill::before {
				display: none;
			}

			.dots {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 5px;
				opacity: 0;
				transition: opacity 100ms cubic-bezier(0.77, 0, 0.175, 1);
			}

			.dot {
				width: 4px;
				height: 4px;
				flex: 0 0 auto;
				border-radius: 999px;
				background: hsl(0 0% 98% / 0.9);
			}

			body[data-status="recording"] .dots {
				opacity: 1;
			}

			.mic-icon {
				position: absolute;
				width: 14px;
				height: 14px;
				color: hsl(0 0% 98% / 0.82);
				opacity: 0;
				transform: scale(0.75);
				transition:
					opacity 100ms cubic-bezier(0.77, 0, 0.175, 1),
					transform 100ms cubic-bezier(0.77, 0, 0.175, 1);
			}

			body[data-target-hovered="true"] .mic-icon {
				opacity: 1;
				transform: scale(1);
			}

			body[data-status="recording"] .mic-icon,
			body[data-status="loading"] .mic-icon,
			body[data-status="error"] .mic-icon {
				display: none;
			}

			body[data-status="recording"] .dot {
				animation: voice-dot 820ms ease-in-out infinite;
			}

			body[data-status="recording"] .dot:nth-child(2) {
				animation-delay: 90ms;
			}

			body[data-status="recording"] .dot:nth-child(3) {
				animation-delay: 180ms;
			}

			body[data-status="recording"] .dot:nth-child(4) {
				animation-delay: 270ms;
			}

			.spinner {
				width: 12px;
				height: 12px;
				border: 2px solid hsl(0 0% 98% / 0.24);
				border-top-color: hsl(0 0% 98% / 0.9);
				border-radius: 999px;
				animation: spin 720ms linear infinite;
			}

			.error-pill {
				position: absolute;
				bottom: 0;
				left: 50%;
				transform: translateX(-50%);
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 8px;
				max-width: 304px;
				height: 32px;
				padding: 0 8px;
				border-radius: 16px;
				border: 1px solid hsl(0 0% 100% / 0.12);
				background: hsl(240 10% 3.9% / 0.82);
				box-shadow:
					0 18px 40px hsl(0 0% 0% / 0.24),
					inset 0 1px 0 hsl(0 0% 100% / 0.03);
				-webkit-backdrop-filter: blur(18px);
				backdrop-filter: blur(18px);
			}

			.error-label {
				color: hsl(0 84.2% 70.2%);
				font-size: 12px;
				font-weight: 500;
				line-height: 16px;
				letter-spacing: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.error-actions {
				display: inline-flex;
				align-items: center;
				gap: 8px;
			}

			.icon-button {
				display: inline-grid;
				place-items: center;
				width: 20px;
				height: 20px;
				padding: 0;
				border: 0;
				border-radius: 999px;
				background: transparent;
				color: hsl(0 0% 98% / 0.8);
				cursor: default;
			}

			.icon-button:hover {
				background: hsl(0 0% 100% / 0.09);
				color: hsl(0 0% 98% / 0.96);
			}

			.icon-button svg {
				width: 14px;
				height: 14px;
			}

			.loading-pill,
			.error-pill {
				display: none;
			}

			body[data-status="loading"] .dots-pill,
			body[data-status="error"] .dots-pill {
				display: none;
			}

			body[data-status="loading"] .loading-pill {
				display: flex;
			}

			body[data-status="loading"] .hint,
			body[data-status="error"] .hint,
			body[data-status="error"] .loading-pill {
				display: none;
			}

			body[data-status="error"] .dictation-target {
				display: none;
			}

			body[data-status="error"] .error-pill {
				display: inline-flex;
			}

			@keyframes voice-dot {
				0%,
				100% {
					opacity: 0.42;
					transform: translateY(0) scale(0.86);
				}
				50% {
					opacity: 1;
					transform: translateY(-1px) scale(1.08);
				}
			}

			@keyframes spin {
				to {
					transform: rotate(360deg);
				}
			}
		</style>
	</head>
	<body data-status="idle">
		<div class="hint">
			<span>Hold</span>
			<span class="kbd">⌘M</span>
			<span>to dictate</span>
		</div>
		<div class="dictation-target">
			<div class="dots-pill" aria-hidden="true">
				<svg class="mic-icon" viewBox="0 0 24 24" fill="none">
					<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M12 19v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
				</svg>
				<div class="dots">
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
				</div>
			</div>
			<div class="loading-pill" aria-hidden="true">
				<div class="spinner"></div>
			</div>
		</div>
		<div class="error-pill" role="alert">
			<span class="error-label">Unable to transcribe audio</span>
			<div class="error-actions">
				<button class="icon-button" type="button" data-action="retry" aria-label="Retry dictation">
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
						<path d="M21 4v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
				<button class="icon-button" type="button" data-action="close" aria-label="Close dictation error">
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
						<path d="m6 6 12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					</svg>
				</button>
			</div>
		</div>
		<script>
			document.addEventListener("click", (event) => {
				const button = event.target.closest("[data-action]");
				if (!button) return;
				window.location.href = "graneri-dictation://" + button.dataset.action;
			});

			const dictationTarget = document.querySelector(".dots-pill");
			dictationTarget?.addEventListener("mouseenter", () => {
				document.body.dataset.targetHovered = "true";
			});
			dictationTarget?.addEventListener("mouseleave", () => {
				document.body.dataset.targetHovered = "false";
			});
		</script>
	</body>
</html>`;

const getOverlayBounds = (status) =>
	status === "error"
		? overlayBoundsByStatus.error
		: overlayBoundsByStatus.default;

const getOverlayWindowPosition = (bounds) => {
	const cursorPoint = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursorPoint);
	const workArea = display.workArea;

	return {
		x: Math.round(workArea.x + (workArea.width - bounds.width) / 2),
		y: Math.max(workArea.y, workArea.y + workArea.height - bounds.height - 16),
	};
};

const createDictationOverlay = ({ onClose, onRetry } = {}) => {
	let overlayWindow = null;
	let isLoaded = false;
	let pendingStatus = null;
	let hideTimeoutId = null;

	const ensureWindow = async () => {
		if (overlayWindow && !overlayWindow.isDestroyed()) {
			return overlayWindow;
		}

		overlayWindow = new BrowserWindow({
			...overlayBoundsByStatus.default,
			...getOverlayWindowPosition(overlayBoundsByStatus.default),
			show: false,
			frame: false,
			hasShadow: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			alwaysOnTop: true,
			focusable: false,
			acceptFirstMouse: false,
			title: "Graneri dictation",
			type: process.platform === "darwin" ? "panel" : undefined,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		overlayWindow.setAlwaysOnTop(true, "floating");
		overlayWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
		});
		overlayWindow.on("closed", () => {
			overlayWindow = null;
			isLoaded = false;
		});
		overlayWindow.webContents.on("will-navigate", (event, url) => {
			if (!url.startsWith("graneri-dictation://")) {
				return;
			}

			event.preventDefault();
			const action = new URL(url).hostname;
			if (action === "retry") {
				onRetry?.();
				return;
			}

			if (action === "close") {
				onClose?.();
			}
		});
		overlayWindow.webContents.setWindowOpenHandler(({ url }) => {
			if (url.startsWith("graneri-dictation://")) {
				return { action: "deny" };
			}

			return { action: "deny" };
		});
		overlayWindow.webContents.on("did-finish-load", () => {
			isLoaded = true;
			if (pendingStatus) {
				void updateStatus(pendingStatus);
			}
		});

		await overlayWindow.loadURL(
			`data:text/html;charset=utf-8,${encodeURIComponent(createOverlayHtml())}`,
		);
		return overlayWindow;
	};

	const updateStatus = async ({ status }) => {
		const window = await ensureWindow();
		pendingStatus = { status };

		if (!isLoaded) {
			return;
		}

		await window.webContents.executeJavaScript(
			`
				document.body.dataset.status = ${JSON.stringify(status)};
			`,
			true,
		);
	};

	const show = async (status) => {
		if (hideTimeoutId) {
			clearTimeout(hideTimeoutId);
			hideTimeoutId = null;
		}

		const window = await ensureWindow();
		const bounds = getOverlayBounds(status.status);
		window.setBounds({
			...bounds,
			...getOverlayWindowPosition(bounds),
		});
		await updateStatus(status);
		window.showInactive();
	};

	const hide = ({ delayMs = 0 } = {}) => {
		if (hideTimeoutId) {
			clearTimeout(hideTimeoutId);
		}

		hideTimeoutId = setTimeout(() => {
			hideTimeoutId = null;
			if (overlayWindow && !overlayWindow.isDestroyed()) {
				overlayWindow.hide();
			}
		}, delayMs);
	};

	const destroy = () => {
		if (hideTimeoutId) {
			clearTimeout(hideTimeoutId);
			hideTimeoutId = null;
		}

		if (overlayWindow && !overlayWindow.isDestroyed()) {
			overlayWindow.destroy();
		}
		overlayWindow = null;
		isLoaded = false;
	};

	return {
		destroy,
		hide,
		show,
	};
};

export const createGlobalDictation = ({
	isKeepBarVisibleEnabled = () => true,
	runtimeDir,
	startMicrophoneCapture,
	stopMicrophoneCapture,
	subscribeToCaptureEvents,
}) => {
	let helperSession = null;
	let dictationSession = null;
	let operationId = 0;
	let retryLastDictation = null;
	let overlay = null;
	const showIdleOverlay = () => {
		if (isKeepBarVisibleEnabled()) {
			void overlay?.show(idleOverlayStatus);
			return;
		}

		overlay?.hide();
	};
	const showDictationError = () => {
		void overlay?.show({
			status: "error",
		});
	};
	overlay = createDictationOverlay({
		onClose: showIdleOverlay,
		onRetry: () => {
			if (retryLastDictation) {
				void retryLastDictation();
				return;
			}

			void startRecording();
		},
	});

	const transcribeAndPasteWav = async (wav) => {
		await overlay.show({
			status: "loading",
		});
		const result = await transcribeDictationAudio({
			audio: wav,
			mediaType: "audio/wav",
			prompt:
				"Transcribe this short dictation for insertion into the focused text field. Preserve the user's spoken words.",
		});

		if (result.text) {
			await pasteTextToFocusedInput(result.text);
		}

		await overlay.show(idleOverlayStatus);
	};

	const stopCurrentRecording = async () => {
		const session = dictationSession;
		if (!session || session.isStopping) {
			return;
		}

		session.isStopping = true;
		session.disposeCaptureEvents?.();
		dictationSession = null;
		await stopMicrophoneCapture().catch((error) => {
			console.error("[dictation] failed to stop microphone capture", error);
		});

		const pcm16 = Buffer.concat(session.chunks);
		if (pcm16.byteLength === 0) {
			void overlay.show(idleOverlayStatus);
			return;
		}

		const wav = createWavBuffer({
			pcm16,
			sampleRate: session.sampleRate,
		});
		retryLastDictation = async () => {
			try {
				await transcribeAndPasteWav(wav);
			} catch (error) {
				console.error("[dictation] failed to retry dictation", error);
				showDictationError();
			}
		};

		try {
			await transcribeAndPasteWav(wav);
		} catch (error) {
			console.error("[dictation] failed to transcribe or paste", error);
			showDictationError();
		}
	};

	const startRecording = async () => {
		if (dictationSession) {
			return;
		}

		const currentOperationId = ++operationId;
		const session = {
			chunks: [],
			disposeCaptureEvents: null,
			isStopping: false,
			sampleRate: 48_000,
		};
		dictationSession = session;
		void overlay.show({
			status: "recording",
		});

		session.disposeCaptureEvents = subscribeToCaptureEvents(
			"microphone",
			(event) => {
				if (dictationSession !== session || session.isStopping) {
					return;
				}

				if (event.type === "chunk" && typeof event.pcm16 === "string") {
					const chunk = Buffer.from(event.pcm16, "base64");
					const nextByteLength =
						session.chunks.reduce(
							(total, current) => total + current.byteLength,
							0,
						) + chunk.byteLength;

					if (nextByteLength <= maxDictationPcmBytes) {
						session.chunks.push(chunk);
					}
					return;
				}

				if (event.type === "error") {
					console.error("[dictation] microphone capture error", event.message);
					void stopCurrentRecording();
				}
			},
		);

		try {
			const capture = await startMicrophoneCapture();
			if (currentOperationId !== operationId || dictationSession !== session) {
				await stopCurrentRecording();
				return;
			}

			session.sampleRate = Number(capture?.sampleRate) || 48_000;
		} catch (error) {
			session.disposeCaptureEvents?.();
			if (dictationSession === session) {
				dictationSession = null;
			}
			console.error("[dictation] failed to start microphone capture", error);
			showDictationError();
		}
	};

	const handleHotkeyEvent = (event) => {
		if (event?.type === "start") {
			void startRecording();
			return;
		}

		if (event?.type === "stop") {
			operationId += 1;
			void stopCurrentRecording();
			return;
		}

		if (event?.type === "error") {
			console.error("[dictation] hotkey helper error", event.message);
			showDictationError();
		}
	};

	const start = () => {
		if (process.platform !== "darwin") {
			return;
		}

		if (helperSession) {
			return;
		}

		const helperPath = resolveGlobalDictationHotkeyHelperPath({ runtimeDir });
		if (!helperPath) {
			console.error("[dictation] global hotkey helper is missing");
			return;
		}

		const child = spawn(helperPath, [], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const lineReader = createInterface({
			input: child.stdout,
			crlfDelay: Infinity,
		});

		helperSession = {
			lineReader,
			process: child,
		};
		void overlay.show(idleOverlayStatus);

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			const message = String(chunk).trim();
			if (message) {
				console.error("[dictation-hotkey-helper]", message);
			}
		});
		lineReader.on("line", (line) => {
			try {
				handleHotkeyEvent(JSON.parse(line));
			} catch (error) {
				console.error("[dictation] failed to parse hotkey event", error);
			}
		});
		child.on("exit", (code, signal) => {
			console.info("[dictation] hotkey helper exited", { code, signal });
			lineReader.close();
			helperSession = null;
			void stopCurrentRecording();
		});
		child.on("error", (error) => {
			console.error("[dictation] hotkey helper process error", error);
			lineReader.close();
			helperSession = null;
		});
	};

	const stop = async () => {
		const session = helperSession;
		helperSession = null;

		if (session) {
			session.lineReader.close();
			session.process.kill("SIGTERM");
		}

		await stopCurrentRecording();
		overlay.destroy();
	};

	return {
		refreshVisibility: showIdleOverlay,
		start,
		stop,
	};
};
