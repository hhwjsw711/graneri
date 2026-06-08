import AppKit
import AudioToolbox
import CoreAudio
import Dispatch
import Foundation

final class MicrophoneActivityMonitor: @unchecked Sendable {
	private struct ActiveInputClient {
		let bundleID: String?
		let name: String
		let pid: pid_t
	}

	private let emitter: LineEventStdoutEmitter
	private let logger: LineEventStderrLogger
	private let queue = DispatchQueue(label: "com.graneri.microphone-activity.listener")
	private var deviceIDs: [AudioDeviceID] = []
	private var lastActive = false
	private var lastSourceName: String?

	init(emitter: LineEventStdoutEmitter, logger: LineEventStderrLogger) {
		self.emitter = emitter
		self.logger = logger
	}

	func start() {
		queue.sync {
			deviceIDs = Self.physicalInputDeviceIDs()

			for deviceID in deviceIDs {
				var address = AudioObjectPropertyAddress(
					mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
					mScope: kAudioObjectPropertyScopeGlobal,
					mElement: kAudioObjectPropertyElementMain
				)

				let selfPtr = Unmanaged.passUnretained(self).toOpaque()
				AudioObjectAddPropertyListener(deviceID, &address, Self.listenerCallback, selfPtr)
			}

			let snapshot = Self.inputActivitySnapshot(deviceIDs: deviceIDs)
			lastActive = snapshot.active
			lastSourceName = snapshot.sourceName
			emitter.send(event: Self.eventPayload(type: "ready", snapshot: snapshot))
		}
	}

	func stop() {
		queue.sync {
			for deviceID in deviceIDs {
				var address = AudioObjectPropertyAddress(
					mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
					mScope: kAudioObjectPropertyScopeGlobal,
					mElement: kAudioObjectPropertyElementMain
				)

				let selfPtr = Unmanaged.passUnretained(self).toOpaque()
				AudioObjectRemovePropertyListener(deviceID, &address, Self.listenerCallback, selfPtr)
			}

			deviceIDs.removeAll()
		}
	}

	deinit {
		stop()
	}

	private static let listenerCallback: AudioObjectPropertyListenerProc = {
		_, _, _, clientData in
		guard let clientData else {
			return kAudioHardwareNoError
		}

		let monitor = Unmanaged<MicrophoneActivityMonitor>.fromOpaque(clientData)
			.takeUnretainedValue()
		monitor.emitIfNeeded()
		return kAudioHardwareNoError
	}

	private func emitIfNeeded() {
		queue.async { [weak self] in
			guard let self else {
				return
			}

			let snapshot = Self.inputActivitySnapshot(deviceIDs: self.deviceIDs)
			guard snapshot.active != self.lastActive || snapshot.sourceName != self.lastSourceName else {
				return
			}

			self.lastActive = snapshot.active
			self.lastSourceName = snapshot.sourceName
			self.emitter.send(event: Self.eventPayload(type: "active-changed", snapshot: snapshot))
		}
	}

	private static func eventPayload(
		type: String,
		snapshot: (active: Bool, sourceName: String?, clients: [ActiveInputClient])
	) -> [String: Any] {
		var payload: [String: Any] = [
			"type": type,
			"active": snapshot.active,
			"activeClients": snapshot.clients.map { client in
				var clientPayload: [String: Any] = [
					"name": client.name,
					"pid": Int(client.pid),
				]

				if let bundleID = client.bundleID, !bundleID.isEmpty {
					clientPayload["bundleId"] = bundleID
				}

				return clientPayload
			},
		]

		if let sourceName = snapshot.sourceName, !sourceName.isEmpty {
			payload["sourceName"] = sourceName
		}

		return payload
	}

	private static func inputActivitySnapshot(
		deviceIDs: [AudioDeviceID]
	) -> (active: Bool, sourceName: String?, clients: [ActiveInputClient]) {
		let active = deviceIDs.contains { Self.isDeviceRunning($0) }
		guard active else {
			return (false, nil, [])
		}

		let clients = activeInputClients().filter { client in
			!Self.isGraneriClient(client) && Self.clientUsesInputDevice(client.pid, matching: Set(deviceIDs))
		}
		return (true, Self.preferredActiveInputClientName(from: clients), clients)
	}

