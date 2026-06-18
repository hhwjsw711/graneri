import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

type FrameScheduler = (callback: () => void) => () => void;

export type FrameBudgetedStreamOptions = {
	maxItemsPerFrame?: number;
	maxFrameMs?: number;
	maxBufferedItems?: number;
	scheduleFrame?: FrameScheduler;
	now?: () => number;
};

const DEFAULT_MAX_ITEMS_PER_FRAME = 120;
const DEFAULT_MAX_FRAME_MS = 8;
const DEFAULT_MAX_BUFFERED_ITEMS = 600;

const getDefaultNow = () => performance.now();

const scheduleBrowserFrame: FrameScheduler = (callback) => {
	const requestFrame =
		globalThis.requestAnimationFrame ??
		((frameCallback: FrameRequestCallback) =>
			globalThis.setTimeout(() => frameCallback(getDefaultNow()), 16));
	const cancelFrame =
		globalThis.cancelAnimationFrame ??
		((handle: number) => {
			globalThis.clearTimeout(handle);
		});
	const frameId = requestFrame(() => {
		callback();
	});

	return () => {
		cancelFrame(frameId);
	};
};

export const createFrameBudgetedStream = <T>(
	source: ReadableStream<T>,
	{
		maxItemsPerFrame = DEFAULT_MAX_ITEMS_PER_FRAME,
		maxFrameMs = DEFAULT_MAX_FRAME_MS,
		maxBufferedItems = DEFAULT_MAX_BUFFERED_ITEMS,
		scheduleFrame = scheduleBrowserFrame,
		now = getDefaultNow,
	}: FrameBudgetedStreamOptions = {},
) => {
	let reader: ReadableStreamDefaultReader<T> | null = null;
	let cancelFrame: (() => void) | null = null;
	let isClosed = false;

	return new ReadableStream<T>({
		cancel() {
			isClosed = true;
			cancelFrame?.();
			cancelFrame = null;
			void reader?.cancel();
		},
		start(controller) {
			const activeReader = source.getReader();
			reader = activeReader;
			const queue: T[] = [];
			let queueHead = 0;
			let isReading = false;
			let sourceDone = false;
			let sourceError: unknown;

			const queuedItemCount = () => queue.length - queueHead;

			const compactQueue = () => {
				if (queueHead === 0) {
					return;
				}

				if (queueHead === queue.length) {
					queue.length = 0;
					queueHead = 0;
					return;
				}

				if (queueHead >= maxBufferedItems / 2) {
					queue.splice(0, queueHead);
					queueHead = 0;
				}
			};

			const scheduleDrain = () => {
				if (cancelFrame || isClosed) {
					return;
				}

				cancelFrame = scheduleFrame(drain);
			};

			const closeIfDone = () => {
				if (!sourceDone || queuedItemCount() > 0 || isClosed) {
					return;
				}

				isClosed = true;
				if (sourceError) {
					controller.error(sourceError);
					return;
				}

				controller.close();
			};

			const readSource = async () => {
				if (isReading || isClosed) {
					return;
				}

				isReading = true;
				try {
					if (queuedItemCount() >= maxBufferedItems) {
						return;
					}

					const result = await activeReader.read();
					if (result.done) {
						sourceDone = true;
						closeIfDone();
						return;
					}

					queue.push(result.value);
					scheduleDrain();
				} catch (error) {
					sourceDone = true;
					sourceError = error;
					closeIfDone();
				} finally {
					isReading = false;
				}

				if (!isClosed && queuedItemCount() < maxBufferedItems) {
					void readSource();
				}
			};

			function drain() {
				cancelFrame = null;
				if (isClosed) {
					return;
				}

				const frameStartedAt = now();
				let emittedItems = 0;
				while (
					queuedItemCount() > 0 &&
					emittedItems < maxItemsPerFrame &&
					now() - frameStartedAt <= maxFrameMs
				) {
					controller.enqueue(queue[queueHead] as T);
					queueHead += 1;
					emittedItems += 1;
				}

				compactQueue();

				if (queuedItemCount() > 0) {
					scheduleDrain();
				}

				void readSource();
				closeIfDone();
			}

			void readSource();
		},
	});
};

export class FrameBudgetedChatTransport<UI_MESSAGE extends UIMessage>
	implements ChatTransport<UI_MESSAGE>
{
	readonly #transport: ChatTransport<UI_MESSAGE>;
	readonly #options: FrameBudgetedStreamOptions;

	constructor(
		transport: ChatTransport<UI_MESSAGE>,
		options: FrameBudgetedStreamOptions = {},
	) {
		this.#transport = transport;
		this.#options = options;
	}

	async sendMessages(
		options: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0],
	): Promise<ReadableStream<UIMessageChunk>> {
		const stream = await this.#transport.sendMessages(options);
		return createFrameBudgetedStream(stream, this.#options);
	}

	async reconnectToStream(
		options: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0],
	): Promise<ReadableStream<UIMessageChunk> | null> {
		const stream = await this.#transport.reconnectToStream(options);
		return stream ? createFrameBudgetedStream(stream, this.#options) : null;
	}
}
