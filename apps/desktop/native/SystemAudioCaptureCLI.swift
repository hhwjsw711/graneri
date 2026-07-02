@preconcurrency import AVFoundation
import AppKit
import AudioToolbox
import CoreAudio
import Dispatch
import Foundation

enum CaptureError: Error, LocalizedError {
	case aggregateDeviceCreationFailed(OSStatus)
	case converterCreationFailed
	case defaultOutputLookupFailed(OSStatus)
	case invalidTapFormat
	case ioProcCreationFailed(OSStatus)
	case ioProcStartFailed(OSStatus)
	case outputDeviceLookupFailed(OSStatus)
	case processObjectLookupFailed(OSStatus)
	case tapCreationFailed(OSStatus)
	case tapFormatLookupFailed(OSStatus)
	case tapTeardownFailed(OSStatus)

	var errorDescription: String? {
		switch self {
		case .aggregateDeviceCreationFailed(let status):
			return "Failed to create aggregate device (\(status))."
		case .converterCreationFailed:
			return "Failed to configure native system-audio conversion."
		case .defaultOutputLookupFailed(let status):
			return "Failed to resolve the default output device (\(status))."
		case .invalidTapFormat:
			return "System audio tap returned an invalid format."
		case .ioProcCreationFailed(let status):
			return "Failed to create the system-audio callback (\(status))."
		case .ioProcStartFailed(let status):
			return "Failed to start the system-audio callback (\(status))."
		case .outputDeviceLookupFailed(let status):
			return "Failed to read the output device identity (\(status))."
		case .processObjectLookupFailed(let status):
			return "Failed to resolve the current process object (\(status))."
		case .tapCreationFailed(let status):
			return "Failed to create the system-audio tap (\(status))."
		case .tapFormatLookupFailed(let status):
			return "Failed to read the system-audio tap format (\(status))."
		case .tapTeardownFailed(let status):
			return "Failed to stop the system-audio tap cleanly (\(status))."
		}
	}
}

final class SystemAudioCapture: @unchecked Sendable {
	private struct OutputProcessSnapshot {
		let bundleID: String?
		let deviceIDs: [AudioDeviceID]
		let isCurrentProcess: Bool
		let name: String?
		let objectID: AudioObjectID
		let pid: pid_t
	}

	private let callbackQueue = DispatchQueue(
		label: "com.graneri.system-audio.callback",
		qos: .userInteractive
	)
	private let encoder: NativeAudioPcmSink
	private let logger: NativeAudioStderrLogger
	private let routeChangeHandler: @Sendable () -> Void
	private let targetSampleRate: Double
	private var aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
	private var convertedFormat: AVAudioFormat?
	private var converter: AVAudioConverter?
	private var defaultOutputChangeListener: AudioObjectPropertyListenerBlock?
	private var hasHandledRouteChange = false
	private var ioProcID: AudioDeviceIOProcID?
	private var tapID = AudioObjectID(kAudioObjectUnknown)
	private(set) var debugInfo: [String: Any] = [:]

	init(
		encoder: NativeAudioPcmSink,
		logger: NativeAudioStderrLogger,
		routeChangeHandler: @escaping @Sendable () -> Void,
		targetSampleRate: Double = 24_000.0
	) {
		self.encoder = encoder
		self.logger = logger
		self.routeChangeHandler = routeChangeHandler
		self.targetSampleRate = targetSampleRate
	}