	private static func preferredActiveInputClientName(from clients: [ActiveInputClient]) -> String? {
		return clients.sorted { left, right in
			Self.clientRank(left) < Self.clientRank(right)
		}.first?.name
	}

	private static func activeInputClients() -> [ActiveInputClient] {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioHardwarePropertyProcessObjectList,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)
		var dataSize: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize
		) == kAudioHardwareNoError else {
			return []
		}

		let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
		var processIDs = [AudioObjectID](repeating: 0, count: count)
		guard AudioObjectGetPropertyData(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize,
			&processIDs
		) == kAudioHardwareNoError else {
			return []
		}

		return processIDs.compactMap { processID in
			guard Self.isProcessRunningInput(processID), let pid = Self.processPID(processID) else {
				return nil
			}

			let application = NSRunningApplication(processIdentifier: pid)
			let bundleID = Self.processBundleID(processID) ?? application?.bundleIdentifier
			let name = Self.canonicalClientName(
				bundleID: bundleID,
				localizedName: application?.localizedName
			)
			let fallbackName = bundleID?.split(separator: ".").last.map(String.init)
			guard let resolvedName = (name?.isEmpty == false ? name : fallbackName), !resolvedName.isEmpty else {
				return nil
			}

			return ActiveInputClient(bundleID: bundleID, name: resolvedName, pid: pid)
		}
	}

	private static func isProcessRunningInput(_ processID: AudioObjectID) -> Bool {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioProcessPropertyIsRunningInput,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)
		var isRunning: UInt32 = 0
		var size = UInt32(MemoryLayout<UInt32>.size)
		let status = AudioObjectGetPropertyData(processID, &address, 0, nil, &size, &isRunning)
		return status == kAudioHardwareNoError && isRunning != 0
	}

	private static func processPID(_ processID: AudioObjectID) -> pid_t? {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioProcessPropertyPID,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)
		var pid = pid_t(0)
		var size = UInt32(MemoryLayout<pid_t>.size)
		let status = AudioObjectGetPropertyData(processID, &address, 0, nil, &size, &pid)
		return status == kAudioHardwareNoError && pid > 0 ? pid : nil
	}

	private static func processBundleID(_ processID: AudioObjectID) -> String? {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioProcessPropertyBundleID,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)
		var bundleID: Unmanaged<CFString>?
		var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
		let status = AudioObjectGetPropertyData(processID, &address, 0, nil, &size, &bundleID)
		guard status == kAudioHardwareNoError else {
			return nil
		}

		return bundleID?.takeRetainedValue() as String?
	}

	private static func clientUsesInputDevice(_ pid: pid_t, matching inputDeviceIDs: Set<AudioDeviceID>) -> Bool {
		guard let processID = Self.processObjectID(for: pid) else {
			return true
		}

		var address = AudioObjectPropertyAddress(
			mSelector: kAudioProcessPropertyDevices,
			mScope: kAudioObjectPropertyScopeInput,
			mElement: kAudioObjectPropertyElementMain
		)
		var dataSize: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(processID, &address, 0, nil, &dataSize) == kAudioHardwareNoError else {
			return true
		}

		let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
		var processDeviceIDs = [AudioObjectID](repeating: 0, count: count)
		guard AudioObjectGetPropertyData(processID, &address, 0, nil, &dataSize, &processDeviceIDs) == kAudioHardwareNoError else {
			return true
		}

		return processDeviceIDs.contains { inputDeviceIDs.contains($0) }
	}

	private static func processObjectID(for pid: pid_t) -> AudioObjectID? {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)
		var processID = AudioObjectID(kAudioObjectUnknown)
		var qualifier = pid
		var size = UInt32(MemoryLayout<AudioObjectID>.size)
		let status = AudioObjectGetPropertyData(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			UInt32(MemoryLayout<pid_t>.size),
			&qualifier,
			&size,
			&processID
		)

		return status == kAudioHardwareNoError && processID != AudioObjectID(kAudioObjectUnknown) ? processID : nil
	}

	private static func isGraneriClient(_ client: ActiveInputClient) -> Bool {
		client.bundleID?.hasPrefix("com.graneri") == true || client.name == "Graneri"
	}

	private static func canonicalClientName(bundleID: String?, localizedName: String?) -> String? {
		let normalizedBundleID = bundleID?.lowercased() ?? ""

		if normalizedBundleID.contains("company.thebrowser") {
			return "Arc"
		}

		if normalizedBundleID.contains("com.google.chrome") {
			return "Google Chrome"
		}

		if normalizedBundleID.contains("com.brave.browser") {
			return "Brave Browser"
		}

		if normalizedBundleID.contains("com.microsoft.edgemac") {
			return "Microsoft Edge"
		}

		if normalizedBundleID.contains("org.mozilla.firefox") {
			return "Firefox"
		}

		if normalizedBundleID.contains("org.chromium.chromium") {
			return "Chromium"
		}

		if normalizedBundleID.contains("com.apple.safari") {
			return "Safari"
		}

		if normalizedBundleID.contains("us.zoom") || normalizedBundleID.contains("zoom.us") {
			return "zoom.us"
		}

		if normalizedBundleID.contains("com.hnc.discord") {
			return "Discord"
		}

		return localizedName?.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	private static func clientRank(_ client: ActiveInputClient) -> Int {
		let normalizedName = client.name.lowercased()
		let normalizedBundleID = client.bundleID?.lowercased() ?? ""
		let preferredTokens = ["zoom", "teams", "slack", "facetime", "whatsapp", "discord", "chrome", "safari", "arc", "brave", "edge", "firefox"]

		if preferredTokens.contains(where: { normalizedName.contains($0) || normalizedBundleID.contains($0) }) {
			return 0
		}

		return 1
	}

	private static func physicalInputDeviceIDs() -> [AudioDeviceID] {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioHardwarePropertyDevices,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)

		var dataSize: UInt32 = 0
		guard AudioObjectGetPropertyDataSize(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize
		) == kAudioHardwareNoError else {
			return []
		}

		let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
		var deviceIDs = [AudioDeviceID](repeating: 0, count: count)
		guard AudioObjectGetPropertyData(
			AudioObjectID(kAudioObjectSystemObject),
			&address,
			0,
			nil,
			&dataSize,
			&deviceIDs
		) == kAudioHardwareNoError else {
			return []
		}

		return deviceIDs.filter { deviceID in
			var inputAddress = AudioObjectPropertyAddress(
				mSelector: kAudioDevicePropertyStreams,
				mScope: kAudioDevicePropertyScopeInput,
				mElement: kAudioObjectPropertyElementMain
			)
			var inputSize: UInt32 = 0
			let status = AudioObjectGetPropertyDataSize(
				deviceID,
				&inputAddress,
				0,
				nil,
				&inputSize
			)
			return status == kAudioHardwareNoError && inputSize > 0
		}
	}

	private static func isDeviceRunning(_ deviceID: AudioDeviceID) -> Bool {
		var address = AudioObjectPropertyAddress(
			mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
			mScope: kAudioObjectPropertyScopeGlobal,
			mElement: kAudioObjectPropertyElementMain
		)
		var isRunning: UInt32 = 0
		var size = UInt32(MemoryLayout<UInt32>.size)
		let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &isRunning)
		return status == kAudioHardwareNoError && isRunning != 0
	}
}

@main
enum MicrophoneActivityCLI {
	static func main() {
		setbuf(stdout, nil)

		let emitter = LineEventStdoutEmitter(label: "com.graneri.microphone-activity")
		let logger = LineEventStderrLogger(label: "com.graneri.microphone-activity")
		let monitor = MicrophoneActivityMonitor(emitter: emitter, logger: logger)

		logger.log("[helper] microphone activity monitor starting")
		monitor.start()

		signal(SIGINT) { _ in
			exit(EXIT_SUCCESS)
		}

		signal(SIGTERM) { _ in
			exit(EXIT_SUCCESS)
		}

		RunLoop.main.run()
	}
}
