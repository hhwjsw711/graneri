import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createPcm16MonoWavHeader } from "./dictation-audio-buffer.mjs";
import { logError, logInfo } from "./logger.mjs";

const debugAudioDataLength = 0x7fffffff;
const debugAudioRetentionMs = 7 * 24 * 60 * 60 * 1000;

const sanitizeTimestampForPath = (value) =>
	value.replace(/[:.]/g, "-").replace(/[^0-9A-Za-z_-]/g, "-");

const isExplicitlyDisabled = (value) =>
	value === "0" || value === "false" || value === "off";

export const shouldEnableAudioDebugRecorder = (env = process.env) => {
	if (isExplicitlyDisabled(env.GRANERI_AUDIO_DEBUG_RECORDINGS)) {
		return false;
	}

	return (
		env.GRANERI_AUDIO_DEBUG_RECORDINGS === "1" ||
		env.GRANERI_ENABLE_TRANSCRIPTION_DEBUG === "1"
	);
};

export const createAudioDebugRecorder = ({
	baseDir,
	createStream = createWriteStream,
	env = process.env,
	now = () => new Date(),
	readDirectory = readdir,
	readStat = stat,
	removeFile = unlink,
} = {}) => {
	let activeSession = null;
	let sessionVersion = 0;

	const enabled = shouldEnableAudioDebugRecorder(env);
	const debugDir = baseDir ? join(baseDir, "audio_files") : null;

	const stop = () => {
		sessionVersion += 1;
		if (!activeSession) {
			return;
		}

		const session = activeSession;
		activeSession = null;
		session.microphoneStream.end();
		session.systemAudioStream.end();
		logInfo({
			message: "[audio-debug] stopped recording audio debug files",
			details: {
				microphoneBytes: session.microphoneBytes,
				microphonePath: session.microphonePath,
				systemAudioBytes: session.systemAudioBytes,
				systemAudioPath: session.systemAudioPath,
			},
		});
	};

	const start = async ({ microphoneSampleRate, systemAudioSampleRate }) => {
		stop();
		const startSessionVersion = sessionVersion;

		if (!enabled || !debugDir) {
			return null;
		}

		await mkdir(debugDir, { recursive: true });
		if (startSessionVersion !== sessionVersion) {
			return null;
		}

		const timestamp = sanitizeTimestampForPath(now().toISOString());
		const microphonePath = join(debugDir, `${timestamp}_microphone.wav`);
		const systemAudioPath = join(debugDir, `${timestamp}_system.wav`);
		const microphoneStream = createStream(microphonePath);
		const systemAudioStream = createStream(systemAudioPath);
		microphoneStream.on("error", (error) => {
			logError({
				error,
				message: "[audio-debug] microphone debug file stream failed",
			});
		});
		systemAudioStream.on("error", (error) => {
			logError({
				error,
				message: "[audio-debug] system audio debug file stream failed",
			});
		});

		microphoneStream.write(
			createPcm16MonoWavHeader({
				byteLength: debugAudioDataLength,
				sampleRate: microphoneSampleRate,
			}),
		);
		systemAudioStream.write(
			createPcm16MonoWavHeader({
				byteLength: debugAudioDataLength,
				sampleRate: systemAudioSampleRate,
			}),
		);

		activeSession = {
			microphoneBytes: 0,
			microphonePath,
			microphoneStream,
			systemAudioBytes: 0,
			systemAudioPath,
			systemAudioStream,
		};

		logInfo({
			message: "[audio-debug] started recording audio debug files",
			details: {
				microphonePath,
				microphoneSampleRate,
				systemAudioPath,
				systemAudioSampleRate,
			},
		});

		return {
			microphonePath,
			systemAudioPath,
		};
	};

	const append = ({ microphonePcm16, systemAudioPcm16 }) => {
		if (!activeSession) {
			return;
		}

		if (microphonePcm16) {
			const microphoneBuffer = Buffer.from(microphonePcm16, "base64");
			activeSession.microphoneStream.write(microphoneBuffer);
			activeSession.microphoneBytes += microphoneBuffer.byteLength;
		}

		if (systemAudioPcm16) {
			const systemAudioBuffer = Buffer.from(systemAudioPcm16, "base64");
			activeSession.systemAudioStream.write(systemAudioBuffer);
			activeSession.systemAudioBytes += systemAudioBuffer.byteLength;
		}
	};

	const cleanupExpiredFiles = async () => {
		if (!enabled || !debugDir) {
			return;
		}

		const cutoff = now().getTime() - debugAudioRetentionMs;
		try {
			const entries = await readDirectory(debugDir, { withFileTypes: true });
			await Promise.all(
				entries
					.filter(
						(entry) =>
							entry.isFile() && /_(microphone|system)\.wav$/.test(entry.name),
					)
					.map(async (entry) => {
						const path = join(debugDir, entry.name);
						const fileStat = await readStat(path);
						if (fileStat.mtimeMs < cutoff) {
							await removeFile(path);
						}
					}),
			);
		} catch (error) {
			logError({
				error,
				message: "[audio-debug] failed to remove expired audio debug files",
			});
		}
	};

	return {
		append,
		cleanupExpiredFiles,
		isEnabled: () => enabled,
		start,
		stop,
	};
};