	func start() throws -> AVAudioFormat {
		try stop()
		logger.log("[helper] start() entered")
		hasHandledRouteChange = false

		let outputDeviceID = try Self.defaultOutputDeviceID()
		logger.log("[helper] resolved default output device id: \(outputDeviceID)")
		let outputUID = try Self.deviceUID(for: outputDeviceID)
		logger.log("[helper] resolved default output uid: \(outputUID)")
		debugInfo = Self.outputProcessSnapshotEvent(defaultOutputDeviceID: outputDeviceID)
		logOutputProcessSnapshot(debugInfo)
		let tapUUID = UUID()
		let currentProcessObjectID = Self.currentProcessObjectID()
		let includedProcesses = Self.runningOutputProcesses()
			.filter { snapshot in
				!snapshot.isCurrentProcess &&
					(snapshot.deviceIDs.isEmpty || snapshot.deviceIDs.contains(outputDeviceID))
			}
			.map(\.objectID)
		let excludedProcesses = currentProcessObjectID.map { [$0] } ?? []
		let tapDescription: CATapDescription
		let tapMode: String

		if includedProcesses.isEmpty {
			tapDescription = CATapDescription(
				monoGlobalTapButExcludeProcesses: excludedProcesses
			)
			tapMode = "mono-global-mixdown-excluding-self"
		} else {
			tapDescription = CATapDescription(
				__processes: includedProcesses.map(NSNumber.init(value:)),
				andDeviceUID: outputUID,
				withStream: 0
			)
			tapMode = "device-stream-process-mixdown-explicit-output"
		}

		tapDescription.name = "Graneri System Audio"
		tapDescription.uuid = tapUUID
		tapDescription.isPrivate = true
		tapDescription.muteBehavior = .unmuted
		debugInfo["includedProcessObjectIds"] = includedProcesses.map(Int.init)
		debugInfo["excludedProcessObjectIds"] = excludedProcesses.map(Int.init)
		debugInfo["tapMode"] = tapMode
		logger.log(
			"[helper] configured system-audio tap mode=\(tapMode) includedProcesses=\(includedProcesses) excludedProcesses=\(excludedProcesses)"
		)

		var nextTapID = AudioObjectID(kAudioObjectUnknown)
		var status = AudioHardwareCreateProcessTap(tapDescription, &nextTapID)
		logger.log("[helper] AudioHardwareCreateProcessTap status: \(status)")
		guard status == noErr else {
			throw CaptureError.tapCreationFailed(status)
		}

		let aggregateUID = UUID().uuidString
		let aggregateDescription: [String: Any] = [
			kAudioAggregateDeviceNameKey: "Graneri System Audio",
			kAudioAggregateDeviceUIDKey: aggregateUID,
			kAudioAggregateDeviceMainSubDeviceKey: outputUID,
			kAudioAggregateDeviceIsPrivateKey: true,
			kAudioAggregateDeviceIsStackedKey: false,
			kAudioAggregateDeviceTapAutoStartKey: true,
			kAudioAggregateDeviceSubDeviceListKey: [
				[
					kAudioSubDeviceUIDKey: outputUID,
				],
			],
			kAudioAggregateDeviceTapListKey: [
				[
					kAudioSubTapDriftCompensationKey: true,
					kAudioSubTapUIDKey: tapUUID.uuidString,
				],
			],
		]

		var nextAggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
		status = AudioHardwareCreateAggregateDevice(
			aggregateDescription as CFDictionary,
			&nextAggregateDeviceID
		)
		logger.log("[helper] AudioHardwareCreateAggregateDevice status: \(status)")
		guard status == noErr else {
			_ = AudioHardwareDestroyProcessTap(nextTapID)
			throw CaptureError.aggregateDeviceCreationFailed(status)
		}

		let streamDescription = try Self.tapStreamDescription(for: nextTapID)
		logger.log("[helper] resolved tap stream description")
		var mutableStreamDescription = streamDescription
		guard let format = AVAudioFormat(streamDescription: &mutableStreamDescription) else {
			_ = AudioHardwareDestroyAggregateDevice(nextAggregateDeviceID)
			_ = AudioHardwareDestroyProcessTap(nextTapID)
			throw CaptureError.invalidTapFormat
		}
		guard let targetFormat = AVAudioFormat(
			standardFormatWithSampleRate: targetSampleRate,
			channels: 1
		) else {
			_ = AudioHardwareDestroyAggregateDevice(nextAggregateDeviceID)
			_ = AudioHardwareDestroyProcessTap(nextTapID)
			throw CaptureError.converterCreationFailed
		}
		let nextConverter =
			format.sampleRate == targetFormat.sampleRate &&
				format.channelCount == targetFormat.channelCount &&
				format.commonFormat == targetFormat.commonFormat &&
				format.isInterleaved == targetFormat.isInterleaved
				? nil
				: AVAudioConverter(from: format, to: targetFormat)

		if format.sampleRate != targetFormat.sampleRate &&
			nextConverter == nil
		{
			_ = AudioHardwareDestroyAggregateDevice(nextAggregateDeviceID)
			_ = AudioHardwareDestroyProcessTap(nextTapID)
			throw CaptureError.converterCreationFailed
		}

		var nextIoProcID: AudioDeviceIOProcID?
		status = AudioDeviceCreateIOProcIDWithBlock(
			&nextIoProcID,
			nextAggregateDeviceID,
			callbackQueue
		) { [weak self] _, inInputData, _, _, _ in
			self?.handleInputData(inInputData, sourceFormat: format)
		}
		logger.log("[helper] AudioDeviceCreateIOProcIDWithBlock status: \(status)")

		guard status == noErr, let nextIoProcID else {
			_ = AudioHardwareDestroyAggregateDevice(nextAggregateDeviceID)
			_ = AudioHardwareDestroyProcessTap(nextTapID)
			throw CaptureError.ioProcCreationFailed(status)
		}

		status = AudioDeviceStart(nextAggregateDeviceID, nextIoProcID)
		logger.log("[helper] AudioDeviceStart status: \(status)")
		guard status == noErr else {
			_ = AudioDeviceDestroyIOProcID(nextAggregateDeviceID, nextIoProcID)
			_ = AudioHardwareDestroyAggregateDevice(nextAggregateDeviceID)
			_ = AudioHardwareDestroyProcessTap(nextTapID)
			throw CaptureError.ioProcStartFailed(status)
		}

		tapID = nextTapID
		aggregateDeviceID = nextAggregateDeviceID
		convertedFormat = targetFormat
		converter = nextConverter
		ioProcID = nextIoProcID
		try registerDefaultOutputChangeListener()
		logger.log("[helper] encoder started, returning ready format")

		return targetFormat
	}

