@preconcurrency import AVFoundation
import CoreAudio
import Dispatch
import Foundation

enum MicrophoneCaptureError: Error, LocalizedError {
	case inputNodeUnavailable
	case invalidInputFormat
	case permissionDenied
	case tapFormatUnavailable
	case unableToCreateEngine

	var errorDescription: String? {
		switch self {
		case .inputNodeUnavailable:
			return "Microphone input node is unavailable."
		case .invalidInputFormat:
			return "Microphone input format is invalid."
		case .permissionDenied:
			return "Microphone access was denied."
		case .tapFormatUnavailable:
			return "Failed to create a microphone tap format."
		case .unableToCreateEngine:
			return "Failed to create the microphone audio engine."
		}
	}
}

enum MicrophoneVoiceProcessingMode: String {
	case disabled
	case routeScoped
}

final class MicrophoneCapture: @unchecked Sendable {
	private let encoder: NativeAudioPcmSink
	private let logger: NativeAudioStderrLogger
	private let routeChangeHandler: @Sendable () -> Void
	private let voiceProcessingMode: MicrophoneVoiceProcessingMode
	private var engine: AVAudioEngine?
	private var hasInstalledTap = false
	private var engineConfigurationObserver: NSObjectProtocol?
	private var hasHandledRouteChange = false
	private var routeSignature: String?
	private(set) var voiceProcessingEnabled = false
	private(set) var voiceProcessingOutputEnabled = false
	private(set) var voiceProcessingDuckingEnabled = false
	private(set) var voiceProcessingDuckingLevel: String?
	private(set) var routeDebugInfo: [String: Any] = [:]
	private(set) var outputVolumeBeforeCapture: Float?
	private(set) var outputVolumeForCapture: Float?

	init(
		encoder: NativeAudioPcmSink,
		logger: NativeAudioStderrLogger,
		routeChangeHandler: @escaping @Sendable () -> Void,
		voiceProcessingMode: MicrophoneVoiceProcessingMode = .routeScoped
	) {
		self.encoder = encoder
		self.logger = logger
		self.routeChangeHandler = routeChangeHandler
		self.voiceProcessingMode = voiceProcessingMode
	}

	func start() throws -> AVAudioFormat {
		try stop()
		logger.log("[helper] microphone start() entered")
		hasHandledRouteChange = false
		routeSignature = nil
		voiceProcessingEnabled = false
		voiceProcessingOutputEnabled = false
		voiceProcessingDuckingEnabled = false
		voiceProcessingDuckingLevel = nil
		routeDebugInfo = [:]
		outputVolumeBeforeCapture = nil
		outputVolumeForCapture = nil

		let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)
		guard authorizationStatus == .authorized else {
			throw MicrophoneCaptureError.permissionDenied
		}

		let nextEngine = AVAudioEngine()
		let inputNode = nextEngine.inputNode
		let outputNode = nextEngine.outputNode
		let initialInputFormat = inputNode.outputFormat(forBus: 0)
		let initialOutputFormat = outputNode.inputFormat(forBus: 0)
		let inputDevice = Self.defaultInputDevice()
		let outputDevice = Self.defaultOutputDevice()
		outputVolumeBeforeCapture = Self.deviceOutputVolume(outputDevice)
		routeSignature = Self.routeSignature(
			inputDevice: inputDevice,
			outputDevice: outputDevice
		)

