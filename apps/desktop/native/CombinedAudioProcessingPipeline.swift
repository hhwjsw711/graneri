import AVFoundation
import Dispatch
import Foundation

final class CombinedAudioProcessingPipeline: @unchecked Sendable {
	struct SelfTestResult {
		let activeRenderPassthroughErrorRms: Double
		let echoReductionRatio: Double
		let noRenderPassthroughErrorRms: Double
		let processedErrorRms: Double
		let quietDoubleTalkPassthroughErrorRms: Double
		let rawErrorRms: Double
		let quietDoubleTalkPassthroughChunks: Int
		let residualLeakGateSuppressedChunks: Int
		let suppressedChunks: Int
		let systemOutputErrorRms: Double

		var isPassing: Bool {
			activeRenderPassthroughErrorRms <= 0.16 &&
				echoReductionRatio >= 0.35 &&
				noRenderPassthroughErrorRms <= 0.000001 &&
				quietDoubleTalkPassthroughErrorRms <= 0.000001 &&
				residualLeakGateSuppressedChunks > 0 &&
				suppressedChunks > 0 &&
				systemOutputErrorRms <= 0.000001
		}

		func asEvent() -> [String: Any] {
			[
				"activeRenderPassthroughErrorRms": activeRenderPassthroughErrorRms,
				"echoReductionRatio": echoReductionRatio,
				"noRenderPassthroughErrorRms": noRenderPassthroughErrorRms,
				"ok": isPassing,
				"processedErrorRms": processedErrorRms,
				"quietDoubleTalkPassthroughChunks": quietDoubleTalkPassthroughChunks,
				"quietDoubleTalkPassthroughErrorRms": quietDoubleTalkPassthroughErrorRms,
				"rawErrorRms": rawErrorRms,
				"residualLeakGateSuppressedChunks": residualLeakGateSuppressedChunks,
				"suppressedChunks": suppressedChunks,
				"systemOutputErrorRms": systemOutputErrorRms,
				"type": "self_test",
			]
		}
	}

	private final class SourceSink: NativeAudioPcmSink, @unchecked Sendable {
		private let appendBuffer: @Sendable (AVAudioPCMBuffer) -> Void

		init(appendBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) {
			self.appendBuffer = appendBuffer
		}

		func append(buffer: AVAudioPCMBuffer) {
			appendBuffer(buffer)
		}
	}

	private struct SourceStats {
		var chunks = 0
		var frames = 0
		var lastRms: Double = 0
		var lastObservedAt: DispatchTime?
		var maxRms: Double = 0
		var nonSilentChunks = 0
	}

	private struct EchoReductionStats {
		var delayMs: Int?
		var lastEchoRms: Double = 0
		var lastPostRms: Double = 0
		var lastPreRms: Double = 0
		var residualEchoLikelihood: Double?
		var residualEchoLikelihoodRecentMax: Double?
		var processedChunks = 0
		var processedCaptureFrames = 0
		var processedRenderFrames = 0
		var quietDoubleTalkPassthroughChunks = 0
		var residualEchoSuppressedChunks = 0
		var suppressedChunks = 0
		var unavailableChunks = 0
		var lastReason = "waiting_for_render_reference"
	}

	private final class CollectingSink: NativeAudioPcmSink, @unchecked Sendable {
		private let queue = DispatchQueue(label: "com.graneri.combined-audio.collecting-sink")
		private var samples: [Float] = []

		func append(buffer: AVAudioPCMBuffer) {
			guard let channel = buffer.floatChannelData?[0] else {
				return
			}

			let frameCount = Int(buffer.frameLength)
			guard frameCount > 0 else {
				return
			}

			let nextSamples = Array(UnsafeBufferPointer(start: channel, count: frameCount))
			queue.sync {
				samples.append(contentsOf: nextSamples)
			}
		}

		func snapshot() -> [Float] {
			queue.sync {
				samples
			}
		}
	}

