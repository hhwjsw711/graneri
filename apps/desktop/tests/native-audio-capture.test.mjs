import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
	createNativeAudioCapture,
	isLikelySystemAudioPermissionError,
	resolveCombinedAudioHelperPath,
} from "../src/native-audio-capture.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("system audio startup timeout is retryable instead of permission-blocking", () => {
	assert.equal(
		isLikelySystemAudioPermissionError(
			new Error("Timed out while starting macOS system audio capture."),
		),
		false,
	);
});

test("system audio permission failures are permission-blocking", () => {
	assert.equal(
		isLikelySystemAudioPermissionError(
			new Error("System audio permission denied by macOS."),
		),
		true,
	);
});

test("combined audio helper resolves through the native runtime contract", async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-combined-audio-"));
	const runtimeDir = join(directory, "runtime");
	const helperPath = join(
		runtimeDir,
		"bin",
		"graneri-combined-audio-helper",
	);
	await mkdir(join(runtimeDir, "bin"), { recursive: true });
	await writeFile(helperPath, "");

	assert.equal(
		resolveCombinedAudioHelperPath({
			runtimeDir,
		}),
		helperPath,
	);
});

test("combined audio helper routes source-tagged chunks to source event buses", async () => {
	const originalPlatform = process.platform;
	Object.defineProperty(process, "platform", {
		value: "darwin",
	});

	try {
		const directory = await mkdtemp(join(tmpdir(), "graneri-combined-audio-"));
		const runtimeDir = join(directory, "runtime");
		const helperPath = join(
			runtimeDir,
			"bin",
			"graneri-combined-audio-helper",
		);
		await mkdir(join(runtimeDir, "bin"), { recursive: true });
		await writeFile(helperPath, "");

		const microphoneEvents = [];
		const systemAudioEvents = [];
		const turnDebugEvents = [];
		const child = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.kill = () => {
			child.emit("exit", 0, "SIGTERM");
			return true;
		};

		const capture = createNativeAudioCapture({
			emitMicrophoneCaptureEvent: (event) => microphoneEvents.push(event),
			emitSystemAudioCaptureEvent: (event) => systemAudioEvents.push(event),
			getSystemAudioPermissionState: () => "prompt",
			logDesktopTurnDebug: (event, payload) =>
				turnDebugEvents.push({ event, payload }),
			markSystemAudioPermissionBlocked: () => {},
			markSystemAudioPermissionGranted: () => {},
			markSystemAudioPermissionPrompt: () => {},
			runtimeDir,
			spawnImpl: () => child,
		});

		const startPromise = capture.startCombinedAudioCapture();
		child.stdout.write(
			`${JSON.stringify({
				audioProcessing: {
					echoCancellation: "pending_render_reference",
					renderReference: "systemAudio",
				},
				microphone: {
					channels: 1,
					route: {
						voiceProcessingMode: "disabled",
						voiceProcessingRouteAllowed: true,
					},
					sampleRate: 48_000,
					voiceProcessingEnabled: false,
				},
				systemAudio: {
					channels: 1,
					sampleRate: 24_000,
				},
				type: "ready",
			})}\n`,
		);
		const ready = await startPromise;

		child.stdout.write(
			`${JSON.stringify({
				pcm16: "bWlj",
				source: "microphone",
				type: "chunk",
			})}\n`,
		);
		child.stdout.write(
			`${JSON.stringify({
				pcm16: "c3lz",
				source: "systemAudio",
				type: "chunk",
			})}\n`,
		);
		child.stdout.write(
			`${JSON.stringify({
				echoCancellation: "webrtc_aec3",
				echoCancellationDelayMs: 5,
				echoCancellationLastPostRms: 0,
				echoCancellationLastPreRms: 0.04,
				echoCancellationLastReason: "residual_leak_gated",
				echoCancellationProcessedCaptureFrames: 10,
				echoCancellationProcessedRenderFrames: 10,
				echoCancellationResidualEchoLikelihood: 0.62,
				echoCancellationResidualEchoLikelihoodRecentMax: 0.71,
				echoCancellationResidualEchoSuppressedChunks: 1,
				microphoneChunks: 10,
				systemAudioChunks: 10,
				type: "processing_diagnostics",
			})}\n`,
		);

		assert.equal(capture.getCaptureSampleRate("microphone"), 48_000);
		assert.equal(capture.getCaptureSampleRate("systemAudio"), 24_000);
		assert.deepEqual(ready.audioProcessing, {
			echoCancellation: "pending_render_reference",
			renderReference: "systemAudio",
		});
		assert.equal(ready.microphone.voiceProcessingMode, "disabled");
		assert.equal(ready.microphone.voiceProcessingRouteAllowed, true);
		assert.deepEqual(microphoneEvents, [{ pcm16: "bWlj", type: "chunk" }]);
		assert.deepEqual(systemAudioEvents, [{ pcm16: "c3lz", type: "chunk" }]);
		assert.deepEqual(
			turnDebugEvents
				.filter((event) => event.event === "combined_audio.source_chunk_started")
				.map((event) => ({
					pcm16Length: event.payload.pcm16Length,
					sampleRate: event.payload.sampleRate,
					source: event.payload.source,
				})),
			[
				{ pcm16Length: 4, sampleRate: 48_000, source: "microphone" },
				{ pcm16Length: 4, sampleRate: 24_000, source: "systemAudio" },
			],
		);
		assert.equal(
			turnDebugEvents.at(-1)?.event,
			"combined_audio.processing_diagnostics",
		);
		assert.equal(
			turnDebugEvents.at(-1)?.payload.audioProcessing.echoCancellation,
			"webrtc_aec3",
		);
		assert.equal(
			turnDebugEvents.at(-1)?.payload.audioProcessing
				.echoCancellationResidualEchoSuppressedChunks,
			1,
		);

		await capture.stopCombinedAudioCapture();
	} finally {
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		});
	}
});

test("combined audio helper self-test reduces delayed render echo when built", async (t) => {
	const helperPath = resolve(
		packageRoot,
		".generated",
		"system-audio",
		"graneri-combined-audio-helper",
	);
	if (!existsSync(helperPath)) {
		t.skip("combined audio helper has not been built");
		return;
	}

	const result = await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(helperPath, ["--self-test"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", rejectPromise);
		child.on("exit", (code) => {
			if (code !== 0) {
				rejectPromise(
					new Error(
						`combined audio helper self-test failed with code ${code}: ${stderr}`,
					),
				);
				return;
			}

			resolvePromise(JSON.parse(stdout.trim()));
		});
	});

	assert.equal(result.ok, true);
	assert.equal(result.type, "self_test");
	assert.ok(result.activeRenderPassthroughErrorRms <= 0.16);
	assert.ok(result.echoReductionRatio >= 0.35);
	assert.ok(result.noRenderPassthroughErrorRms <= 0.000001);
	assert.ok(result.processedErrorRms < result.rawErrorRms);
	assert.ok(result.residualLeakGateSuppressedChunks > 0);
	assert.ok(result.suppressedChunks > 0);
	assert.ok(result.systemOutputErrorRms <= 0.000001);
});
