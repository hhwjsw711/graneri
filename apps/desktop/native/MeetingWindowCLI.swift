import AppKit
import ApplicationServices
import Dispatch
import Foundation

final class MeetingWindowMonitor: @unchecked Sendable {
	private struct MeetingWindow: Equatable {
		let appName: String
		let bundleID: String?
		let pid: pid_t
		let provider: String
		let title: String?
	}

	private let emitter: LineEventStdoutEmitter
	private let logger: LineEventStderrLogger
	private let queue = DispatchQueue(label: "com.graneri.meeting-window.monitor")
	private var timer: DispatchSourceTimer?
	private var lastWindow: MeetingWindow?
	private var lastPermissionGranted: Bool?

	init(emitter: LineEventStdoutEmitter, logger: LineEventStderrLogger) {
		self.emitter = emitter
		self.logger = logger
	}

	func start() {
		queue.sync {
			emit(type: "ready", force: true)

			let timer = DispatchSource.makeTimerSource(queue: queue)
			timer.schedule(deadline: .now() + .seconds(1), repeating: .seconds(2))
			timer.setEventHandler { [weak self] in
				self?.emit(type: "window-changed", force: false)
			}
			timer.resume()
			self.timer = timer
		}
	}

	func stop() {
		queue.sync {
			timer?.cancel()
			timer = nil
		}
	}

	deinit {
		stop()
	}

	private func emit(type: String, force: Bool) {
		let permissionGranted = AXIsProcessTrusted()
		let window = permissionGranted ? Self.detectMeetingWindow() : nil

		guard force || window != lastWindow || permissionGranted != lastPermissionGranted else {
			return
		}

		lastWindow = window
		lastPermissionGranted = permissionGranted
		emitter.send(event: Self.eventPayload(type: type, permissionGranted: permissionGranted, window: window))
	}

	private static func eventPayload(
		type: String,
		permissionGranted: Bool,
		window: MeetingWindow?
	) -> [String: Any] {
		var payload: [String: Any] = [
			"type": type,
			"permissionGranted": permissionGranted,
		]

		guard let window else {
			payload["active"] = false
			return payload
		}

		payload["active"] = true
		payload["appName"] = window.appName
		payload["pid"] = Int(window.pid)
		payload["provider"] = window.provider

		if let bundleID = window.bundleID, !bundleID.isEmpty {
			payload["bundleId"] = bundleID
		}

		if let title = window.title, !title.isEmpty {
			payload["title"] = title
		}

		return payload
	}

	private static func detectMeetingWindow() -> MeetingWindow? {
		let candidates = NSWorkspace.shared.runningApplications.compactMap { application -> MeetingWindow? in
			guard !application.isTerminated, let provider = providerName(for: application) else {
				return nil
			}

			return detectMeetingWindow(application: application, provider: provider)
		}

		return candidates.sorted { left, right in
			providerRank(left.provider) < providerRank(right.provider)
		}.first
	}

	private static func detectMeetingWindow(
		application: NSRunningApplication,
		provider: String
	) -> MeetingWindow? {
		let appElement = AXUIElementCreateApplication(application.processIdentifier)
		var windowsValue: CFTypeRef?
		guard AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsValue) == .success,
			let windows = windowsValue as? [AXUIElement]
		else {
			return nil
		}

		for window in windows {
			guard !isWindowMinimized(window) else {
				continue
			}

			let title = windowTitle(window)
			if isMeetingWindowTitle(title, provider: provider) {
				return MeetingWindow(
					appName: application.localizedName ?? provider,
					bundleID: application.bundleIdentifier,
					pid: application.processIdentifier,
					provider: provider,
					title: title
				)
			}
		}

		return nil
	}

	private static func providerName(for application: NSRunningApplication) -> String? {
		let bundleID = application.bundleIdentifier?.lowercased() ?? ""
		let name = application.localizedName?.lowercased() ?? ""

		if bundleID.contains("us.zoom") || bundleID.contains("zoom.us") || name.contains("zoom") {
			return "Zoom"
		}

		if bundleID.contains("com.microsoft.teams") || name.contains("microsoft teams") {
			return "Microsoft Teams"
		}

		if bundleID.contains("com.apple.facetime") || name == "facetime" {
			return "FaceTime"
		}

		if bundleID.contains("com.tinyspeck.slackmacgap") || name == "slack" {
			return "Slack Huddle"
		}

		if bundleID.contains("net.whatsapp.whatsapp") || name == "whatsapp" {
			return "WhatsApp"
		}

		if bundleID.contains("com.hnc.discord") || name == "discord" {
			return "Discord"
		}

		return nil
	}

	private static func providerRank(_ provider: String) -> Int {
		switch provider {
		case "Zoom":
			return 0
		case "Microsoft Teams":
			return 1
		default:
			return 2
		}
	}

	private static func isMeetingWindowTitle(_ title: String?, provider: String) -> Bool {
		let normalizedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""

		switch provider {
		case "Zoom":
			let excludedTokens = [
				"apps",
				"clips",
				"contacts",
				"home",
				"login",
				"mail",
				"meetings",
				"preferences",
				"settings",
				"sign in",
				"team chat",
				"whiteboards",
				"zoom workplace",
			]
			if excludedTokens.contains(where: { normalizedTitle.contains($0) }) {
				return false
			}

			return true
		case "Microsoft Teams":
			let excludedTokens = ["calendar", "chat", "settings", "activity"]
			if normalizedTitle.isEmpty || excludedTokens.contains(where: { normalizedTitle == $0 }) {
				return false
			}

			return normalizedTitle.contains("meeting")
				|| normalizedTitle.contains("call")
		case "FaceTime":
			let excludedTokens = ["preferences", "settings"]
			return !normalizedTitle.isEmpty && !excludedTokens.contains(where: { normalizedTitle.contains($0) })
		case "Slack Huddle":
			return normalizedTitle.contains("huddle")
				|| normalizedTitle.contains("call")
		case "WhatsApp", "Discord":
			return normalizedTitle.contains("call")
				|| normalizedTitle.contains("voice")
				|| normalizedTitle.contains("video")
		default:
			return false
		}
	}

	private static func isWindowMinimized(_ window: AXUIElement) -> Bool {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &value) == .success else {
			return false
		}

		return (value as? Bool) == true
	}

	private static func windowTitle(_ window: AXUIElement) -> String? {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &value) == .success else {
			return nil
		}

		return value as? String
	}
}

@main
enum MeetingWindowCLI {
	static func main() {
		setbuf(stdout, nil)

		let emitter = LineEventStdoutEmitter(label: "com.graneri.meeting-window")
		let logger = LineEventStderrLogger(label: "com.graneri.meeting-window")
		let monitor = MeetingWindowMonitor(emitter: emitter, logger: logger)

		logger.log("[helper] meeting window monitor starting")
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
