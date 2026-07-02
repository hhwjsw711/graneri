import Dispatch
import Foundation

final class CombinedAudioRouteChangeState: @unchecked Sendable {
	private let queue = DispatchQueue(label: "com.graneri.combined-audio.route-change")
	private var didHandleRouteChange = false

	func markHandledIfNeeded() -> Bool {
		queue.sync {
			if didHandleRouteChange {
				return false
			}

			didHandleRouteChange = true
			return true
		}
	}
}

@main
enum CombinedAudioCaptureCLI {
	private static func sendSelfTestResult(_ event: [String: Any]) {
		guard JSONSerialization.isValidJSONObject(event),
			let data = try? JSONSerialization.data(withJSONObject: event)
		else {
			return
		}

		FileHandle.standardOutput.write(data)
		FileHandle.standardOutput.write(Data([0x0A]))
	}

	static func main() {
		setbuf(stdout, nil)

		let emitter = NativeAudioStdoutEmitter(
			label: "com.graneri.combined-audio.stdout"
		)
		let logger = NativeAudioStderrLogger(
			label: "com.graneri.combined-audio.stderr"
		)
		if CommandLine.arguments.contains("--self-test") {
			let result = CombinedAudioProcessingPipeline.runSelfTest(logger: logger)
			sendSelfTestResult(result.asEvent())
			exit(result.isPassing ? EXIT_SUCCESS : EXIT_FAILURE)
		}

		let pairedEncoder = NativeAudioPairedPcmChunkEncoder(
			emitter: emitter,
			label: "com.graneri.combined-audio.paired.encoder"
		)
		let audioProcessingPipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: pairedEncoder.microphoneSink,
			systemAudioOutput: pairedEncoder.systemAudioSink,
			onDiagnostics: { event in
				emitter.send(event: event)
			}
		)
		let routeChangeState = CombinedAudioRouteChangeState()
		let routeChangeHandler: @Sendable () -> Void = {
			guard routeChangeState.markHandledIfNeeded() else {
				return
			}
			logger.log("[helper] combined audio route changed, restarting capture")
			emitter.send(event: [
				"type": "error",
				"message": "Audio route changed. Restarting combined capture.",
			])
			exit(EXIT_FAILURE)
		}
		let microphoneCapture = MicrophoneCapture(
			encoder: audioProcessingPipeline.microphoneSink,
			logger: logger,
			routeChangeHandler: routeChangeHandler,
			voiceProcessingMode: .disabled
		)
		var systemAudioCapture: SystemAudioCapture?
		var signalSources: [DispatchSourceSignal] = []
		logger.log("[helper] combined audio process launched")

		func stopCaptureAndExit(_ signal: Int32) -> Never {
			logger.log("[helper] combined audio received signal \(signal)")
			pairedEncoder.stop()
			try? microphoneCapture.stop()
			try? systemAudioCapture?.stop()
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
			let microphoneFormat = try microphoneCapture.start()
			let nextSystemAudioCapture = SystemAudioCapture(
				encoder: audioProcessingPipeline.systemAudioSink,
				logger: logger,
				routeChangeHandler: routeChangeHandler,
				targetSampleRate: microphoneFormat.sampleRate
			)
			systemAudioCapture = nextSystemAudioCapture
			let systemAudioFormat = try nextSystemAudioCapture.start()
			pairedEncoder.start()
			logger.log("[helper] combined audio emitting ready event")
			emitter.send(event: [
				"type": "ready",
				"audioProcessing": audioProcessingPipeline.describe(),
				"microphone": [
					"channels": Int(microphoneFormat.channelCount),
					"route": microphoneCapture.routeDebugInfo,
					"sampleRate": Int(microphoneFormat.sampleRate.rounded()),
					"voiceProcessingDuckingEnabled": microphoneCapture.voiceProcessingDuckingEnabled,
					"voiceProcessingDuckingLevel": microphoneCapture.voiceProcessingDuckingLevel ?? NSNull(),
					"voiceProcessingEnabled": microphoneCapture.voiceProcessingEnabled,
					"voiceProcessingOutputEnabled": microphoneCapture.voiceProcessingOutputEnabled,
				],
				"systemAudio": [
					"channels": Int(systemAudioFormat.channelCount),
					"debug": nextSystemAudioCapture.debugInfo,
					"sampleRate": Int(systemAudioFormat.sampleRate.rounded()),
				],
			])
			withExtendedLifetime(signalSources) {
				dispatchMain()
			}
		} catch {
			logger.log("[helper] combined audio startup failed: \(error.localizedDescription)")
			pairedEncoder.stop()
			try? microphoneCapture.stop()
			try? systemAudioCapture?.stop()
			emitter.send(event: [
				"type": "error",
				"message": error.localizedDescription,
			])
			exit(EXIT_FAILURE)
		}
	}
}
