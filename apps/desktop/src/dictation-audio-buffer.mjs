export const maxDictationPcmBytes = 25_000_000;

export const createPcm16MonoWavHeader = ({ byteLength, sampleRate }) => {
	const header = Buffer.alloc(44);
	const byteRate = sampleRate * 2;
	const blockAlign = 2;

	header.write("RIFF", 0);
	header.writeUInt32LE(36 + byteLength, 4);
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
	header.writeUInt32LE(byteLength, 40);

	return header;
};

export const createWavBuffer = ({ pcm16, sampleRate }) => {
	const header = createPcm16MonoWavHeader({
		byteLength: pcm16.byteLength,
		sampleRate,
	});

	return Buffer.concat([header, pcm16]);
};

export const createDictationAudioBuffer = ({
	maxBytes = maxDictationPcmBytes,
	sampleRate = 48_000,
} = {}) => {
	const chunks = [];
	let byteLength = 0;
	let currentSampleRate = sampleRate;

	return {
		appendBase64Pcm16: (value) => {
			const chunk = Buffer.from(value, "base64");
			const nextByteLength = byteLength + chunk.byteLength;
			if (nextByteLength > maxBytes) {
				return false;
			}

			chunks.push(chunk);
			byteLength = nextByteLength;
			return true;
		},
		createWav: () =>
			createWavBuffer({
				pcm16: Buffer.concat(chunks),
				sampleRate: currentSampleRate,
			}),
		getByteLength: () => byteLength,
		getSampleRate: () => currentSampleRate,
		setSampleRate: (value) => {
			currentSampleRate = Number(value) || sampleRate;
		},
	};
};
