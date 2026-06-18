export const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export const createHostedActiveStreamKey = ({ workspaceId, chatId }) =>
	`${workspaceId}:${chatId}`;

export class HostedActiveChatStreamPersister {
	#appendActiveStreamText;
	#acceptingAppends = true;
	#buffer = "";
	#chatId;
	#discarded = false;
	#finishActiveStream;
	#finishActiveStreamToolCall;
	#flushError = null;
	#flushPromise = null;
	#flushTimer = null;
	#messageId;
	#runId;
	#startActiveStream;
	#startActiveStreamToolCall;
	#workspaceId;

	constructor({
		appendActiveStreamText,
		chatId,
		finishActiveStream,
		finishActiveStreamToolCall,
		messageId,
		runId,
		startActiveStream,
		startActiveStreamToolCall,
		workspaceId,
	}) {
		this.#appendActiveStreamText = appendActiveStreamText;
		this.#chatId = chatId;
		this.#finishActiveStream = finishActiveStream;
		this.#finishActiveStreamToolCall = finishActiveStreamToolCall;
		this.#messageId = messageId;
		this.#runId = runId;
		this.#startActiveStream = startActiveStream;
		this.#startActiveStreamToolCall = startActiveStreamToolCall;
		this.#workspaceId = workspaceId;
	}

	get messageId() {
		return this.#messageId;
	}

	get runId() {
		return this.#runId;
	}

	async start() {
		await this.#startActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
		});
	}

	append(delta) {
		if (!this.#acceptingAppends || this.#discarded) {
			return;
		}

		if (!delta) {
			return;
		}

		this.#buffer += delta;

		if (this.#flushTimer) {
			return;
		}

		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null;
			void this.flush().catch((error) => {
				this.#flushError = error;
			});
		}, HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
	}

	async startToolCall({ input, toolCallId, toolName }) {
		await this.#startActiveStreamToolCall({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
			toolCallId,
			toolName,
			inputJson: stringifyToolPayload(input),
		});
	}

	async finishToolCall({ errorText, output, status, toolCallId }) {
		await this.#finishActiveStreamToolCall({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
			toolCallId,
			status,
			outputJson: stringifyToolPayload(output),
			errorText,
		});
	}

	async flush() {
		if (this.#discarded) {
			return;
		}

		if (this.#flushError) {
			const error = this.#flushError;
			this.#flushError = null;
			throw error;
		}

		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}

		while (this.#buffer) {
			const delta = this.#buffer;
			this.#buffer = "";
			const previousFlush = this.#flushPromise ?? Promise.resolve();
			const flushPromise = previousFlush
				.then(() =>
					this.#appendActiveStreamText({
						workspaceId: this.#workspaceId,
						chatId: this.#chatId,
						runId: this.#runId,
						delta,
					}),
				)
				.then(() => undefined);

			this.#flushPromise = flushPromise;
			try {
				await flushPromise;
			} finally {
				if (this.#flushPromise === flushPromise) {
					this.#flushPromise = null;
				}
			}
		}

		await this.#flushPromise;

		if (this.#flushError) {
			const error = this.#flushError;
			this.#flushError = null;
			throw error;
		}
	}

	async finish() {
		await this.flush();
		if (this.#discarded) {
			return;
		}

		await this.#finishActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
		});
		this.#discardPending();
	}

	async closePersistence() {
		this.#acceptingAppends = false;
		await this.flush();
		this.#discardPending();
	}

	discardPending() {
		this.#acceptingAppends = false;
		this.#discardPending();
	}

	#discardPending() {
		this.#discarded = true;
		this.#buffer = "";
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
	}
}