	private(set) lazy var microphoneSink: NativeAudioPcmSink = SourceSink {
		[weak self] buffer in
		self?.handleMicrophoneBuffer(buffer)
	}
	private(set) lazy var systemAudioSink: NativeAudioPcmSink = SourceSink {
		[weak self] buffer in
		self?.handleSystemAudioBuffer(buffer)
	}
	private let logger: NativeAudioStderrLogger
	private static let residualLeakGateSystemAudioRmsThreshold = 0.003
	private static let residualLeakGatePostAecRmsThreshold = 0.002
	private static let residualLeakGateMaximumRenderAgeMilliseconds = 150.0
	private static let residualLeakGateRawMicrophoneSilenceThreshold = 0.0001
	private static let quietDoubleTalkRawRmsThreshold = 0.002
	private let microphoneOutput: NativeAudioPcmSink
	private let onDiagnostics: (@Sendable ([String: Any]) -> Void)?
	private let systemAudioOutput: NativeAudioPcmSink
	private let queue = DispatchQueue(label: "com.graneri.combined-audio.processing")
	private var aecProcessor: WebRtcAec3Processor?
	private var echoReductionStats = EchoReductionStats()
	private var microphoneStats = SourceStats()
	private var systemAudioStats = SourceStats()

	init(
		logger: NativeAudioStderrLogger,
		microphoneOutput: NativeAudioPcmSink,
		systemAudioOutput: NativeAudioPcmSink,
		onDiagnostics: (@Sendable ([String: Any]) -> Void)? = nil
	) {
		self.logger = logger
		self.microphoneOutput = microphoneOutput
		self.onDiagnostics = onDiagnostics
		self.systemAudioOutput = systemAudioOutput
	}

