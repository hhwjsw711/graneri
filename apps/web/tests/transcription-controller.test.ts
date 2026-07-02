import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	RealtimeTranscriptionTransport,
	RealtimeTranscriptionTransportEvent,
} from "../src/lib/capture/realtime-transcription-transport";
import {
	TranscriptionController,
	type TranscriptionControllerState,
} from "../src/lib/transcription-controller";
import type { TranscriptionPolicy } from "../src/lib/transcription-policy";

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error?: unknown) => void;
};

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error?: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});

	return {
		promise,
		reject,
		resolve,
	} satisfies Deferred<T>;
};

const flushPromises = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

const waitForAssertion = async (assertion: () => void, attempts = 10) => {
	const attemptAssertion = async (attempt: number): Promise<void> => {
		try {
			assertion();
			return undefined;
		} catch (error) {
			if (attempt >= attempts - 1) {
				throw error;
			}

			await flushPromises();
			return attemptAssertion(attempt + 1);
		}
	};

	await attemptAssertion(0);
};

const createMockTrack = () => ({
	addEventListener: vi.fn(),
	stop: vi.fn(),
});

const createMockStream = () => {
	const track = createMockTrack();

	return {
		stream: {
			getAudioTracks: () => [track],
			getTracks: () => [track],
		} as unknown as MediaStream,
		track,
	};
};

const createPolicy = (
	overrides: Partial<TranscriptionPolicy> = {},
): TranscriptionPolicy => ({
	platform: "browser",
	systemAudioCapability: {
		isSupported: true,
		shouldAutoBootstrap: false,
		sourceMode: "display-media",
	},
	...overrides,
});

const createController = ({
	connectTransport = vi.fn(),
	createBrowserSystemAudioStream = vi.fn(async () => null),
	createDesktopSystemAudioStream = vi.fn(),
	createMicrophoneInputStream = vi.fn(),
	resolvePolicy = vi.fn(async () => createPolicy()),
}: {
	connectTransport?: ReturnType<typeof vi.fn>;
	createBrowserSystemAudioStream?: ReturnType<typeof vi.fn>;
	createDesktopSystemAudioStream?: ReturnType<typeof vi.fn>;
	createMicrophoneInputStream?: ReturnType<typeof vi.fn>;
	resolvePolicy?: ReturnType<typeof vi.fn>;
} = {}) =>
	new TranscriptionController({
		clearScheduledTimeout: clearTimeout,
		connectTransport: connectTransport as never,
		createBrowserSystemAudioStream: createBrowserSystemAudioStream as never,
		createDesktopSystemAudioStream: createDesktopSystemAudioStream as never,
		createMicrophoneInputStream: createMicrophoneInputStream as never,
		ensureMicrophonePermission: vi.fn(async () => {}) as never,
		getRealtimeAvailability: vi.fn(() => true),
		resolvePolicy: resolvePolicy as never,
		scheduleTimeout: setTimeout,
	});