export const createHostedActiveStreamSession = ({
	controllers,
	persister,
	streamKey,
}) => {
	const abortController = new AbortController();
	const subscribers = new Set();
	const replayChunks = [];
	let broadcastStarted = false;
	let broadcastClosed = false;
	let broadcastError = null;

	const removeSubscriber = (controller) => {
		subscribers.delete(controller);
	};

	const publishChunk = (chunk) => {
		if (broadcastClosed) {
			return;
		}

		replayChunks.push(chunk);
		for (const subscriber of subscribers) {
			subscriber.enqueue(chunk);
		}
	};

	const closeBroadcast = () => {
		if (broadcastClosed) {
			return;
		}

		broadcastClosed = true;
		for (const subscriber of subscribers) {
			subscriber.close();
		}
		subscribers.clear();
	};

	const errorBroadcast = (error) => {
		if (broadcastClosed) {
			return;
		}

		broadcastClosed = true;
		broadcastError = error;
		for (const subscriber of subscribers) {
			subscriber.error(error);
		}
		subscribers.clear();
	};

	const session = {
		abort(reason) {
			abortController.abort(reason);
		},
		abortSignal: abortController.signal,
		persister,
		streamKey,
		async start() {
			const existingSession = controllers.get(streamKey);
			if (existingSession && !existingSession.isBroadcastClosed?.()) {
				existingSession.abort("superseded");
				existingSession.cleanup?.();
			}
			controllers.set(streamKey, session);
			await persister.start();
		},
		isBroadcastClosed() {
			return broadcastClosed;
		},
		append(delta) {
			persister.append(delta);
		},
		async startToolCall(args) {
			await persister.startToolCall?.(args);
		},
		async finishToolCall(args) {
			await persister.finishToolCall?.(args);
		},
		discardPending() {
			persister.discardPending?.();
		},
		async closePersistence() {
			await persister.closePersistence();
		},
		async finish() {
			try {
				await persister.finish();
			} finally {
				closeBroadcast();
				if (controllers.get(streamKey) === session) {
					controllers.delete(streamKey);
				}
			}
		},
		cleanup() {
			persister.discardPending?.();
			closeBroadcast();
			if (controllers.get(streamKey) === session) {
				controllers.delete(streamKey);
			}
		},
		subscribe() {
			let streamController = null;
			return new ReadableStream({
				start(controller) {
					streamController = controller;
					if (broadcastError) {
						controller.error(broadcastError);
						return;
					}

					for (const chunk of replayChunks) {
						controller.enqueue(chunk);
					}

					if (broadcastClosed) {
						controller.close();
						return;
					}

					subscribers.add(controller);
				},
				cancel(_reason) {
					if (streamController) {
						removeSubscriber(streamController);
					}
				},
			});
		},
		startBroadcast(stream) {
			if (broadcastStarted) {
				return session.subscribe();
			}

			broadcastStarted = true;
			const reader = stream.getReader();
			void (async () => {
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) {
							closeBroadcast();
							return;
						}
						publishChunk(value);
					}
				} catch (error) {
					errorBroadcast(error);
				}
			})();

			return session.subscribe();
		},
	};

	return session;
};

export const createHostedActiveChatStreamSession = ({
	callbacks,
	chatId,
	controllers,
	messageId = `stream-${crypto.randomUUID()}`,
	runId,
	workspaceId,
}) =>
	createHostedActiveStreamSession({
		controllers,
		streamKey: createHostedActiveStreamKey({
			workspaceId,
			chatId,
		}),
		persister: new HostedActiveChatStreamPersister({
			workspaceId,
			chatId,
			messageId,
			runId,
			...callbacks,
		}),
	});

const stringifyToolPayload = (payload) => {
	if (payload === undefined) {
		return undefined;
	}

	try {
		return JSON.stringify(payload);
	} catch (error) {
		throw new TypeError("Failed to serialize active stream tool payload.", {
			cause: error,
		});
	}
};

const persistHostedActiveStreamToolChunk = async ({ chunk, persister }) => {
	if (!persister) {
		return;
	}

	if (chunk.type === "tool-input-available") {
		await persister.startToolCall?.({
			toolCallId: chunk.toolCallId,
			toolName: chunk.toolName,
			input: chunk.input,
		});
		return;
	}

	if (chunk.type === "tool-input-error") {
		await persister.startToolCall?.({
			toolCallId: chunk.toolCallId,
			toolName: chunk.toolName,
			input: chunk.input,
		});
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "failed",
			errorText: chunk.errorText,
		});
		return;
	}

	if (chunk.type === "tool-output-available") {
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "completed",
			output: chunk.output,
		});
		return;
	}

	if (chunk.type === "tool-output-error") {
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "failed",
			errorText: chunk.errorText,
		});
		return;
	}

	if (chunk.type === "tool-output-denied") {
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "denied",
			errorText: chunk.errorText,
		});
	}
};

export const pipeHostedActiveStreamEvents = ({ onFlush, persister, stream }) =>
	stream.pipeThrough(
		new TransformStream({
			async transform(chunk, controller) {
				if (chunk.type === "text-delta") {
					persister?.append(chunk.delta);
				}

				await persistHostedActiveStreamToolChunk({ chunk, persister });
				controller.enqueue(chunk);
			},
			async flush() {
				await persister?.flush?.();
				await onFlush?.();
			},
		}),
	);

export const pipeHostedActiveStreamText = pipeHostedActiveStreamEvents;