	func stop() throws {
		logger.log("[helper] stop() entered")

		let currentAggregateDeviceID = aggregateDeviceID
		let currentIoProcID = ioProcID
		let currentTapID = tapID

		aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
		convertedFormat = nil
		converter = nil
		debugInfo = [:]
		ioProcID = nil
		tapID = AudioObjectID(kAudioObjectUnknown)
		try removeDefaultOutputChangeListener()
		hasHandledRouteChange = false

		var firstError: CaptureError?

		if currentAggregateDeviceID != AudioObjectID(kAudioObjectUnknown) {
			if let currentIoProcID {
				let stopStatus = AudioDeviceStop(currentAggregateDeviceID, currentIoProcID)
				if stopStatus != noErr, firstError == nil {
					firstError = .tapTeardownFailed(stopStatus)
				}

				let destroyIoProcStatus = AudioDeviceDestroyIOProcID(
					currentAggregateDeviceID,
					currentIoProcID
				)
				if destroyIoProcStatus != noErr, firstError == nil {
					firstError = .tapTeardownFailed(destroyIoProcStatus)
				}
			}

			let destroyAggregateStatus =
				AudioHardwareDestroyAggregateDevice(currentAggregateDeviceID)
			if destroyAggregateStatus != noErr, firstError == nil {
				firstError = .tapTeardownFailed(destroyAggregateStatus)
			}
		}

		if currentTapID != AudioObjectID(kAudioObjectUnknown) {
			let destroyTapStatus = AudioHardwareDestroyProcessTap(currentTapID)
			if destroyTapStatus != noErr, firstError == nil {
				firstError = .tapTeardownFailed(destroyTapStatus)
			}
		}

		if let firstError {
			logger.log("[helper] stop() failed: \(firstError.localizedDescription)")
			throw firstError
		}

		logger.log("[helper] stop() completed")
	}