describe("TranscriptionController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("quick note auto-start starts the microphone without auto-opening browser system audio", async () => {
		const { stream } = createMockStream();
		const transport = {
			close: vi.fn(async () => {}),
		} satisfies RealtimeTranscriptionTransport;
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const createBrowserSystemAudioStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(async () => transport);
		const controller = createController({
			connectTransport,
			createBrowserSystemAudioStream,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () =>
				createPolicy({
					platform: "browser",
					systemAudioCapability: {
						isSupported: true,
						shouldAutoBootstrap: false,
						sourceMode: "display-media",
					},
				}),
			),
		});

		controller.configure({
			autoStartKey: "note-1:capture",
			scopeKey: "note:1",
		});

		await waitForAssertion(() => {
			expect(controller.getSnapshot().isListening).toBe(true);
		});
		expect(createMicrophoneInputStream).toHaveBeenCalledTimes(1);
		expect(createBrowserSystemAudioStream).not.toHaveBeenCalled();
		expect(connectTransport).toHaveBeenCalledTimes(1);
		expect(connectTransport).toHaveBeenCalledWith(
			expect.objectContaining({
				source: "microphone",
			}),
		);
	});

	it("serializes duplicate starts so the first startup still reaches listening", async () => {
		const { stream } = createMockStream();
		const transportDeferred = createDeferred<RealtimeTranscriptionTransport>();
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(async () => await transportDeferred.promise);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () => createPolicy()),
		});

		const firstStartPromise = controller.start();
		const secondStartPromise = controller.start();
		await waitForAssertion(() => {
			expect(connectTransport).toHaveBeenCalledTimes(1);
		});

		transportDeferred.resolve({
			close: vi.fn(async () => {}),
		});

		await expect(firstStartPromise).resolves.toBe(true);
		await expect(secondStartPromise).resolves.toBe(true);
		expect(controller.getSnapshot().phase).toBe("listening");
		expect(controller.getSnapshot().isListening).toBe(true);
	});

	it("keeps microphone transcription active when desktop system audio bootstrap fails", async () => {
		const { stream } = createMockStream();
		const transport = {
			close: vi.fn(async () => {}),
		} satisfies RealtimeTranscriptionTransport;
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const createDesktopSystemAudioStream = vi.fn(async () => {
			throw new Error("System audio unavailable");
		});
		const connectTransport = vi.fn(async () => transport);
		const controller = createController({
			connectTransport,
			createDesktopSystemAudioStream,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () =>
				createPolicy({
					platform: "desktop",
					systemAudioCapability: {
						isSupported: true,
						shouldAutoBootstrap: true,
						sourceMode: "desktop-native",
					},
				}),
			),
		});

		await expect(controller.start()).resolves.toBe(true);
		await waitForAssertion(() => {
			expect(createDesktopSystemAudioStream).toHaveBeenCalledTimes(1);
		});

		expect(controller.getSnapshot().phase).toBe("listening");
		expect(controller.getSnapshot().systemAudioStatus.state).toBe("ready");
		expect(connectTransport).toHaveBeenCalledTimes(1);
	});

	it("keeps microphone transcription active when connected system audio later interrupts", async () => {
		const microphone = createMockStream();
		const systemAudio = createMockStream();
		const transports = [
			{
				close: vi.fn(async () => {}),
			},
			{
				close: vi.fn(async () => {}),
			},
		] satisfies RealtimeTranscriptionTransport[];
		const interruptions: Array<(message: string) => void> = [];
		const createMicrophoneInputStream = vi.fn(async () => microphone.stream);
		const createBrowserSystemAudioStream = vi.fn(
			async () => systemAudio.stream,
		);
		const connectTransport = vi.fn(
			async (args: { onInterrupted: (message: string) => void }) => {
				interruptions.push(args.onInterrupted);
				return transports.at(interruptions.length - 1) ?? transports[0];
			},
		);
		const controller = createController({
			connectTransport,
			createBrowserSystemAudioStream,
			createMicrophoneInputStream,
		});

		await expect(controller.start()).resolves.toBe(true);
		await expect(controller.requestSystemAudio()).resolves.toBe(true);

		expect(controller.getSnapshot().systemAudioStatus.state).toBe("connected");
		expect(connectTransport).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				source: "systemAudio",
			}),
		);

		await interruptions[1]?.("System audio stream interrupted.");
		await flushPromises();

		expect(controller.getSnapshot().isListening).toBe(true);
		expect(controller.getSnapshot().phase).toBe("listening");
		expect(controller.getSnapshot().systemAudioStatus.state).toBe("ready");
		expect(transports[0].close).not.toHaveBeenCalled();
		expect(transports[1].close).toHaveBeenCalledTimes(1);
	});

	it("rotates realtime sessions before the session limit without consuming recovery budget", async () => {
		const firstMicrophone = createMockStream();
		const secondMicrophone = createMockStream();
		const transports = [
			{
				close: vi.fn(async () => {}),
			},
			{
				close: vi.fn(async () => {}),
			},
		] satisfies RealtimeTranscriptionTransport[];
		let transportIndex = 0;
		let streamIndex = 0;
		const createMicrophoneInputStream = vi.fn(
			async () =>
				[firstMicrophone.stream, secondMicrophone.stream][streamIndex++] ??
				secondMicrophone.stream,
		);
		const connectTransport = vi.fn(async () => {
			const transport =
				transports[transportIndex] ?? transports[transports.length - 1];
			transportIndex += 1;
			return transport;
		});
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});

		await expect(controller.start()).resolves.toBe(true);
		expect(controller.getSnapshot().phase).toBe("listening");

		vi.advanceTimersByTime(29 * 60 * 1000);
		await waitForAssertion(() => {
			expect(controller.getSnapshot().phase).toBe("reconnecting");
		});
		vi.runOnlyPendingTimers();
		await flushPromises();

		await waitForAssertion(() => {
			expect(connectTransport).toHaveBeenCalledTimes(2);
			expect(controller.getSnapshot().phase).toBe("listening");
			expect(controller.getSnapshot().recoveryStatus.state).toBe("idle");
		});
		expect(transports[0].close).toHaveBeenCalledTimes(1);
		expect(transports[1].close).not.toHaveBeenCalled();
	});

	it("restores manually attached system audio after a planned rollover reconnect", async () => {
		const firstMicrophone = createMockStream();
		const secondMicrophone = createMockStream();
		const firstSystemAudio = createMockStream();
		const secondSystemAudio = createMockStream();
		const transports = [
			{
				close: vi.fn(async () => {}),
			},
			{
				close: vi.fn(async () => {}),
			},
			{
				close: vi.fn(async () => {}),
			},
			{
				close: vi.fn(async () => {}),
			},
		] satisfies RealtimeTranscriptionTransport[];
		let microphoneIndex = 0;
		let systemAudioIndex = 0;
		let transportIndex = 0;
		const createMicrophoneInputStream = vi.fn(
			async () =>
				[firstMicrophone.stream, secondMicrophone.stream][microphoneIndex++] ??
				secondMicrophone.stream,
		);
		const createBrowserSystemAudioStream = vi.fn(
			async () =>
				[firstSystemAudio.stream, secondSystemAudio.stream][
					systemAudioIndex++
				] ?? secondSystemAudio.stream,
		);
		const connectTransport = vi.fn(async () => {
			const transport =
				transports[transportIndex] ?? transports[transports.length - 1];
			transportIndex += 1;
			return transport;
		});
		const controller = createController({
			connectTransport,
			createBrowserSystemAudioStream,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () =>
				createPolicy({
					platform: "browser",
					systemAudioCapability: {
						isSupported: true,
						shouldAutoBootstrap: false,
						sourceMode: "display-media",
					},
				}),
			),
		});

		await expect(controller.start()).resolves.toBe(true);
		await expect(controller.requestSystemAudio()).resolves.toBe(true);

		expect(controller.getSnapshot().systemAudioStatus.state).toBe("connected");
		expect(connectTransport).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(29 * 60 * 1000);
		await waitForAssertion(() => {
			expect(controller.getSnapshot().phase).toBe("reconnecting");
		});
		vi.runOnlyPendingTimers();
		await flushPromises();

		await waitForAssertion(() => {
			expect(connectTransport).toHaveBeenCalledTimes(4);
			expect(createBrowserSystemAudioStream).toHaveBeenCalledTimes(2);
			expect(controller.getSnapshot().phase).toBe("listening");
			expect(controller.getSnapshot().systemAudioStatus.state).toBe(
				"connected",
			);
		});
		expect(transports[0].close).toHaveBeenCalledTimes(1);
		expect(transports[1].close).toHaveBeenCalledTimes(1);
		expect(transports[2].close).not.toHaveBeenCalled();
		expect(transports[3].close).not.toHaveBeenCalled();
	});

	it("stopping a session clears live transcript and closes the transport", async () => {
		const { stream } = createMockStream();
		const transport = {
			close: vi.fn(async () => {}),
		} satisfies RealtimeTranscriptionTransport;
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return transport;
			},
		);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});

		await controller.start();
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			textDelta: "hello there",
			type: "partial",
		});

		expect(controller.getSnapshot().liveTranscript.you.text).toBe(
			"hello there",
		);

		await controller.stop();

		expect(controller.getSnapshot().liveTranscript.you.text).toBe("");
		expect(transport.close).toHaveBeenCalledTimes(1);
	});

	it("stopping does not salvage placeholder system-audio partial text", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const createBrowserSystemAudioStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createBrowserSystemAudioStream,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () =>
				createPolicy({
					platform: "browser",
					systemAudioCapability: {
						isSupported: true,
						shouldAutoBootstrap: false,
						sourceMode: "display-media",
					},
				}),
			),
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		await controller.requestSystemAudio();

		transportEvents[1]?.({
			itemId: "turn-1",
			speaker: "them",
			textDelta: "music",
			type: "partial",
		});

		expect(controller.getSnapshot().liveTranscript.them.text).toBe("music");

		await controller.stop();

		expect(utterances).toHaveLength(0);
		expect(controller.getSnapshot().liveTranscript.them.text).toBe("");
	});

	it("stops stale startup work when the note scope changes mid-start", async () => {
		const transportDeferred = createDeferred<RealtimeTranscriptionTransport>();
		const { track, stream } = createMockStream();
		const transport = {
			close: vi.fn(async () => {}),
		} satisfies RealtimeTranscriptionTransport;
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(async () => await transportDeferred.promise);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});

		controller.configure({
			scopeKey: "note:1",
		});

		const startPromise = controller.start();
		await waitForAssertion(() => {
			expect(connectTransport).toHaveBeenCalledTimes(1);
		});
		controller.configure({
			scopeKey: "note:2",
		});

		transportDeferred.resolve(transport);
		await expect(startPromise).resolves.toBe(false);

		expect(track.stop).toHaveBeenCalledTimes(1);
		expect(transport.close).toHaveBeenCalledTimes(1);
		expect(connectTransport).toHaveBeenCalledTimes(1);
		expect(controller.getSnapshot().scopeKey).toBe("note:2");
		expect(controller.getSnapshot().isListening).toBe(false);
	});

	it("publishes utterance events in order once a turn is committed", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			textDelta: "hello",
			type: "partial",
		});
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			text: "hello world",
			type: "final",
		});
		transportEvents[0]?.({
			itemId: "turn-1",
			previousItemId: null,
			speaker: "you",
			type: "committed",
		});

		expect(utterances).toHaveLength(1);
		expect(utterances[0]?.text).toBe("hello world");
		expect(controller.getSnapshot().liveTranscript.you.text).toBe("");
	});

	it("uses transport commit timing when publishing utterances", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		transportEvents[0]?.({
			endedAt: 2_500,
			itemId: "turn-1",
			previousItemId: null,
			speaker: "you",
			startedAt: 1_000,
			type: "committed",
		});
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			text: "timed turn",
			type: "final",
		});

		expect(utterances).toHaveLength(1);
		expect(utterances[0]).toEqual(
			expect.objectContaining({
				endedAt: 2_500,
				startedAt: 1_000,
				text: "timed turn",
			}),
		);
	});

	it("does not publish final text before the input buffer commit arrives", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			text: "wait for commit",
			type: "final",
		});

		expect(utterances).toHaveLength(0);

		transportEvents[0]?.({
			endedAt: 2_000,
			itemId: "turn-1",
			previousItemId: null,
			speaker: "you",
			startedAt: 1_000,
			type: "committed",
		});

		expect(utterances).toHaveLength(1);
		expect(utterances[0]).toEqual(
			expect.objectContaining({
				endedAt: 2_000,
				startedAt: 1_000,
				text: "wait for commit",
			}),
		);
	});

	it("keeps a committed turn even when the transcription logprobs are very low", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			text: "hello hello hello hello hello hello",
			logprobs: Array.from({ length: 6 }, () => ({
				logprob: -3,
				token: "hello",
			})),
			type: "final",
		});
		transportEvents[0]?.({
			itemId: "turn-1",
			previousItemId: null,
			speaker: "you",
			type: "committed",
		});

		expect(utterances).toHaveLength(1);
		expect(utterances[0]?.text).toBe("hello hello hello hello hello hello");
		expect(controller.getSnapshot().liveTranscript.you.text).toBe("");
	});

	it("keeps a low-confidence committed system-audio turn in the draft lane", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const createBrowserSystemAudioStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createBrowserSystemAudioStream,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () =>
				createPolicy({
					platform: "browser",
					systemAudioCapability: {
						isSupported: true,
						shouldAutoBootstrap: false,
						sourceMode: "display-media",
					},
				}),
			),
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		await controller.requestSystemAudio();

		transportEvents[1]?.({
			itemId: "turn-1",
			speaker: "them",
			text: "hello hello hello",
			logprobs: Array.from({ length: 3 }, () => ({
				logprob: -3,
				token: "hello",
			})),
			type: "final",
		});
		transportEvents[1]?.({
			itemId: "turn-1",
			previousItemId: null,
			speaker: "them",
			type: "committed",
		});

		expect(utterances).toHaveLength(1);
		expect(utterances[0]?.text).toBe("hello hello hello");
		expect(controller.getSnapshot().liveTranscript.them.text).toBe("");
	});

	it("salvages interrupted non-placeholder text and still emits later committed turns", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createMicrophoneInputStream,
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		transportEvents[0]?.({
			itemId: "turn-1",
			speaker: "you",
			textDelta: "bad live turn",
			type: "partial",
		});

		expect(controller.getSnapshot().liveTranscript.you.text).toBe(
			"bad live turn",
		);

		transportEvents[0]?.({
			itemId: "turn-1",
			message: "ASR failed for this item.",
			speaker: "you",
			type: "turn_failed",
		});
		transportEvents[0]?.({
			itemId: "turn-2",
			previousItemId: "turn-1",
			speaker: "you",
			type: "committed",
		});
		transportEvents[0]?.({
			itemId: "turn-2",
			speaker: "you",
			text: "working turn",
			type: "final",
		});

		expect(controller.getSnapshot().phase).toBe("listening");
		expect(controller.getSnapshot().isListening).toBe(true);
		expect(controller.getSnapshot().liveTranscript.you.text).toBe("");
		expect(utterances).toHaveLength(2);
		expect(utterances[0]?.text).toBe("bad live turn");
		expect(utterances[1]?.text).toBe("working turn");
	});

	it("salvages a substantial interrupted system-audio turn from partial text", async () => {
		const { stream } = createMockStream();
		const transportEvents: Array<
			(event: RealtimeTranscriptionTransportEvent) => void
		> = [];
		const createMicrophoneInputStream = vi.fn(async () => stream);
		const createBrowserSystemAudioStream = vi.fn(async () => stream);
		const connectTransport = vi.fn(
			async (args: {
				speaker: "them" | "you";
				onEvent: (event: RealtimeTranscriptionTransportEvent) => void;
			}) => {
				transportEvents.push(args.onEvent);
				return {
					close: vi.fn(async () => {}),
				} satisfies RealtimeTranscriptionTransport;
			},
		);
		const controller = createController({
			connectTransport,
			createBrowserSystemAudioStream,
			createMicrophoneInputStream,
			resolvePolicy: vi.fn(async () =>
				createPolicy({
					platform: "browser",
					systemAudioCapability: {
						isSupported: true,
						shouldAutoBootstrap: false,
						sourceMode: "display-media",
					},
				}),
			),
		});
		const utterances: TranscriptionControllerState["utterances"] = [];
		controller.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				utterances.push(event.utterance);
			}
		});

		await controller.start();
		await controller.requestSystemAudio();

		transportEvents[1]?.({
			itemId: "turn-1",
			speaker: "them",
			textDelta:
				"If your ideation process is to find an idea that is both good and no one's ever thought of it before",
			type: "partial",
		});
		transportEvents[1]?.({
			itemId: "turn-1",
			message: "ASR failed for this item.",
			speaker: "them",
			type: "turn_failed",
		});
		transportEvents[1]?.({
			itemId: "turn-1",
			previousItemId: null,
			speaker: "them",
			type: "committed",
		});

		expect(utterances).toHaveLength(1);
		expect(utterances[0]?.speaker).toBe("them");
		expect(utterances[0]?.text).toContain("If your ideation process");
		expect(controller.getSnapshot().liveTranscript.them.text).toBe("");
	});
});
