import AVFoundation
import Dispatch
import Foundation

protocol NativeAudioPcmSink: AnyObject, Sendable {
	func append(buffer: AVAudioPCMBuffer)
}

final class NativeAudioStdoutEmitter: @unchecked Sendable {
	private let queue: DispatchQueue
	private let fileHandle = FileHandle.standardOutput

	init(label: String) {
		queue = DispatchQueue(label: label)
	}

	func send(event: [String: Any]) {
		queue.async {
			guard JSONSerialization.isValidJSONObject(event),
				let data = try? JSONSerialization.data(withJSONObject: event)
			else {
				return
			}

			self.fileHandle.write(data)
			self.fileHandle.write(Data([0x0A]))
		}
	}
}

final class NativeAudioStderrLogger: @unchecked Sendable {
	private let queue: DispatchQueue
	private let fileHandle = FileHandle.standardError

	init(label: String) {
		queue = DispatchQueue(label: label)
	}

	func log(_ message: String) {
		queue.async {
			guard let data = "\(message)\n".data(using: .utf8) else {
				return
			}

			self.fileHandle.write(data)
		}
	}
}

final class NativeAudioPcmChunkEncoder: NativeAudioPcmSink, @unchecked Sendable {
	private let emitter: NativeAudioStdoutEmitter
	private let flushIntervalNanoseconds: UInt64
	private let queue: DispatchQueue
	private let source: String?
	private var pendingBytes = Data()
	private var pendingCapturedAtMilliseconds: Int?
	private var timer: DispatchSourceTimer?

	init(
		emitter: NativeAudioStdoutEmitter,
		label: String,
		flushIntervalMilliseconds: UInt64 = 100,
		source: String? = nil
	) {
		self.emitter = emitter
		self.flushIntervalNanoseconds = flushIntervalMilliseconds * 1_000_000
		self.source = source
		queue = DispatchQueue(label: label)
	}

	func start() {
		queue.sync {
			guard timer == nil else {
				return
			}

			let nextTimer = DispatchSource.makeTimerSource(queue: queue)
			nextTimer.schedule(
				deadline: .now() + .nanoseconds(Int(flushIntervalNanoseconds)),
				repeating: .nanoseconds(Int(flushIntervalNanoseconds))
			)
			nextTimer.setEventHandler { [weak self] in
				self?.flushLocked()
			}
			nextTimer.resume()
			timer = nextTimer
		}
	}

	func stop() {
		queue.sync {
			timer?.cancel()
			timer = nil
			flushLocked()
		}
	}

	func append(buffer: AVAudioPCMBuffer) {
		guard let floatChannel = buffer.floatChannelData?[0] else {
			return
		}

		let frameCount = Int(buffer.frameLength)
		guard frameCount > 0 else {
			return
		}
		let samples = Array(UnsafeBufferPointer(start: floatChannel, count: frameCount))

		let capturedAtMilliseconds = Int(Date().timeIntervalSince1970 * 1000)

		queue.async {
			var encoded = Data(capacity: samples.count * MemoryLayout<Int16>.size)

			for rawSample in samples {
				let sample = max(-1.0, min(1.0, rawSample))
				let scaled = sample >= 0
					? sample * Float(Int16.max)
					: sample * 32768
				var int16Sample = Int16(scaled.rounded())

				withUnsafeBytes(of: &int16Sample) { bytes in
					encoded.append(contentsOf: bytes)
				}
			}

			self.pendingBytes.append(encoded)
			self.pendingCapturedAtMilliseconds = capturedAtMilliseconds
		}
	}

	private func flushLocked() {
		guard !pendingBytes.isEmpty else {
			return
		}

		let base64 = pendingBytes.base64EncodedString()
		pendingBytes.removeAll(keepingCapacity: true)
		var event: [String: Any] = [
			"capturedAt": pendingCapturedAtMilliseconds ?? Int(Date().timeIntervalSince1970 * 1000),
			"type": "chunk",
			"pcm16": base64,
		]
		pendingCapturedAtMilliseconds = nil
		if let source {
			event["source"] = source
		}
		emitter.send(event: event)
	}
}