	static func runSelfTest(logger: NativeAudioStderrLogger) -> SelfTestResult {
		let sampleRate = 48_000.0
		let frameCount = 960
		let delaySamples = 240
		let totalFrames = frameCount * 8 + delaySamples
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let format = AVAudioFormat(
			standardFormatWithSampleRate: sampleRate,
			channels: 1
		)!
		let renderSamples = (0..<totalFrames).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 440.0 / sampleRate) * 0.4)
		}
		let localSpeechSamples = (0..<totalFrames).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 1_200.0 / sampleRate) * 0.08)
		}
		var rawMicrophoneSamples: [Float] = []
		var expectedSpeechSamples: [Float] = []

		for chunkIndex in 0..<8 {
			let renderStart = chunkIndex * frameCount
			let renderBuffer = makeBuffer(
				format: format,
				samples: Array(renderSamples[renderStart..<renderStart + frameCount])
			)
			pipeline.systemAudioSink.append(buffer: renderBuffer)

			let microphoneStart = renderStart + delaySamples
			let microphoneSamples = (0..<frameCount).map { frameOffset in
				let sampleIndex = microphoneStart + frameOffset
				let echoSample = renderSamples[sampleIndex - delaySamples] * 0.65
				let localSpeechSample = localSpeechSamples[sampleIndex]
				return max(-1, min(1, localSpeechSample + echoSample))
			}
			rawMicrophoneSamples.append(contentsOf: microphoneSamples)
			expectedSpeechSamples.append(
				contentsOf: Array(localSpeechSamples[microphoneStart..<microphoneStart + frameCount])
			)
			let microphoneBuffer = makeBuffer(format: format, samples: microphoneSamples)
			pipeline.microphoneSink.append(buffer: microphoneBuffer)
		}

		let processedSamples = microphoneOutput.snapshot()
		let systemOutputSamples = systemAudioOutput.snapshot()
		let comparableCount = min(
			processedSamples.count,
			rawMicrophoneSamples.count,
			expectedSpeechSamples.count
		)
		let systemComparableCount = min(systemOutputSamples.count, renderSamples.count)
		let rawErrorRms = rmsError(
			Array(rawMicrophoneSamples[0..<comparableCount]),
			Array(expectedSpeechSamples[0..<comparableCount])
		)
		let processedErrorRms = rmsError(
			Array(processedSamples[0..<comparableCount]),
			Array(expectedSpeechSamples[0..<comparableCount])
		)
		let systemOutputErrorRms = rmsError(
			Array(systemOutputSamples[0..<systemComparableCount]),
			Array(renderSamples[0..<systemComparableCount])
		)
		let noRenderPassthroughErrorRms = runNoRenderPassthroughSelfTest(
			format: format,
			logger: logger
		)
		let activeRenderPassthroughErrorRms = runActiveRenderPassthroughSelfTest(
			format: format,
			logger: logger
		)
		let quietDoubleTalkPassthroughErrorRms = runQuietDoubleTalkPassthroughSelfTest(
			format: format,
			logger: logger
		)
		let residualLeakGateSuppressedChunks = runResidualLeakGateSelfTest(
			format: format,
			logger: logger
		)
		let echoReductionRatio =
			rawErrorRms > 0 ? max(0, 1.0 - processedErrorRms / rawErrorRms) : 0

		return SelfTestResult(
			activeRenderPassthroughErrorRms: activeRenderPassthroughErrorRms,
			echoReductionRatio: echoReductionRatio,
			noRenderPassthroughErrorRms: noRenderPassthroughErrorRms,
			processedErrorRms: processedErrorRms,
			quietDoubleTalkPassthroughErrorRms: quietDoubleTalkPassthroughErrorRms,
			rawErrorRms: rawErrorRms,
			quietDoubleTalkPassthroughChunks: pipeline.queue.sync {
				pipeline.echoReductionStats.quietDoubleTalkPassthroughChunks
			},
			residualLeakGateSuppressedChunks: residualLeakGateSuppressedChunks,
			suppressedChunks: pipeline.queue.sync {
				pipeline.echoReductionStats.suppressedChunks
			},
			systemOutputErrorRms: systemOutputErrorRms
		)
	}

	private static func runActiveRenderPassthroughSelfTest(
		format: AVAudioFormat,
		logger: NativeAudioStderrLogger
	) -> Double {
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let frameCount = 960
		let renderSamples = (0..<frameCount).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 440.0 / format.sampleRate) * 0.35)
		}
		let microphoneSamples = (0..<frameCount).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 1_370.0 / format.sampleRate) * 0.2)
		}

		pipeline.systemAudioSink.append(
			buffer: makeBuffer(format: format, samples: renderSamples)
		)
		pipeline.microphoneSink.append(
			buffer: makeBuffer(format: format, samples: microphoneSamples)
		)

		let processedSamples = microphoneOutput.snapshot()
		let comparableCount = min(processedSamples.count, microphoneSamples.count)
		return rmsError(
			Array(processedSamples[0..<comparableCount]),
			Array(microphoneSamples[0..<comparableCount])
		)
	}

	private static func runResidualLeakGateSelfTest(
		format: AVAudioFormat,
		logger: NativeAudioStderrLogger
	) -> Int {
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let frameCount = 960
		let renderSamples = (0..<frameCount).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 440.0 / format.sampleRate) * 0.35)
		}
		let microphoneSamples = Array(repeating: Float(0), count: frameCount)

		pipeline.systemAudioSink.append(
			buffer: makeBuffer(format: format, samples: renderSamples)
		)
		pipeline.microphoneSink.append(
			buffer: makeBuffer(format: format, samples: microphoneSamples)
		)

		return pipeline.queue.sync {
			pipeline.echoReductionStats.residualEchoSuppressedChunks
		}
	}

	private static func runQuietDoubleTalkPassthroughSelfTest(
		format: AVAudioFormat,
		logger: NativeAudioStderrLogger
	) -> Double {
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let frameCount = 960
		let renderSamples = (0..<frameCount).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 440.0 / format.sampleRate) * 0.35)
		}
		let microphoneSamples = (0..<frameCount).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 1_370.0 / format.sampleRate) * 0.0015)
		}

		pipeline.systemAudioSink.append(
			buffer: makeBuffer(format: format, samples: renderSamples)
		)
		pipeline.microphoneSink.append(
			buffer: makeBuffer(format: format, samples: microphoneSamples)
		)

		let processedSamples = microphoneOutput.snapshot()
		let comparableCount = min(processedSamples.count, microphoneSamples.count)
		return rmsError(
			Array(processedSamples[0..<comparableCount]),
			Array(microphoneSamples[0..<comparableCount])
		)
	}

	private static func runNoRenderPassthroughSelfTest(
		format: AVAudioFormat,
		logger: NativeAudioStderrLogger
	) -> Double {
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let frameCount = 960
		let microphoneSamples = (0..<frameCount).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 700.0 / format.sampleRate) * 0.2)
		}
		let microphoneBuffer = makeBuffer(format: format, samples: microphoneSamples)
		pipeline.microphoneSink.append(buffer: microphoneBuffer)

		let processedSamples = microphoneOutput.snapshot()
		let comparableCount = min(processedSamples.count, microphoneSamples.count)
		return rmsError(
			Array(processedSamples[0..<comparableCount]),
			Array(microphoneSamples[0..<comparableCount])
		)
	}

	private static func makeBuffer(
		format: AVAudioFormat,
		samples: [Float]
	) -> AVAudioPCMBuffer {
		let buffer = AVAudioPCMBuffer(
			pcmFormat: format,
			frameCapacity: AVAudioFrameCount(samples.count)
		)!
		buffer.frameLength = AVAudioFrameCount(samples.count)
		let channel = buffer.floatChannelData![0]
		for index in 0..<samples.count {
			channel[index] = samples[index]
		}
		return buffer
	}

	private static func rmsError(_ lhs: [Float], _ rhs: [Float]) -> Double {
		let count = min(lhs.count, rhs.count)
		guard count > 0 else {
			return 0
		}

		var sumOfSquares = 0.0
		for index in 0..<count {
			let delta = Double(lhs[index] - rhs[index])
			sumOfSquares += delta * delta
		}

		return sqrt(sumOfSquares / Double(count))
	}

	private static func rms(_ buffer: AVAudioPCMBuffer) -> Double {
		guard let channel = buffer.floatChannelData?[0] else {
			return 0
		}

		let frameCount = Int(buffer.frameLength)
		guard frameCount > 0 else {
			return 0
		}

		var sumOfSquares = 0.0
		for frameIndex in 0..<frameCount {
			let sample = Double(channel[frameIndex])
			sumOfSquares += sample * sample
		}

		return sqrt(sumOfSquares / Double(frameCount))
	}

	private static func shouldGateResidualLeak(
		postAecRms: Double,
		preAecRms: Double,
		renderAgeMilliseconds: Double?,
		systemAudioRms: Double
	) -> Bool {
		guard let renderAgeMilliseconds,
			renderAgeMilliseconds <= residualLeakGateMaximumRenderAgeMilliseconds,
			systemAudioRms >= residualLeakGateSystemAudioRmsThreshold,
			postAecRms < residualLeakGatePostAecRmsThreshold
		else {
			return false
		}

		return preAecRms < residualLeakGateRawMicrophoneSilenceThreshold
	}

	func describe() -> [String: Any] {
		queue.sync {
			describeLocked()
		}
	}

	private func describeStatsLocked(renderAgeMilliseconds: Double?) -> [String: Any] {
		var event = describeLocked()
		event["microphoneChunks"] = microphoneStats.chunks
		event["microphoneFrames"] = microphoneStats.frames
		event["microphoneLastRms"] = microphoneStats.lastRms
		event["microphoneMaxRms"] = microphoneStats.maxRms
		event["microphoneNonSilentChunks"] = microphoneStats.nonSilentChunks
		event["renderAgeMilliseconds"] = renderAgeMilliseconds ?? NSNull()
		event["systemAudioChunks"] = systemAudioStats.chunks
		event["systemAudioFrames"] = systemAudioStats.frames
		event["systemAudioLastRms"] = systemAudioStats.lastRms
		event["systemAudioMaxRms"] = systemAudioStats.maxRms
		event["systemAudioNonSilentChunks"] = systemAudioStats.nonSilentChunks
		event["type"] = "processing_diagnostics"
		return event
	}

	private func observe(source: String, buffer: AVAudioPCMBuffer) {
		let frameLength = Int(buffer.frameLength)
		let observedAt = DispatchTime.now()
		let rms = Self.rms(buffer)
		if source == "microphone" {
			microphoneStats.chunks += 1
			microphoneStats.frames += frameLength
			microphoneStats.lastRms = rms
			microphoneStats.lastObservedAt = observedAt
			microphoneStats.maxRms = max(microphoneStats.maxRms, rms)
			if rms >= 0.0001 {
				microphoneStats.nonSilentChunks += 1
			}
		} else {
			systemAudioStats.chunks += 1
			systemAudioStats.frames += frameLength
			systemAudioStats.lastRms = rms
			systemAudioStats.lastObservedAt = observedAt
			systemAudioStats.maxRms = max(systemAudioStats.maxRms, rms)
			if rms >= 0.0001 {
				systemAudioStats.nonSilentChunks += 1
			}
		}

		logStatsIfNeeded()
	}

	private func renderAgeMillisecondsLocked() -> Double? {
		guard let renderObservedAt = systemAudioStats.lastObservedAt else {
			return nil
		}

		return Double(DispatchTime.now().uptimeNanoseconds - renderObservedAt.uptimeNanoseconds) /
			1_000_000
	}

	private func handleMicrophoneBuffer(_ buffer: AVAudioPCMBuffer) {
		let processedBuffer = queue.sync {
			observe(source: "microphone", buffer: buffer)
			return reduceEchoLocked(buffer)
		}
		microphoneOutput.append(buffer: processedBuffer)
	}

	private func handleSystemAudioBuffer(_ buffer: AVAudioPCMBuffer) {
		queue.sync {
			observe(source: "systemAudio", buffer: buffer)
			appendRenderReferenceLocked(buffer)
		}
		systemAudioOutput.append(buffer: buffer)
	}

	private func appendRenderReferenceLocked(_ buffer: AVAudioPCMBuffer) {
		guard let channel = buffer.floatChannelData?[0] else {
			return
		}

		let frameCount = Int(buffer.frameLength)
		guard frameCount > 0 else {
			return
		}

		let samples = Array(UnsafeBufferPointer(start: channel, count: frameCount))
		let processor = processorLocked(sampleRate: buffer.format.sampleRate)
		if let processor {
			echoReductionStats.processedRenderFrames += processor.analyzeRender(samples: samples)
			echoReductionStats.lastReason = "render_reference_analyzed"
		} else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "aec3_unavailable"
		}
	}

	private func reduceEchoLocked(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
		guard let microphoneChannel = buffer.floatChannelData?[0] else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "missing_microphone_channel"
			return buffer
		}

		let frameCount = Int(buffer.frameLength)
		guard frameCount > 0 else {
			return buffer
		}

		guard let processor = processorLocked(sampleRate: buffer.format.sampleRate) else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "aec3_unavailable"
			return buffer
		}

		guard echoReductionStats.processedRenderFrames > 0 else {
			echoReductionStats.lastPostRms = Self.rms(buffer)
			echoReductionStats.lastPreRms = echoReductionStats.lastPostRms
			echoReductionStats.lastReason = "waiting_for_render_reference"
			return buffer
		}

		guard let processedBuffer = AVAudioPCMBuffer(
			pcmFormat: buffer.format,
			frameCapacity: buffer.frameCapacity
		) else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "buffer_allocation_failed"
			return buffer
		}

		processedBuffer.frameLength = buffer.frameLength
		guard let processedChannel = processedBuffer.floatChannelData?[0] else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "missing_processed_channel"
			return buffer
		}

		let inputSamples = Array(
			UnsafeBufferPointer(start: microphoneChannel, count: frameCount),
		)
		let processed = processor.processCapture(samples: inputSamples)
		for frameIndex in 0..<frameCount {
			processedChannel[frameIndex] = processed.samples[frameIndex]
		}

		let preRms = Self.rms(buffer)
		var postRms = Self.rms(processedBuffer)
		let shouldPreserveQuietDoubleTalk =
			preRms >= Self.residualLeakGateRawMicrophoneSilenceThreshold &&
			preRms <= Self.quietDoubleTalkRawRmsThreshold &&
			systemAudioStats.lastRms >= Self.residualLeakGateSystemAudioRmsThreshold
		if shouldPreserveQuietDoubleTalk {
			for frameIndex in 0..<frameCount {
				processedChannel[frameIndex] = inputSamples[frameIndex]
			}
			postRms = preRms
			echoReductionStats.quietDoubleTalkPassthroughChunks += 1
		}
		let shouldGateResidualLeak = Self.shouldGateResidualLeak(
			postAecRms: postRms,
			preAecRms: preRms,
			renderAgeMilliseconds: renderAgeMillisecondsLocked(),
			systemAudioRms: systemAudioStats.lastRms
		)
		if shouldGateResidualLeak {
			for frameIndex in 0..<frameCount {
				processedChannel[frameIndex] = 0
			}
			postRms = 0
			echoReductionStats.residualEchoSuppressedChunks += 1
		}
		let processorStats = processor.stats()
		let residualEchoLikelihood = processorStats.residualEchoLikelihood.isFinite
			? processorStats.residualEchoLikelihood
			: nil
		let residualEchoLikelihoodRecentMax = processorStats
			.residualEchoLikelihoodRecentMax
			.isFinite
			? processorStats.residualEchoLikelihoodRecentMax
			: nil
		echoReductionStats.processedChunks += 1
		echoReductionStats.processedCaptureFrames += processed.processedFrames
		if processed.processedFrames > 0 && postRms < preRms * 0.95 {
			echoReductionStats.suppressedChunks += 1
		}
		echoReductionStats.delayMs = processorStats.delayMs >= 0
			? Int(processorStats.delayMs)
			: nil
		echoReductionStats.lastEchoRms = max(0, preRms - postRms)
		echoReductionStats.lastPostRms = postRms
		echoReductionStats.lastPreRms = preRms
		echoReductionStats.residualEchoLikelihood = residualEchoLikelihood
		echoReductionStats.residualEchoLikelihoodRecentMax = residualEchoLikelihoodRecentMax
		if shouldGateResidualLeak {
			echoReductionStats.lastReason = "residual_leak_gated"
		} else if shouldPreserveQuietDoubleTalk {
			echoReductionStats.lastReason = "quiet_double_talk_passthrough"
		} else {
			echoReductionStats.lastReason = processed.processedFrames > 0
				? "aec3_active"
				: "aec3_waiting_for_full_capture_frame"
		}
		return processedBuffer
	}

	private func processorLocked(sampleRate: Double) -> WebRtcAec3Processor? {
		if let aecProcessor,
			abs(aecProcessor.sampleRate - sampleRate) < 1
		{
			return aecProcessor
		}

		aecProcessor = WebRtcAec3Processor(sampleRate: sampleRate)
		return aecProcessor
	}

	private func logStatsIfNeeded() {
		let totalChunks = microphoneStats.chunks + systemAudioStats.chunks
		guard totalChunks > 0, totalChunks % 200 == 0 else {
			return
		}

		let renderAgeMilliseconds: Double?
		if let renderObservedAt = systemAudioStats.lastObservedAt {
			renderAgeMilliseconds =
				Double(DispatchTime.now().uptimeNanoseconds - renderObservedAt.uptimeNanoseconds) /
				1_000_000
		} else {
			renderAgeMilliseconds = nil
		}

		logger.log(
			"[helper] combined audio processing stats microphoneChunks=\(microphoneStats.chunks) systemAudioChunks=\(systemAudioStats.chunks) microphoneFrames=\(microphoneStats.frames) systemAudioFrames=\(systemAudioStats.frames) microphoneMaxRms=\(microphoneStats.maxRms) systemAudioMaxRms=\(systemAudioStats.maxRms) systemAudioLastRms=\(systemAudioStats.lastRms) systemAudioNonSilentChunks=\(systemAudioStats.nonSilentChunks) renderAgeMs=\(renderAgeMilliseconds.map { String(format: "%.1f", $0) } ?? "null") echoProcessedChunks=\(echoReductionStats.processedChunks) echoProcessedCaptureFrames=\(echoReductionStats.processedCaptureFrames) echoProcessedRenderFrames=\(echoReductionStats.processedRenderFrames) echoSuppressedChunks=\(echoReductionStats.suppressedChunks) echoUnavailableChunks=\(echoReductionStats.unavailableChunks) echoLastReason=\(echoReductionStats.lastReason)"
		)
		onDiagnostics?(describeStatsLocked(renderAgeMilliseconds: renderAgeMilliseconds))
	}

	private func describeLocked() -> [String: Any] {
		[
			"echoCancellation": echoReductionStats.processedChunks > 0
				? "webrtc_aec3"
				: "pending_render_reference",
			"echoCancellationDelayMs": echoReductionStats.delayMs ?? NSNull(),
			"echoCancellationLastEchoRms": echoReductionStats.lastEchoRms,
			"echoCancellationLastPostRms": echoReductionStats.lastPostRms,
			"echoCancellationLastPreRms": echoReductionStats.lastPreRms,
			"echoCancellationLastReason": echoReductionStats.lastReason,
			"echoCancellationProcessedCaptureFrames": echoReductionStats.processedCaptureFrames,
			"echoCancellationProcessedChunks": echoReductionStats.processedChunks,
			"echoCancellationProcessedRenderFrames": echoReductionStats.processedRenderFrames,
			"echoCancellationQuietDoubleTalkPassthroughChunks": echoReductionStats
				.quietDoubleTalkPassthroughChunks,
			"echoCancellationResidualEchoLikelihood": echoReductionStats.residualEchoLikelihood ?? NSNull(),
			"echoCancellationResidualEchoLikelihoodRecentMax": echoReductionStats
				.residualEchoLikelihoodRecentMax ?? NSNull(),
			"echoCancellationResidualEchoSuppressedChunks": echoReductionStats.residualEchoSuppressedChunks,
			"echoCancellationSuppressedChunks": echoReductionStats.suppressedChunks,
			"echoCancellationUnavailableChunks": echoReductionStats.unavailableChunks,
			"microphoneOutput": "echo_reduced",
			"renderReference": "systemAudio",
			"stage": "combined-render-reference",
		]
	}
}
