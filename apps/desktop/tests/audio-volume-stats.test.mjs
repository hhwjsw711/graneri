import assert from "node:assert/strict";
import test from "node:test";
import {
	createAudioVolumeStats,
	getPcm16AverageAbsVolume,
} from "../src/audio-volume-stats.mjs";

const createPcm16Base64 = (samples) => {
	const pcm16 = new Int16Array(samples);
	return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength).toString(
		"base64",
	);
};

test("getPcm16AverageAbsVolume measures normalized average amplitude", () => {
	assert.equal(getPcm16AverageAbsVolume(createPcm16Base64([0, 16_384])), 0.25);
	assert.equal(getPcm16AverageAbsVolume(createPcm16Base64([-32_768])), 1);
	assert.equal(getPcm16AverageAbsVolume(""), 0);
});

test("audio volume stats logs paired source aggregates on interval", () => {
	let now = 1_000;
	const logs = [];
	const stats = createAudioVolumeStats({
		logIntervalMs: 30_000,
		now: () => now,
	});

	stats.update({
		microphonePcm16: createPcm16Base64([0, 0]),
		systemAudioPcm16: createPcm16Base64([16_384, 16_384]),
	});
	assert.equal(stats.logIfReady((details) => logs.push(details)), false);

	now += 30_000;
	assert.equal(stats.logIfReady((details) => logs.push(details)), true);
	assert.deepEqual(logs, [
		{
			intervalMs: 30_000,
			microphone: {
				avgVolume: 0,
				maxVolume: 0,
				sampleCount: 1,
				silentPercent: 100,
				silentSampleCount: 1,
			},
			systemAudio: {
				avgVolume: 500,
				maxVolume: 500,
				sampleCount: 1,
				silentPercent: 0,
				silentSampleCount: 0,
			},
		},
	]);

	stats.update({
		microphonePcm16: createPcm16Base64([32_767]),
		systemAudioPcm16: null,
	});
	now += 30_000;
	assert.equal(stats.logIfReady((details) => logs.push(details)), true);
	assert.equal(logs[1].microphone.sampleCount, 1);
	assert.equal(logs[1].systemAudio.sampleCount, 0);
});
