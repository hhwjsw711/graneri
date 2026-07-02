import assert from "node:assert/strict";
import test from "node:test";
import {
	createAudioDebugRecorder,
	shouldEnableAudioDebugRecorder,
} from "../src/audio-debug-recorder.mjs";

const createFakeStream = (path) => ({
	ended: false,
	on: () => {},
	path,
	writes: [],
	end() {
		this.ended = true;
	},
	write(chunk) {
		this.writes.push(Buffer.from(chunk));
	},
});

test("audio debug recorder is disabled unless explicitly enabled", () => {
	assert.equal(shouldEnableAudioDebugRecorder({}), false);
	assert.equal(
		shouldEnableAudioDebugRecorder({
			GRANERI_ENABLE_TRANSCRIPTION_DEBUG: "1",
		}),
		true,
	);
	assert.equal(
		shouldEnableAudioDebugRecorder({
			GRANERI_AUDIO_DEBUG_RECORDINGS: "1",
		}),
		true,
	);
	assert.equal(
		shouldEnableAudioDebugRecorder({
			GRANERI_AUDIO_DEBUG_RECORDINGS: "0",
			GRANERI_ENABLE_TRANSCRIPTION_DEBUG: "1",
		}),
		false,
	);
});

test("audio debug recorder writes paired microphone and system WAV streams", async () => {
	const streams = [];
	const recorder = createAudioDebugRecorder({
		baseDir: "/tmp/graneri",
		createStream: (path) => {
			const stream = createFakeStream(path);
			streams.push(stream);
			return stream;
		},
		env: {
			GRANERI_ENABLE_TRANSCRIPTION_DEBUG: "1",
		},
		now: () => new Date("2026-07-02T12:34:56.789Z"),
	});

	const paths = await recorder.start({
		microphoneSampleRate: 48_000,
		systemAudioSampleRate: 24_000,
	});
	recorder.append({
		microphonePcm16: Buffer.from([1, 2, 3, 4]).toString("base64"),
		systemAudioPcm16: Buffer.from([5, 6]).toString("base64"),
	});
	recorder.stop();

	assert.deepEqual(paths, {
		microphonePath:
			"/tmp/graneri/audio_files/2026-07-02T12-34-56-789Z_microphone.wav",
		systemAudioPath:
			"/tmp/graneri/audio_files/2026-07-02T12-34-56-789Z_system.wav",
	});
	assert.equal(streams.length, 2);
	assert.equal(streams[0].path, paths.microphonePath);
	assert.equal(streams[1].path, paths.systemAudioPath);
	assert.equal(streams[0].writes[0].subarray(0, 4).toString("ascii"), "RIFF");
	assert.equal(streams[0].writes[0].readUInt32LE(24), 48_000);
	assert.equal(streams[1].writes[0].readUInt32LE(24), 24_000);
	assert.deepEqual([...streams[0].writes[1]], [1, 2, 3, 4]);
	assert.deepEqual([...streams[1].writes[1]], [5, 6]);
	assert.equal(streams[0].ended, true);
	assert.equal(streams[1].ended, true);
});

test("audio debug recorder removes expired paired WAV files", async () => {
	const removedPaths = [];
	const recorder = createAudioDebugRecorder({
		baseDir: "/tmp/graneri",
		env: {
			GRANERI_AUDIO_DEBUG_RECORDINGS: "1",
		},
		now: () => new Date("2026-07-10T00:00:00.000Z"),
		readDirectory: async () => [
			{ isFile: () => true, name: "old_microphone.wav" },
			{ isFile: () => true, name: "fresh_system.wav" },
			{ isFile: () => true, name: "ignore.txt" },
		],
		readStat: async (path) => ({
			mtimeMs: path.includes("old_")
				? new Date("2026-07-01T00:00:00.000Z").getTime()
				: new Date("2026-07-09T00:00:00.000Z").getTime(),
		}),
		removeFile: async (path) => {
			removedPaths.push(path);
		},
	});

	await recorder.cleanupExpiredFiles();

	assert.deepEqual(removedPaths, [
		"/tmp/graneri/audio_files/old_microphone.wav",
	]);
});
