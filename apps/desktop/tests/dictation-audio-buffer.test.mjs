import assert from "node:assert/strict";
import test from "node:test";
import {
	createDictationAudioBuffer,
	createWavBuffer,
} from "../src/dictation-audio-buffer.mjs";

test("dictation audio buffer limits PCM bytes and creates a WAV payload", () => {
	const buffer = createDictationAudioBuffer({
		maxBytes: 4,
		sampleRate: 16_000,
	});

	assert.equal(buffer.appendBase64Pcm16(Buffer.from([1, 2]).toString("base64")), true);
	assert.equal(buffer.appendBase64Pcm16(Buffer.from([3, 4, 5]).toString("base64")), false);
	assert.equal(buffer.getByteLength(), 2);
	assert.equal(buffer.getSampleRate(), 16_000);

	const wav = buffer.createWav();

	assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
	assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
	assert.equal(wav.readUInt32LE(24), 16_000);
	assert.deepEqual([...wav.subarray(44)], [1, 2]);
});

test("createWavBuffer writes PCM16 mono header sizes", () => {
	const wav = createWavBuffer({
		pcm16: Buffer.from([1, 2, 3, 4]),
		sampleRate: 48_000,
	});

	assert.equal(wav.readUInt32LE(4), 40);
	assert.equal(wav.readUInt16LE(20), 1);
	assert.equal(wav.readUInt16LE(22), 1);
	assert.equal(wav.readUInt32LE(28), 96_000);
	assert.equal(wav.readUInt16LE(32), 2);
	assert.equal(wav.readUInt16LE(34), 16);
	assert.equal(wav.readUInt32LE(40), 4);
});