		let routeAllowsVoiceProcessing = Self.shouldEnableVoiceProcessing(
			inputDevice: inputDevice,
			outputDevice: outputDevice
		)
		let shouldEnableVoiceProcessing =
			voiceProcessingMode == .routeScoped && routeAllowsVoiceProcessing
		let outputDeviceIsHeadphones = Self.isHeadphoneOutputDevice(outputDevice)
		if shouldEnableVoiceProcessing, #available(macOS 10.15, *) {
			do {
				try inputNode.setVoiceProcessingEnabled(true)
				inputNode.isVoiceProcessingBypassed = false

				if #available(macOS 14.0, *) {
					inputNode.voiceProcessingOtherAudioDuckingConfiguration =
						AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
							enableAdvancedDucking: false,
							duckingLevel: .min
						)
					voiceProcessingDuckingEnabled = false
					voiceProcessingDuckingLevel = "min"
				}

				logger.log(
					"[helper] microphone voice processing requested for route input=\(inputDevice["uid"] as? String ?? "") output=\(outputDevice["uid"] as? String ?? "")"
				)
			} catch {
				logger.log(
					"[helper] microphone voice processing unavailable: \(error.localizedDescription)"
				)
			}
		}

		let inputFormat = inputNode.outputFormat(forBus: 0)
		let outputFormat = outputNode.inputFormat(forBus: 0)
		if #available(macOS 10.15, *) {
			voiceProcessingEnabled = inputNode.isVoiceProcessingEnabled
			voiceProcessingOutputEnabled = outputNode.isVoiceProcessingEnabled
		}
		outputVolumeForCapture = Self.deviceOutputVolume(outputDevice)
		routeDebugInfo = [
			"devicesMatch": inputDevice["uid"] as? String == outputDevice["uid"] as? String,
			"inputDevice": inputDevice,
			"inputFormatBeforeCapture": Self.describeFormat(initialInputFormat),
			"inputFormatForCapture": Self.describeFormat(inputFormat),
			"outputDevice": outputDevice,
			"outputDeviceIsHeadphones": outputDeviceIsHeadphones,
			"outputFormatBeforeCapture": Self.describeFormat(initialOutputFormat),
			"outputFormatForCapture": Self.describeFormat(outputFormat),
			"outputVolumeBeforeCapture": outputVolumeBeforeCapture ?? NSNull(),
			"outputVolumeForCapture": outputVolumeForCapture ?? NSNull(),
			"voiceProcessingDuckingEnabled": voiceProcessingDuckingEnabled,
			"voiceProcessingDuckingLevel": voiceProcessingDuckingLevel ?? NSNull(),
			"voiceProcessingMode": voiceProcessingMode.rawValue,
			"voiceProcessingRequested": shouldEnableVoiceProcessing,
			"voiceProcessingRouteAllowed": routeAllowsVoiceProcessing,
		]
		logger.log("[helper] microphone route \(routeDebugInfo)")

		guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
			throw MicrophoneCaptureError.invalidInputFormat
		}

		guard let tapFormat = AVAudioFormat(
			standardFormatWithSampleRate: inputFormat.sampleRate,
			channels: 1
		) else {
			throw MicrophoneCaptureError.tapFormatUnavailable
		}

		inputNode.installTap(onBus: 0, bufferSize: 4096, format: tapFormat) {
			[weak self] buffer, _ in
			self?.encoder.append(buffer: buffer)
		}
		hasInstalledTap = true

		do {
			try nextEngine.start()
		} catch {
			inputNode.removeTap(onBus: 0)
			hasInstalledTap = false
			throw error
		}

		engine = nextEngine
		engineConfigurationObserver = NotificationCenter.default.addObserver(
			forName: .AVAudioEngineConfigurationChange,
			object: nextEngine,
			queue: nil
		) { [weak self] _ in
			self?.handleEngineConfigurationChange()
		}
		return tapFormat
	}

	func stop() throws {
		guard let engine else {
			return
		}

		if hasInstalledTap {
			engine.inputNode.removeTap(onBus: 0)
			hasInstalledTap = false
		}

		if let engineConfigurationObserver {
			NotificationCenter.default.removeObserver(engineConfigurationObserver)
			self.engineConfigurationObserver = nil
		}

		engine.stop()
		self.engine = nil
		hasHandledRouteChange = false
	}

	private func handleEngineConfigurationChange() {
		guard !hasHandledRouteChange else {
			return
		}

		let nextInputDevice = Self.defaultInputDevice()
		let nextOutputDevice = Self.defaultOutputDevice()
		let nextRouteSignature = Self.routeSignature(
			inputDevice: nextInputDevice,
			outputDevice: nextOutputDevice
		)

		if nextRouteSignature == routeSignature {
			logger.log("[helper] microphone engine configuration changed without route change")
			return
		}

		hasHandledRouteChange = true
		logger.log("[helper] microphone engine configuration changed")
		routeChangeHandler()
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

	private static func defaultInputDevice() -> [String: Any] {
		describeDefaultDevice(selector: kAudioHardwarePropertyDefaultInputDevice)
	}

	private static func defaultOutputDevice() -> [String: Any] {
		describeDefaultDevice(selector: kAudioHardwarePropertyDefaultOutputDevice)
	}

	private static func routeSignature(
		inputDevice: [String: Any],
		outputDevice: [String: Any]
	) -> String {
		let inputUID = inputDevice["uid"] as? String ?? ""
		let outputUID = outputDevice["uid"] as? String ?? ""
		let inputID = inputDevice["id"] as? Int ?? 0
		let outputID = outputDevice["id"] as? Int ?? 0
		return "input:\(inputID):\(inputUID)|output:\(outputID):\(outputUID)"
	}

	private static func deviceOutputVolume(_ device: [String: Any]) -> Float? {
		guard let deviceID = device["id"] as? Int, deviceID > 0 else {
			return nil
		}

		var address = propertyAddress(
			selector: kAudioDevicePropertyVolumeScalar,
			scope: kAudioDevicePropertyScopeOutput
		)
		var volume = Float32(0)
		var dataSize = UInt32(MemoryLayout<Float32>.size)
		let status = AudioObjectGetPropertyData(
			AudioDeviceID(deviceID),
			&address,
			0,
			nil,
			&dataSize,
			&volume
		)

		guard status == noErr else {
			return nil
		}

		return volume
	}

	private static func shouldEnableVoiceProcessing(
		inputDevice: [String: Any],
		outputDevice: [String: Any]
	) -> Bool {
		isBuiltInDevice(inputDevice) &&
			isBuiltInDevice(outputDevice) &&
			!isHeadphoneOutputDevice(outputDevice)
	}

	private static func isBuiltInDevice(_ device: [String: Any]) -> Bool {
		guard let transportType = device["transportType"] as? Int else {
			return false
		}

		return transportType == Int(kAudioDeviceTransportTypeBuiltIn)
	}

	private static func isHeadphoneOutputDevice(_ device: [String: Any]) -> Bool {
		let candidateValues = [
			device["name"] as? String,
			device["uid"] as? String,
		]
		let normalizedValues = candidateValues
			.compactMap { $0?.lowercased() }
			.joined(separator: " ")

		return normalizedValues.contains("headphone") ||
			normalizedValues.contains("headset") ||
			normalizedValues.contains("earphone") ||
			normalizedValues.contains("earbud") ||
			normalizedValues.contains("airpods")
	}

	private static func describeDefaultDevice(
		selector: AudioObjectPropertySelector
	) -> [String: Any] {
		var address = propertyAddress(selector: selector)
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
			return [
				"id": 0,
				"lookupStatus": Int(status),
				"name": NSNull(),
				"uid": NSNull(),
			]
		}

		return [
			"id": Int(deviceID),
			"lookupStatus": Int(status),
			"name": deviceName(for: deviceID) ?? NSNull(),
			"transportType": deviceTransportType(for: deviceID).map { Int($0) } ?? NSNull(),
			"uid": deviceUID(for: deviceID) ?? NSNull(),
		]
	}

	private static func deviceName(for deviceID: AudioDeviceID) -> String? {
		var address = propertyAddress(selector: kAudioObjectPropertyName)
		var unmanagedName: Unmanaged<CFString>?
		var dataSize = UInt32(MemoryLayout<CFString?>.size)
		let status = AudioObjectGetPropertyData(
			deviceID,
			&address,
			0,
			nil,
			&dataSize,
			&unmanagedName
		)

		guard status == noErr, let unmanagedName else {
			return nil
		}

		return unmanagedName.takeRetainedValue() as String
	}

	private static func deviceUID(for deviceID: AudioDeviceID) -> String? {
		var address = propertyAddress(selector: kAudioDevicePropertyDeviceUID)
		var unmanagedUID: Unmanaged<CFString>?
		var dataSize = UInt32(MemoryLayout<CFString?>.size)
		let status = AudioObjectGetPropertyData(
			deviceID,
			&address,
			0,
			nil,
			&dataSize,
			&unmanagedUID
		)

		guard status == noErr, let unmanagedUID else {
			return nil
		}

		return unmanagedUID.takeRetainedValue() as String
	}

	private static func deviceTransportType(for deviceID: AudioDeviceID) -> UInt32? {
		var address = propertyAddress(selector: kAudioDevicePropertyTransportType)
		var transportType = UInt32(0)
		var dataSize = UInt32(MemoryLayout<UInt32>.size)
		let status = AudioObjectGetPropertyData(
			deviceID,
			&address,
			0,
			nil,
			&dataSize,
			&transportType
		)

		guard status == noErr else {
			return nil
		}

		return transportType
	}

	private static func describeFormat(_ format: AVAudioFormat) -> [String: Any] {
		[
			"channelCount": Int(format.channelCount),
			"commonFormat": format.commonFormat.rawValue,
			"isInterleaved": format.isInterleaved,
			"sampleRate": format.sampleRate,
		]
	}
}

