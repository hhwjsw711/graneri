import Dispatch
import Foundation

final class LineEventStdoutEmitter: @unchecked Sendable {
	private let queue: DispatchQueue
	private let fileHandle = FileHandle.standardOutput

	init(label: String) {
		queue = DispatchQueue(label: "\(label).stdout")
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

final class LineEventStderrLogger: @unchecked Sendable {
	private let queue: DispatchQueue
	private let fileHandle = FileHandle.standardError

	init(label: String) {
		queue = DispatchQueue(label: "\(label).stderr")
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