	private func handleInputData(
		_ inputData: UnsafePointer<AudioBufferList>,
		sourceFormat: AVAudioFormat
	) {
		let sourceBuffers = UnsafeMutableAudioBufferListPointer(
			UnsafeMutablePointer(mutating: inputData)
		)
		let streamDescription = sourceFormat.streamDescription
		let bytesPerFrame = Int(streamDescription.pointee.mBytesPerFrame)
		guard bytesPerFrame > 0, let firstSourceBuffer = sourceBuffers.first else {
			return
		}

		let frameCount = AVAudioFrameCount(Int(firstSourceBuffer.mDataByteSize) / bytesPerFrame)
		guard frameCount > 0 else {
			return
		}

		guard let pcmBuffer = AVAudioPCMBuffer(
			pcmFormat: sourceFormat,
			frameCapacity: frameCount
		) else {
			return
		}

		pcmBuffer.frameLength = frameCount
		let destinationBuffers = UnsafeMutableAudioBufferListPointer(
			pcmBuffer.mutableAudioBufferList
		)
		guard destinationBuffers.count == sourceBuffers.count else {
			return
		}

		for index in 0..<sourceBuffers.count {
			let source = sourceBuffers[index]
			let copySize = min(
				Int(source.mDataByteSize),
				Int(destinationBuffers[index].mDataByteSize)
			)

			guard copySize > 0,
				let sourceData = source.mData,
				let destinationData = destinationBuffers[index].mData
			else {
				continue
			}

			memcpy(destinationData, sourceData, copySize)
			destinationBuffers[index].mDataByteSize = UInt32(copySize)
		}

		guard let targetFormat = convertedFormat else {
			return
		}

		guard let converter else {
			encoder.append(buffer: pcmBuffer)
			return
		}

		let outputFrameCapacity = max(
			AVAudioFrameCount(
				ceil(Double(frameCount) * targetFormat.sampleRate / sourceFormat.sampleRate)
			),
			1
		)
		guard let convertedBuffer = AVAudioPCMBuffer(
			pcmFormat: targetFormat,
			frameCapacity: outputFrameCapacity
		) else {
			return
		}

		var hasSuppliedInput = false
		var conversionError: NSError?
		let status = converter.convert(to: convertedBuffer, error: &conversionError) {
			_, outStatus in
			if hasSuppliedInput {
				outStatus.pointee = .noDataNow
				return nil
			}

			hasSuppliedInput = true
			outStatus.pointee = .haveData
			return pcmBuffer
		}

		if let conversionError {
			logger.log("[helper] conversion error: \(conversionError.localizedDescription)")
			return
		}

		switch status {
		case .haveData, .inputRanDry, .endOfStream:
			if convertedBuffer.frameLength > 0 {
				encoder.append(buffer: convertedBuffer)
			}
		case .error:
			logger.log("[helper] conversion failed without a recoverable error")
		@unknown default:
			return
		}
	}

	private func registerDefaultOutputChangeListener() throws {
		try removeDefaultOutputChangeListener()
		var address = Self.propertyAddress(
			selector: kAudioHardwarePropertyDefaultOutputDevice
		)
		let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
			self?.handleDefaultOutputDeviceChange()
		}
		let status = AudioObjectAddPropertyListenerBlock(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			callbackQueue,
			listener
		)

		guard status == noErr else {
			throw CaptureError.defaultOutputLookupFailed(status)
		}