#if !GRANERI_COMBINED_AUDIO_HELPER
@main
enum MicrophoneCaptureCLI {
	static func main() {
		setbuf(stdout, nil)

		let emitter = NativeAudioStdoutEmitter(
			label: "com.graneri.microphone.stdout"
		)
		let logger = NativeAudioStderrLogger(
			label: "com.graneri.microphone.stderr"
		)
		let encoder = NativeAudioPcmChunkEncoder(
			emitter: emitter,
			label: "com.graneri.microphone.encoder"
		)
		let capture = MicrophoneCapture(
			encoder: encoder,
			logger: logger,
			routeChangeHandler: {
				logger.log("[helper] microphone route changed, restarting capture")
				emitter.send(event: [
					"type": "error",
					"message": "Microphone device changed. Restarting capture.",
				])
				exit(EXIT_FAILURE)
			}
		)
		var signalSources: [DispatchSourceSignal] = []

		func stopCaptureAndExit(_ signal: Int32) -> Never {
			logger.log("[helper] received signal \(signal)")
			encoder.stop()
			try? capture.stop()
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
			emitter.send(event: [
				"type": "ready",
				"channels": Int(format.channelCount),
				"route": capture.routeDebugInfo,
				"sampleRate": Int(format.sampleRate.rounded()),
				"voiceProcessingDuckingEnabled": capture.voiceProcessingDuckingEnabled,
				"voiceProcessingDuckingLevel": capture.voiceProcessingDuckingLevel ?? NSNull(),
				"voiceProcessingEnabled": capture.voiceProcessingEnabled,
				"voiceProcessingOutputEnabled": capture.voiceProcessingOutputEnabled,
			])
			withExtendedLifetime(signalSources) {
				dispatchMain()
			}
		} catch {
			logger.log("[helper] microphone failed: \(error.localizedDescription)")
			emitter.send(event: [
				"type": "error",
				"message": error.localizedDescription,
			])
			exit(EXIT_FAILURE)
		}
	}
}
#endif
