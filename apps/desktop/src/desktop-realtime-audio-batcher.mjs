const realtimeAudioBatchDurationMs = 100;
const realtimeAudioBatchStatsIntervalMs = 30_000;
const realtimeOutputSampleRate = 24_000;
const pcm16BytesPerSample = 2;
const pcm16BytesPerMillisecond =
	(realtimeOutputSampleRate * pcm16BytesPerSample) / 1000;
const realtimeAudioBatchBytes =
	(realtimeOutputSampleRate *
		pcm16BytesPerSample *
		realtimeAudioBatchDurationMs) /
	1000;

const createAudioBatchStats = (now) => ({
	count: 0,
	lastLogTime: now(),
	totalBytes: 0,
});

const getAudioDurationMs = (byteLength) =>
	byteLength / pcm16BytesPerMillisecond;

const mergeAudioInterval = (currentInterval, nextInterval) => {
	if (!nextInterval) {
		return currentInterval;
	}

	if (!currentInterval) {
		return nextInterval;
	}

	return {
		endedAt: Math.max(currentInterval.endedAt, nextInterval.endedAt),
		startedAt: Math.min(currentInterval.startedAt, nextInterval.startedAt),
	};
};

export const createDesktopRealtimeAudioBatcher = ({
	logStats,
	now = () => Date.now(),
	sendAudio,
}) => {
	let audioBatch = Buffer.alloc(0);
	let audioBatchEndedAt = null;
	let audioBatchStartedAt = null;
	let audioBatchStats = createAudioBatchStats(now);
	let pendingCommitInterval = null;

	const hasBufferedAudio = () => audioBatch.byteLength > 0;

	const takePendingCommitInterval = () => {
		const interval = pendingCommitInterval;
		pendingCommitInterval = null;
		return interval;
	};

	const logStatsIfReady = () => {
		const currentTime = now();
		const elapsedMs = currentTime - audioBatchStats.lastLogTime;
		if (elapsedMs < realtimeAudioBatchStatsIntervalMs) {
			return;
		}

		if (audioBatchStats.count > 0) {
			const avgBytesPerBatch = Math.round(
				audioBatchStats.totalBytes / audioBatchStats.count,
			);
			logStats({
				avgAudioDurationMsPerBatch: Math.round(
					getAudioDurationMs(avgBytesPerBatch),
				),
				avgBytesPerBatch,
				batchCount: audioBatchStats.count,
				intervalMs: elapsedMs,
				sampleRate: realtimeOutputSampleRate,
				targetAudioDurationMs: realtimeAudioBatchDurationMs,
				targetBytesPerBatch: realtimeAudioBatchBytes,
				totalBytes: audioBatchStats.totalBytes,
			});
		}

		audioBatchStats = createAudioBatchStats(now);
	};

	const flush = ({ force = false } = {}) => {
		if (audioBatch.byteLength === 0) {
			return 0;
		}

		const bytesToSend = force
			? audioBatch.byteLength
			: Math.floor(audioBatch.byteLength / realtimeAudioBatchBytes) *
				realtimeAudioBatchBytes;

		if (bytesToSend === 0) {
			return 0;
		}

		const sentStartedAt = audioBatchStartedAt;
		const sentEndedAt =
			force || bytesToSend === audioBatch.byteLength
				? audioBatchEndedAt
				: sentStartedAt == null
					? null
					: sentStartedAt + getAudioDurationMs(bytesToSend);

		let sentChunks = 0;
		for (
			let offset = 0;
			offset < bytesToSend;
			offset += realtimeAudioBatchBytes
		) {
			const endOffset = Math.min(offset + realtimeAudioBatchBytes, bytesToSend);
			const chunkBytes = endOffset - offset;
			sendAudio(audioBatch.subarray(offset, endOffset).toString("base64"));
			audioBatchStats.count += 1;
			audioBatchStats.totalBytes += chunkBytes;
			sentChunks += 1;
		}
		logStatsIfReady();

		audioBatch = audioBatch.subarray(bytesToSend);
		if (sentStartedAt != null && sentEndedAt != null) {
			pendingCommitInterval = mergeAudioInterval(pendingCommitInterval, {
				endedAt: sentEndedAt,
				startedAt: sentStartedAt,
			});
		}
		if (audioBatch.byteLength === 0) {
			audioBatchStartedAt = null;
			audioBatchEndedAt = null;
		} else {
			audioBatchStartedAt = sentEndedAt;
		}

		return sentChunks;
	};

	const append = ({ audio, capturedAt }) => {
		const chunk = Buffer.from(audio, "base64");
		if (chunk.byteLength === 0) {
			return 0;
		}

		audioBatch =
			audioBatch.byteLength === 0 ? chunk : Buffer.concat([audioBatch, chunk]);
		const chunkEndedAt = capturedAt;
		const chunkStartedAt = chunkEndedAt - getAudioDurationMs(chunk.byteLength);
		audioBatchStartedAt ??= chunkStartedAt;
		audioBatchEndedAt = chunkEndedAt;

		return flush();
	};

	return {
		append,
		flush,
		hasBufferedAudio,
		takePendingCommitInterval,
	};
};
