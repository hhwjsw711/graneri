import ApplicationServices
import CoreGraphics
import Foundation

private let emitter = LineEventStdoutEmitter(label: "com.graneri.global-dictation-hotkey")
private let logger = LineEventStderrLogger(label: "com.graneri.global-dictation-hotkey")
private let controlFlag = CGEventFlags.maskControl
private let optionFlag = CGEventFlags.maskAlternate
private let mKeyCode: CGKeyCode = 46
private let shortcutLabel = "Control+Option+M"
private var isHoldingShortcut = false

private func hasDictationShortcutModifiers(_ flags: CGEventFlags) -> Bool {
	return flags.contains(controlFlag) && flags.contains(optionFlag)
}

private func emit(_ type: String) {
	emitter.send(event: [
		"type": type,
		"shortcut": shortcutLabel,
	])
}

private let callback: CGEventTapCallBack = { _, type, event, _ in
	let flags = event.flags
	let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

	switch type {
	case .keyDown:
		if keyCode == mKeyCode && hasDictationShortcutModifiers(flags) && !isHoldingShortcut {
			isHoldingShortcut = true
			emit("start")
			return nil
		}
	case .keyUp:
		if keyCode == mKeyCode && isHoldingShortcut {
			isHoldingShortcut = false
			emit("stop")
			return nil
		}
	case .flagsChanged:
		if isHoldingShortcut && !hasDictationShortcutModifiers(flags) {
			isHoldingShortcut = false
			emit("stop")
		}
	default:
		break
	}

	return Unmanaged.passUnretained(event)
}

@main
struct GlobalDictationHotkeyCLI {
	static func main() {
		let eventMask =
			(1 << CGEventType.keyDown.rawValue) |
			(1 << CGEventType.keyUp.rawValue) |
			(1 << CGEventType.flagsChanged.rawValue)

		guard let eventTap = CGEvent.tapCreate(
			tap: .cgSessionEventTap,
			place: .headInsertEventTap,
			options: .defaultTap,
			eventsOfInterest: CGEventMask(eventMask),
			callback: callback,
			userInfo: nil
		) else {
			logger.log("Failed to create global dictation hotkey event tap. Enable Accessibility access for Graneri.")
			emitter.send(event: [
				"type": "error",
				"message": "Enable Accessibility access for Graneri to use global dictation.",
			])
			exit(1)
		}

		let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
		CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
		CGEvent.tapEnable(tap: eventTap, enable: true)
		emitter.send(event: [
			"type": "ready",
			"shortcut": shortcutLabel,
		])
		CFRunLoopRun()
	}
}
