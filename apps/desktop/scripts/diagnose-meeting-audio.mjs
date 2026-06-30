import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCombinedAudioHelperPath } from "../src/native-audio-capture.mjs";
import { desktopPackageContract } from "./desktop-package-contract.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSystemSoundPath = "/System/Library/Sounds/Glass.aiff";

const parseIntegerFlag = ({ args, defaultValue, flag }) => {
	const index = args.indexOf(flag);
	if (index === -1) {
		return defaultValue;
	}

	const value = Number.parseInt(args[index + 1] ?? "", 10);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${flag} must be followed by a positive integer.`);
	}

	return value;
};

const parseStringFlag = ({ args, defaultValue, flag }) => {
	const index = args.indexOf(flag);
	if (index === -1) {
		return defaultValue;
	}

	const value = args[index + 1]?.trim();
	if (!value) {
		throw new Error(`${flag} must be followed by a non-empty value.`);
	}

	return value;
};

const resolveHelperPath = () => {
	const generatedHelperPath = resolve(
		packageRoot,
		".generated",
		"system-audio",
		"graneri-combined-audio-helper",
	);
	if (existsSync(generatedHelperPath)) {
		return generatedHelperPath;
	}

	const stagedHelperPath = resolve(
		packageRoot,
		desktopPackageContract.appDirectory,
		desktopPackageContract.runtimeDirectory,
		"bin",
		"graneri-combined-audio-helper",
	);
	if (existsSync(stagedHelperPath)) {
		return stagedHelperPath;
	}

	return resolveCombinedAudioHelperPath({
		runtimeDir: resolve(packageRoot, "src"),
	});
};

const runSystemSoundPlayback = ({ soundPath, volume }) =>
	new Promise((resolvePromise) => {
		const child = spawn("afplay", ["-v", String(volume), soundPath], {
			stdio: "ignore",
		});
		child.on("error", (error) => {
			resolvePromise({
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		});
		child.on("exit", (code, signal) => {
			resolvePromise({
				code,
				ok: code === 0,
				signal,
			});
		});
	});

const createLevelSummary = () => ({
	maxAbs: 0,
	maxRms: 0,
	nonSilentChunks: 0,
	rmsSum: 0,
});

const summarizePcm16Level = (base64Pcm16) => {
	if (typeof base64Pcm16 !== "string") {
		return {
			maxAbs: 0,
			rms: 0,
		};
	}

	const buffer = Buffer.from(base64Pcm16, "base64");
	const sampleCount = Math.floor(
		buffer.byteLength / Int16Array.BYTES_PER_ELEMENT,
	);
	if (sampleCount === 0) {
		return {
			maxAbs: 0,
			rms: 0,
		};
	}

	let maxAbs = 0;
	let sumOfSquares = 0;
	for (let offset = 0; offset < sampleCount; offset += 1) {
		const normalizedSample =
			buffer.readInt16LE(offset * Int16Array.BYTES_PER_ELEMENT) / 32768;
		const abs = Math.abs(normalizedSample);
		maxAbs = Math.max(maxAbs, abs);
		sumOfSquares += normalizedSample * normalizedSample;
	}

	return {
		maxAbs,
		rms: Math.sqrt(sumOfSquares / sampleCount),
	};
};

const observeLevel = (summary, base64Pcm16) => {
	const level = summarizePcm16Level(base64Pcm16);
	summary.maxAbs = Math.max(summary.maxAbs, level.maxAbs);
	summary.maxRms = Math.max(summary.maxRms, level.rms);
	summary.rmsSum += level.rms;
	if (level.rms > 0.000_1) {
		summary.nonSilentChunks += 1;
	}
};

const createEmptyResult = ({ helperPath, options }) => ({
	audioLevels: {
		microphone: createLevelSummary(),
		systemAudio: createLevelSummary(),
	},
	chunks: {
		microphone: 0,
		systemAudio: 0,
	},
	durationMilliseconds: options.durationMilliseconds,
	errors: [],
	firstChunks: {
		microphonePcm16Length: null,
		systemAudioPcm16Length: null,
	},
	helperPath,
	lastDiagnostics: null,
	playback: null,
	ready: null,
	requirements: {
		minMicrophoneChunks: options.minMicrophoneChunks,
		minSystemAudioChunks: options.minSystemAudioChunks,
		requireNonSilentSystemAudio: options.requireNonSilentSystemAudio,
		requireSystemAudio: options.requireSystemAudio,
	},
	stderrTail: "",
});

const summarizeReadyEvent = (event) => {
	const route = event.microphone?.route;
	return {
		audioProcessing: event.audioProcessing ?? null,
		microphone: event.microphone
			? {
					route: route
						? {
								outputDeviceIsHeadphones: route.outputDeviceIsHeadphones,
								outputVolumeBeforeCapture: route.outputVolumeBeforeCapture,
								outputVolumeForCapture: route.outputVolumeForCapture,
								voiceProcessingMode: route.voiceProcessingMode,
								voiceProcessingRequested: route.voiceProcessingRequested,
								voiceProcessingRouteAllowed: route.voiceProcessingRouteAllowed,
							}
						: null,
					sampleRate: event.microphone.sampleRate,
					voiceProcessingDuckingEnabled:
						event.microphone.voiceProcessingDuckingEnabled === true,
					voiceProcessingEnabled:
						event.microphone.voiceProcessingEnabled === true,
					voiceProcessingOutputEnabled:
						event.microphone.voiceProcessingOutputEnabled === true,
				}
			: null,
		systemAudio: event.systemAudio
			? {
					channels: event.systemAudio.channels,
					debug: event.systemAudio.debug ?? null,
					sampleRate: event.systemAudio.sampleRate,
				}
			: null,
	};
};

const summarizeDiagnosticsEvent = (event) => ({
	echoCancellation: event.echoCancellation,
	echoCancellationDelayMs: event.echoCancellationDelayMs,
	echoCancellationLastEchoRms: event.echoCancellationLastEchoRms,
	echoCancellationLastPostRms: event.echoCancellationLastPostRms,
	echoCancellationLastPreRms: event.echoCancellationLastPreRms,
	echoCancellationLastReason: event.echoCancellationLastReason,
	echoCancellationProcessedCaptureFrames:
		event.echoCancellationProcessedCaptureFrames,
	echoCancellationProcessedChunks: event.echoCancellationProcessedChunks,
	echoCancellationProcessedRenderFrames:
		event.echoCancellationProcessedRenderFrames,
	echoCancellationResidualEchoLikelihood:
		event.echoCancellationResidualEchoLikelihood,
	echoCancellationResidualEchoLikelihoodRecentMax:
		event.echoCancellationResidualEchoLikelihoodRecentMax,
	echoCancellationResidualEchoSuppressedChunks:
		event.echoCancellationResidualEchoSuppressedChunks,
	echoCancellationSuppressedChunks: event.echoCancellationSuppressedChunks,
	echoCancellationUnavailableChunks: event.echoCancellationUnavailableChunks,
	microphoneChunks: event.microphoneChunks,
	microphoneLastRms: event.microphoneLastRms,
	microphoneMaxRms: event.microphoneMaxRms,
	microphoneNonSilentChunks: event.microphoneNonSilentChunks,
	renderAgeMilliseconds: event.renderAgeMilliseconds,
	systemAudioChunks: event.systemAudioChunks,
	systemAudioLastRms: event.systemAudioLastRms,
	systemAudioMaxRms: event.systemAudioMaxRms,
	systemAudioNonSilentChunks: event.systemAudioNonSilentChunks,
});

const addFailure = (failures, condition, message) => {
	if (!condition) {
		failures.push(message);
	}
};

const evaluateResult = (result) => {
	const failures = [];
	const ready = result.ready;
	const microphone = ready?.microphone;
	const route = microphone?.route;
	const volumeBefore = route?.outputVolumeBeforeCapture;
	const volumeForCapture = route?.outputVolumeForCapture;

	addFailure(failures, ready !== null, "combined helper did not report ready");
	addFailure(
		failures,
		result.errors.length === 0,
		"combined helper emitted error events",
	);
	addFailure(
		failures,
		microphone?.voiceProcessingEnabled === false,
		"Apple microphone voice processing is enabled",
	);
	addFailure(
		failures,
		microphone?.voiceProcessingOutputEnabled === false,
		"Apple output voice processing is enabled",
	);
	addFailure(
		failures,
		route?.voiceProcessingMode === "disabled",
		"combined helper did not start in disabled voice-processing mode",
	);
	if (
		typeof volumeBefore === "number" &&
		typeof volumeForCapture === "number"
	) {
		addFailure(
			failures,
			Math.abs(volumeBefore - volumeForCapture) <= 0.001,
			"output volume changed while starting combined capture",
		);
	}
	addFailure(
		failures,
		result.chunks.microphone >= result.requirements.minMicrophoneChunks,
		"microphone source did not emit enough chunks",
	);
	if (result.requirements.requireSystemAudio) {
		addFailure(
			failures,
			result.chunks.systemAudio >= result.requirements.minSystemAudioChunks,
			"system-audio source did not emit enough chunks",
		);
	}
	if (result.playback?.ok) {
		addFailure(
			failures,
			result.audioLevels.systemAudio.maxRms > 0.000_1,
			"system-audio source stayed silent during playback",
		);
	}
	if (result.requirements.requireNonSilentSystemAudio) {
		addFailure(
			failures,
			result.audioLevels.systemAudio.maxRms > 0.000_1,
			"system-audio source stayed silent while non-silent system audio was required",
		);
	}

	return failures;
};

const runDiagnostic = async (options) => {
	if (process.platform !== "darwin") {
		throw new Error("Meeting audio diagnostics are only available on macOS.");
	}

	const helperPath = resolveHelperPath();
	if (!helperPath) {
		throw new Error(
			"Combined audio helper is missing. Run `node apps/desktop/scripts/build-system-audio-helper.mjs` first.",
		);
	}

	const result = createEmptyResult({ helperPath, options });
	const child = spawn(helperPath, [], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let didFinish = false;
	let stderr = "";
	let stdout = "";
	let playbackStarted = false;
	let playbackPromise = null;

	const finish = async () => {
		if (didFinish) {
			return;
		}

		didFinish = true;
		child.kill("SIGTERM");
		setTimeout(() => {
			if (!child.killed) {
				child.kill("SIGKILL");
			}
		}, 500);
		if (playbackPromise) {
			result.playback = await playbackPromise;
		}
		result.stderrTail = stderr.slice(-2_000);
		result.failures = evaluateResult(result);
		result.ok = result.failures.length === 0;
	};

	const timeout = setTimeout(() => {
		void finish();
	}, options.durationMilliseconds);

	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});

	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		for (;;) {
			const newlineIndex = stdout.indexOf("\n");
			if (newlineIndex === -1) {
				break;
			}

			const line = stdout.slice(0, newlineIndex);
			stdout = stdout.slice(newlineIndex + 1);
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}

			if (event.type === "ready") {
				result.ready = summarizeReadyEvent(event);
				if (options.playSystemSound && !playbackStarted) {
					playbackStarted = true;
					playbackPromise = runSystemSoundPlayback({
						soundPath: options.systemSoundPath,
						volume: options.systemSoundVolume,
					});
				}
				continue;
			}

			if (event.type === "error") {
				result.errors.push(event.message ?? "unknown helper error");
				continue;
			}

			if (event.type === "processing_diagnostics") {
				result.lastDiagnostics = summarizeDiagnosticsEvent(event);
				continue;
			}

			if (event.type === "chunk" && event.source === "microphone") {
				result.chunks.microphone += 1;
				result.firstChunks.microphonePcm16Length ??=
					typeof event.pcm16 === "string" ? event.pcm16.length : 0;
				observeLevel(result.audioLevels.microphone, event.pcm16);
				continue;
			}

			if (event.type === "chunk" && event.source === "systemAudio") {
				result.chunks.systemAudio += 1;
				result.firstChunks.systemAudioPcm16Length ??=
					typeof event.pcm16 === "string" ? event.pcm16.length : 0;
				observeLevel(result.audioLevels.systemAudio, event.pcm16);
			}
		}
	});

	await new Promise((resolvePromise) => {
		child.on("error", (error) => {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
			void finish().then(resolvePromise);
		});
		child.on("exit", () => {
			void finish().then(resolvePromise);
		});
		setTimeout(resolvePromise, options.durationMilliseconds + 750);
	});
	clearTimeout(timeout);
	await finish();
	return result;
};

const summarizeOutputProcesses = (result) =>
	(result.ready?.systemAudio?.debug?.processes ?? []).map((process) => ({
		bundleId: process.bundleId,
		deviceIds: process.deviceIds,
		matchesDefaultOutput: process.matchesDefaultOutput,
		name: process.name,
		objectId: process.objectId,
		pid: process.pid,
	}));

const writeCompactSummary = (result) => {
	const summary = {
		failures: result.failures,
		microphoneMaxRms: result.audioLevels.microphone.maxRms,
		ok: result.ok,
		outputProcesses: summarizeOutputProcesses(result),
		systemAudioChunks: result.chunks.systemAudio,
		systemAudioMaxRms: result.audioLevels.systemAudio.maxRms,
		systemAudioNonSilentChunks: result.audioLevels.systemAudio.nonSilentChunks,
	};
	process.stdout.write(
		`desktop diagnose:meeting-audio summary: ${JSON.stringify(summary)}\n`,
	);
};

const args = process.argv.slice(2);
const compactOutput = args.includes("--compact");
const shouldPlaySystemSound = args.includes("--play-system-sound");
const options = {
	durationMilliseconds: parseIntegerFlag({
		args,
		defaultValue: shouldPlaySystemSound ? 5_000 : 8_000,
		flag: "--duration-ms",
	}),
	minMicrophoneChunks: parseIntegerFlag({
		args,
		defaultValue: 1,
		flag: "--min-microphone-chunks",
	}),
	minSystemAudioChunks: parseIntegerFlag({
		args,
		defaultValue: 1,
		flag: "--min-system-audio-chunks",
	}),
	playSystemSound: shouldPlaySystemSound,
	requireNonSilentSystemAudio:
		args.includes("--require-non-silent-system-audio") ||
		args.includes("--play-system-sound"),
	requireSystemAudio:
		args.includes("--require-system-audio") ||
		args.includes("--play-system-sound"),
	systemSoundPath: parseStringFlag({
		args,
		defaultValue: defaultSystemSoundPath,
		flag: "--system-sound",
	}),
	systemSoundVolume: Number.parseFloat(
		parseStringFlag({
			args,
			defaultValue: "0.12",
			flag: "--system-sound-volume",
		}),
	),
};

try {
	const result = await runDiagnostic(options);
	writeCompactSummary(result);
	if (!compactOutput) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	}
	if (!result.ok) {
		process.exitCode = 1;
	}
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