		defaultOutputChangeListener = listener
	}

	private func removeDefaultOutputChangeListener() throws {
		guard let defaultOutputChangeListener else {
			return
		}

		var address = Self.propertyAddress(
			selector: kAudioHardwarePropertyDefaultOutputDevice
		)
		let status = AudioObjectRemovePropertyListenerBlock(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			callbackQueue,
			defaultOutputChangeListener
		)

		self.defaultOutputChangeListener = nil

		guard status == noErr else {
			throw CaptureError.tapTeardownFailed(status)
		}
	}

	private func handleDefaultOutputDeviceChange() {
		guard !hasHandledRouteChange else {
			return
		}

		hasHandledRouteChange = true
		logger.log("[helper] default output device changed")
		routeChangeHandler()
	}

	private func logOutputProcessSnapshot(_ event: [String: Any]) {
		let defaultOutputDeviceID = event["defaultOutputDeviceId"] ?? "unknown"
		let processCount = event["processCount"] ?? "unknown"
		guard JSONSerialization.isValidJSONObject(event),
			let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
			let line = String(data: data, encoding: .utf8)
		else {
			logger.log(
				"[helper] coreaudio output process snapshot unavailable processCount=\(processCount) defaultOutputDeviceId=\(defaultOutputDeviceID)"
			)
			return
		}

		logger.log("[helper] \(line)")
	}

	private static func outputProcessSnapshotEvent(
		defaultOutputDeviceID: AudioDeviceID
	) -> [String: Any] {
		let snapshots = Self.runningOutputProcesses()
		let payload = snapshots.map { snapshot in
			[
				"bundleId": snapshot.bundleID ?? NSNull(),
				"deviceIds": snapshot.deviceIDs.map(Int.init),
				"isCurrentProcess": snapshot.isCurrentProcess,
				"matchesDefaultOutput": snapshot.deviceIDs.isEmpty
					? NSNull()
					: NSNumber(value: snapshot.deviceIDs.contains(defaultOutputDeviceID)),
				"name": snapshot.name ?? NSNull(),
				"objectId": Int(snapshot.objectID),
				"pid": Int(snapshot.pid),
			] as [String: Any]
		}
		return [
			"defaultOutputDeviceId": Int(defaultOutputDeviceID),
			"processCount": snapshots.count,
			"processes": payload,
			"type": "coreaudio_output_process_snapshot",
		]
	}

	private static func propertyAddress(
		selector: AudioObjectPropertySelector,
		scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
		element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
	) -> AudioObjectPropertyAddress {
		AudioObjectPropertyAddress(
			mSelector: selector,
			mScope: scope,
			mElement: element
		)
	}

	private static func currentProcessObjectID() -> AudioObjectID? {
		var pid = getpid()
		var address = propertyAddress(
			selector: kAudioHardwarePropertyTranslatePIDToProcessObject
		)
		var processObjectID = AudioObjectID(kAudioObjectUnknown)
		var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)

		let status = withUnsafePointer(to: &pid) { pidPointer in
			AudioObjectGetPropertyData(
				AudioObjectID(kAudioObjectSystemObject),
				&address,
				UInt32(MemoryLayout<pid_t>.size),
				pidPointer,
				&dataSize,
				&processObjectID
			)
		}

		guard status == noErr else {
			return nil
		}

		return processObjectID == AudioObjectID(kAudioObjectUnknown)
			? nil
			: processObjectID
	}

	private static func runningOutputProcesses() -> [OutputProcessSnapshot] {
		var address = propertyAddress(
			selector: kAudioHardwarePropertyProcessObjectList
		)
		var dataSize: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize
		) == noErr else {
			return []
		}

		let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
		var processObjectIDs = [AudioObjectID](repeating: 0, count: count)
		guard AudioObjectGetPropertyData(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize,
			&processObjectIDs
		) == noErr else {
			return []
		}

		return processObjectIDs.compactMap { processObjectID in
			guard Self.isProcessRunningOutput(processObjectID),
				let pid = Self.processPID(processObjectID)
			else {
				return nil
			}

			let application = NSRunningApplication(processIdentifier: pid)
			return OutputProcessSnapshot(
				bundleID: Self.processBundleID(processObjectID) ?? application?.bundleIdentifier,
				deviceIDs: Self.processOutputDeviceIDs(processObjectID),
				isCurrentProcess: pid == getpid(),
				name: application?.localizedName,
				objectID: processObjectID,
				pid: pid
			)
		}
	}

	private static func isProcessRunningOutput(_ processObjectID: AudioObjectID) -> Bool {
		var address = propertyAddress(
			selector: kAudioProcessPropertyIsRunningOutput
		)
		var isRunning: UInt32 = 0
		var size = UInt32(MemoryLayout<UInt32>.size)
		let status = AudioObjectGetPropertyData(
			processObjectID,
			&address,
			0,
			nil,
			&size,
			&isRunning
		)
		return status == noErr && isRunning != 0
	}

	private static func processPID(_ processObjectID: AudioObjectID) -> pid_t? {
		var address = propertyAddress(selector: kAudioProcessPropertyPID)
		var pid = pid_t(0)
		var size = UInt32(MemoryLayout<pid_t>.size)
		let status = AudioObjectGetPropertyData(
			processObjectID,
			&address,
			0,
			nil,
			&size,
			&pid
		)
		return status == noErr && pid > 0 ? pid : nil
	}

	private static func processBundleID(_ processObjectID: AudioObjectID) -> String? {
		var address = propertyAddress(selector: kAudioProcessPropertyBundleID)
		var bundleID: Unmanaged<CFString>?
		var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
		let status = AudioObjectGetPropertyData(
			processObjectID,
			&address,
			0,
			nil,
			&size,
			&bundleID
		)
		guard status == noErr else {
			return nil
		}

		return bundleID?.takeRetainedValue() as String?
	}

	private static func processOutputDeviceIDs(_ processObjectID: AudioObjectID) -> [AudioDeviceID] {
		var address = propertyAddress(
			selector: kAudioProcessPropertyDevices,
			scope: kAudioObjectPropertyScopeOutput
		)
		var dataSize: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(
			processObjectID,
			&address,
			0,
			nil,
			&dataSize
		) == noErr else {
			return []
		}

		let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
		var deviceIDs = [AudioDeviceID](repeating: 0, count: count)
		guard AudioObjectGetPropertyData(
			processObjectID,
			&address,
			0,
			nil,
			&dataSize,
			&deviceIDs
		) == noErr else {
			return []
		}

		return deviceIDs
	}

	private static func defaultOutputDeviceID() throws -> AudioDeviceID {
		var address = propertyAddress(
			selector: kAudioHardwarePropertyDefaultOutputDevice
		)
		var deviceID = AudioDeviceID(0)
		var dataSize = UInt32(MemoryLayout<AudioDeviceID>.size)

		let status = AudioObjectGetPropertyData(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize,
			&deviceID
		)

		guard status == noErr, deviceID != 0 else {
			throw CaptureError.defaultOutputLookupFailed(status)
		}

		return deviceID
	}

	private static func deviceUID(for deviceID: AudioDeviceID) throws -> String {
		var address = propertyAddress(selector: kAudioDevicePropertyDeviceUID)
		var dataSize = UInt32(MemoryLayout<CFString?>.size)
		var unmanagedUid: Unmanaged<CFString>?

		let status = AudioObjectGetPropertyData(
			deviceID,
			&address,
			0,
			nil,
			&dataSize,
			&unmanagedUid
		)

		guard status == noErr,
			let unmanagedUid
		else {
			throw CaptureError.outputDeviceLookupFailed(status)
		}

		return unmanagedUid.takeRetainedValue() as String
	}

	private static func tapStreamDescription(
		for tapID: AudioObjectID
	) throws -> AudioStreamBasicDescription {
		var address = propertyAddress(selector: kAudioTapPropertyFormat)
		var streamDescription = AudioStreamBasicDescription()
		var dataSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)

		let status = AudioObjectGetPropertyData(
			tapID,
			&address,
			0,
			nil,
			&dataSize,
			&streamDescription
		)

		guard status == noErr else {
			throw CaptureError.tapFormatLookupFailed(status)
		}

		return streamDescription
	}
}

