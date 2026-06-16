import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createDesktopRealtimeTransport } from "../src/desktop-realtime-transport.mjs";

const originalPlatform = process.platform;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;

const createFetch = () => async () =>
	new Response(JSON.stringify({ clientSecret: "test-client-secret" }), {
		headers: {
			"Content-Type": "application/json",
		},
		status: 200,
	});

const createPcm16Base64 = (samples) => {
	const pcm16 = new Int16Array(samples);

	return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength).toString(
		"base64",
	);
};

const createTransport = ({
	handleTransportEvent = async () => {},
	subscribeToCaptureEvents = () => () => {},
	WebSocketImpl,
}) =>
	createDesktopRealtimeTransport({
		canUseHostedDesktopAi: () => true,
		fetchImpl: createFetch(),
		getCaptureSampleRate: () => 48_000,
		getHostedConvexSiteUrl: () => "https://example.convex.site",
		getOpenAIApiKey: () => "",
		handleTransportEvent,
		logDesktopTurnDebug: () => {},
		subscribeToCaptureEvents,
		WebSocketImpl,
	});

class MockWebSocket extends EventEmitter {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static instances = [];

	readyState = MockWebSocket.CONNECTING;
	sent = [];

	constructor() {
		super();
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = MockWebSocket.OPEN;
			this.emit("open");
		});
	}

	send(value) {
		this.sent.push(String(value));
		const message = JSON.parse(String(value));

		if (message.type === "input_audio_buffer.commit") {
			queueMicrotask(() => {
				this.emit(
					"message",
					JSON.stringify({
						type: "input_audio_buffer.committed",
						item_id: "item-1",
					}),
				);
				this.emit(
					"message",
					JSON.stringify({
						type: "conversation.item.input_audio_transcription.completed",
						item_id: "item-1",
						transcript: "",
					}),
				);
			});
		}
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
		queueMicrotask(() => {
			this.emit("close", 1000, Buffer.from(""));
		});
	}

	terminate() {
		this.close();
	}
}

class ClosingBeforeOpenWebSocket extends EventEmitter {
	static CONNECTING = MockWebSocket.CONNECTING;
	static OPEN = MockWebSocket.OPEN;
	static CLOSING = MockWebSocket.CLOSING;
	static CLOSED = MockWebSocket.CLOSED;

	readyState = ClosingBeforeOpenWebSocket.CONNECTING;
	sent = [];

	constructor() {
		super();
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = ClosingBeforeOpenWebSocket.CLOSED;
			this.emit("close", 1006, Buffer.from(""));
		});
	}

	close() {
		this.readyState = ClosingBeforeOpenWebSocket.CLOSED;
	}

	terminate() {
		this.close();
	}
}

const withDarwinPlatform = async (callback) => {
	Object.defineProperty(process, "platform", {
		value: "darwin",
	});
	console.info = () => {};
	console.warn = () => {};

	try {
		await callback();
	} finally {
		console.info = originalConsoleInfo;
		console.warn = originalConsoleWarn;
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		});
		MockWebSocket.instances = [];
	}
};

test("desktop realtime transport skips stop flush without a live item", async () => {
	await withDarwinPlatform(async () => {
		const transport = createTransport({
			WebSocketImpl: MockWebSocket,
		});

		await transport.start({
			lang: "en",
			source: "microphone",
			speaker: "you",
		});
		await transport.stop("you", {
			getLiveItemId: () => null,
		});

		assert.equal(MockWebSocket.instances.length, 1);
		assert.deepEqual(MockWebSocket.instances[0].sent, []);
	});
});

test("desktop realtime transport manually commits live audio", async () => {
	await withDarwinPlatform(async () => {
		let captureListener = null;
		const transport = createTransport({
			subscribeToCaptureEvents: (_source, listener) => {
				captureListener = listener;
				return () => {};
			},
			WebSocketImpl: MockWebSocket,
		});

		await transport.start({
			lang: "en",
			source: "microphone",
			speaker: "you",
		});

		captureListener({
			type: "chunk",
			pcm16: createPcm16Base64([12_000, 12_000, 12_000, 12_000]),
		});
		await sleep(1_600);
		await transport.stop("you", {
			getLiveItemId: () => null,
		});

		assert.equal(MockWebSocket.instances.length, 1);
		assert.deepEqual(
			MockWebSocket.instances[0].sent.map((value) => JSON.parse(value).type),
			["input_audio_buffer.append", "input_audio_buffer.commit"],
		);
	});
});

test("desktop realtime transport drops silent audio chunks", async () => {
	await withDarwinPlatform(async () => {
		let captureListener = null;
		const transport = createTransport({
			subscribeToCaptureEvents: (_source, listener) => {
				captureListener = listener;
				return () => {};
			},
			WebSocketImpl: MockWebSocket,
		});

		await transport.start({
			lang: "en",
			source: "microphone",
			speaker: "you",
		});

		captureListener({
			type: "chunk",
			pcm16: createPcm16Base64([0, 0, 0, 0]),
		});
		await sleep(1_600);
		await transport.stop("you", {
			getLiveItemId: () => null,
		});

		assert.equal(MockWebSocket.instances.length, 1);
		assert.deepEqual(MockWebSocket.instances[0].sent, []);
	});
});

test("desktop realtime transport applies a separate system audio energy threshold", async () => {
	await withDarwinPlatform(async () => {
		let captureListener = null;
		const transport = createTransport({
			subscribeToCaptureEvents: (_source, listener) => {
				captureListener = listener;
				return () => {};
			},
			WebSocketImpl: MockWebSocket,
		});

		await transport.start({
			lang: "en",
			source: "systemAudio",
			speaker: "them",
		});

		captureListener({
			type: "chunk",
			pcm16: createPcm16Base64([200, 200, 200, 200]),
		});
		await sleep(1_600);
		await transport.stop("them", {
			getLiveItemId: () => null,
		});

		assert.equal(MockWebSocket.instances.length, 1);
		assert.deepEqual(
			MockWebSocket.instances[0].sent.map((value) => JSON.parse(value).type),
			["input_audio_buffer.append", "input_audio_buffer.commit"],
		);
	});
});

test("desktop realtime transport commits pending audio on stop", async () => {
	await withDarwinPlatform(async () => {
		let captureListener = null;
		const transport = createTransport({
			subscribeToCaptureEvents: (_source, listener) => {
				captureListener = listener;
				return () => {};
			},
			WebSocketImpl: MockWebSocket,
		});

		await transport.start({
			lang: "en",
			source: "microphone",
			speaker: "you",
		});
		captureListener({
			type: "chunk",
			pcm16: createPcm16Base64([12_000, 12_000, 12_000, 12_000]),
		});
		await transport.stop("you", {
			getLiveItemId: () => "item-1",
		});

		assert.equal(MockWebSocket.instances.length, 1);
		assert.deepEqual(
			MockWebSocket.instances[0].sent.map((value) => JSON.parse(value).type),
			["input_audio_buffer.append", "input_audio_buffer.commit"],
		);
	});
});

test("desktop realtime transport rejects pre-open closes without interruption events", async () => {
	await withDarwinPlatform(async () => {
		const transportEvents = [];
		const transport = createTransport({
			handleTransportEvent: async (event) => {
				transportEvents.push(event);
			},
			WebSocketImpl: ClosingBeforeOpenWebSocket,
		});

		await assert.rejects(
			transport.start({
				lang: "en",
				source: "microphone",
				speaker: "you",
			}),
			/closed before open/,
		);

		assert.deepEqual(transportEvents, []);
		assert.equal(MockWebSocket.instances.length, 1);
	});
});
