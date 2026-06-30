import Foundation

@_silgen_name("graneri_aec_create")
private func graneriAecCreate(_ sampleRate: UInt32) -> OpaquePointer?

@_silgen_name("graneri_aec_destroy")
private func graneriAecDestroy(_ aec: OpaquePointer?)

@_silgen_name("graneri_aec_frame_size")
private func graneriAecFrameSize(_ aec: OpaquePointer?) -> Int

@_silgen_name("graneri_aec_process_render_frame")
private func graneriAecProcessRenderFrame(
	_ aec: OpaquePointer?,
	_ samples: UnsafeMutablePointer<Float>?,
	_ sampleCount: Int
) -> Bool

@_silgen_name("graneri_aec_process_capture_frame")
private func graneriAecProcessCaptureFrame(
	_ aec: OpaquePointer?,
	_ samples: UnsafeMutablePointer<Float>?,
	_ sampleCount: Int
) -> Bool

@_silgen_name("graneri_aec_get_stats")
private func graneriAecGetStats(_ aec: OpaquePointer?) -> WebRtcAec3Stats

struct WebRtcAec3Stats {
	let delayMs: Int32
	let echoReturnLoss: Double
	let echoReturnLossEnhancement: Double
	let residualEchoLikelihood: Double
	let residualEchoLikelihoodRecentMax: Double
}

final class WebRtcAec3Processor {
	private let handle: OpaquePointer
	let frameSize: Int
	let sampleRate: Double
	private var pendingRenderSamples: [Float] = []
	private var pendingRenderReadIndex = 0

	init?(sampleRate: Double) {
		let roundedSampleRate = UInt32(sampleRate.rounded())
		guard abs(Double(roundedSampleRate) - sampleRate) < 1,
			let handle = graneriAecCreate(roundedSampleRate)
		else {
			return nil
		}

		let frameSize = graneriAecFrameSize(handle)
		guard frameSize > 0 else {
			graneriAecDestroy(handle)
			return nil
		}

		self.handle = handle
		self.frameSize = frameSize
		self.sampleRate = Double(roundedSampleRate)
	}

	deinit {
		graneriAecDestroy(handle)
	}

	func analyzeRender(samples: [Float]) -> Int {
		pendingRenderSamples.append(contentsOf: samples)
		var processedFrames = 0
		while pendingRenderSamples.count - pendingRenderReadIndex >= frameSize {
			let frameEndIndex = pendingRenderReadIndex + frameSize
			let ok = pendingRenderSamples.withUnsafeMutableBufferPointer { buffer in
				guard let baseAddress = buffer.baseAddress else {
					return false
				}
				return graneriAecProcessRenderFrame(
					handle,
					baseAddress.advanced(by: pendingRenderReadIndex),
					frameSize
				)
			}
			if !ok {
				break
			}
			pendingRenderReadIndex = frameEndIndex
			processedFrames += 1
		}

		compactPendingRenderSamplesIfNeeded()
		return processedFrames
	}

	func processCapture(samples: [Float]) -> (samples: [Float], processedFrames: Int) {
		var outputSamples = samples
		var processedFrames = 0
		var frameStart = 0

		while frameStart + frameSize <= outputSamples.count {
			let ok = outputSamples.withUnsafeMutableBufferPointer { buffer in
				guard let baseAddress = buffer.baseAddress else {
					return false
				}
				return graneriAecProcessCaptureFrame(
					handle,
					baseAddress.advanced(by: frameStart),
					frameSize
				)
			}
			if !ok {
				break
			}
			processedFrames += 1
			frameStart += frameSize
		}

		return (outputSamples, processedFrames)
	}

	func stats() -> WebRtcAec3Stats {
		graneriAecGetStats(handle)
	}

	private func compactPendingRenderSamplesIfNeeded() {
		guard pendingRenderReadIndex > 0 else {
			return
		}

		if pendingRenderReadIndex == pendingRenderSamples.count {
			pendingRenderSamples.removeAll(keepingCapacity: true)
			pendingRenderReadIndex = 0
			return
		}

		guard pendingRenderReadIndex >= frameSize * 32 else {
			return
		}

		pendingRenderSamples.removeFirst(pendingRenderReadIndex)
		pendingRenderReadIndex = 0
	}
}