#if !GRANERI_COMBINED_AUDIO_HELPER
@main
enum SystemAudioCaptureCLI {
	static func main() {
		setbuf(stdout, nil)

		let emitter = NativeAudioStdoutEmitter(
			label: "com.graneri.system-audio.stdout"
		)
		let logger = NativeAudioStderrLogger(
			label: "com.graneri.system-audio.stderr"
		)
		let encoder = NativeAudioPcmChunkEncoder(
			emitter: emitter,
			label: "com.graneri.system-audio.encoder"
		)
		let capture = SystemAudioCapture(
			encoder: encoder,
			logger: logger,
			routeChangeHandler: {
				logger.log("[helper] system audio route changed, restarting capture")
				emitter.send(event: [
					"type": "error",
					"message": "System audio output changed. Restarting capture.",
				])
				exit(EXIT_FAILURE)
			}
		)
		var signalSources: [DispatchSourceSignal] = []
		logger.log("[helper] process launched")

		func stopCaptureAndExit(_ signal: Int32) -> Never {
			logger.log("[helper] received signal \(signal)")
			try? capture.stop()
			encoder.stop()
			emitter.send(event: [
				"type": "stopped",
				"signal": signal,
			])
			exit(signal == SIGTERM || signal == SIGINT ? 0 : 1)
		}

		for handledSignal in [SIGINT, SIGTERM] {
			signal(handledSignal, SIG_IGN)
			let source = DispatchSource.makeSignalSource(signal: handledSignal)
			source.setEventHandler {
				stopCaptureAndExit(handledSignal)
			}
			source.resume()
			signalSources.append(source)
		}

		do {
			let format = try capture.start()
			encoder.start()
			logger.log("[helper] emitting ready event")
			emitter.send(event: [
				"type": "ready",
				"channels": Int(format.channelCount),
				"debug": capture.debugInfo,
				"sampleRate": format.sampleRate,
			])
			RunLoop.main.run()
		} catch {
			logger.log("[helper] startup failed: \(error.localizedDescription)")
			emitter.send(event: [
				"type": "error",
				"message": error.localizedDescription,
			])
			exit(1)
		}
	}
}
#endif
