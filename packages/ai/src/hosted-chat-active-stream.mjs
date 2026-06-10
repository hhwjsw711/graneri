export const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export const createHostedActiveStreamKey = ({ workspaceId, chatId }) =>
	`${workspaceId}:${chatId}`;

export class HostedActiveChatStreamPersister {
	#appendActiveStreamText;
	#buffer = "";
	#chatId;
	#finishActiveStream;
	#finishActiveStreamToolCall;
	#flushError = null;
	#flushPromise = null;
	#flushTimer = null;
	#messageId;
	#startActiveStream;
	#startActiveStreamToolCall;
	#workspaceId;

	constructor({
		appendActiveStreamText,
		chatId,
		finishActiveStream,
		finishActiveStreamToolCall,
		messageId,
		startActiveStream,
		startActiveStreamToolCall,
		workspaceId,
	}) {
		this.#appendActiveStreamText = appendActiveStreamText;
		this.#chatId = chatId;
		this.#finishActiveStream = finishActiveStream;
		this.#finishActiveStreamToolCall = finishActiveStreamToolCall;
		this.#messageId = messageId;
		this.#startActiveStream = startActiveStream;
		this.#startActiveStreamToolCall = startActiveStreamToolCall;
		this.#workspaceId = workspaceId;
	}

	get messageId() {
		return this.#messageId;
	}

	async start() {
		await this.#startActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			messageId: this.#messageId,
		});
	}

	append(delta) {
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
			messageId: this.#messageId,
			toolCallId,
			toolName,
			inputJson: stringifyToolPayload(input),
		});
	}

	async finishToolCall({ errorText, output, status, toolCallId }) {
		await this.#finishActiveStreamToolCall({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			messageId: this.#messageId,
			toolCallId,
			status,
			outputJson: stringifyToolPayload(output),
			errorText,
		});
	}

	async flush() {
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
						messageId: this.#messageId,
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

	async finish(status) {
		await this.flush();
		await this.#finishActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			messageId: this.#messageId,
			status,
		});
	}
}

export const createHostedActiveStreamSession = ({
	controllers,
	persister,
	streamKey,
}) => {
	const abortController = new AbortController();

	return {
		abortSignal: abortController.signal,
		persister,
		streamKey,
		async start() {
			controllers.get(streamKey)?.abort("superseded");
			controllers.set(streamKey, abortController);
			await persister.start();
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
		async finish(status) {
			try {
				await persister.finish(status);
			} finally {
				if (controllers.get(streamKey) === abortController) {
					controllers.delete(streamKey);
				}
			}
		},
		cleanup() {
			if (controllers.get(streamKey) === abortController) {
				controllers.delete(streamKey);
			}
		},
	};
};

export const createHostedActiveChatStreamSession = ({
	callbacks,
	chatId,
	controllers,
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
			messageId: `stream-${crypto.randomUUID()}`,
			...callbacks,
		}),
	});

export const stopHostedActiveChatStream = async ({
	chatId,
	controllers,
	stopActiveStream,
	workspaceId,
}) => {
	const streamKey = createHostedActiveStreamKey({
		workspaceId,
		chatId,
	});

	await stopActiveStream({
		workspaceId,
		chatId,
	});

	controllers.get(streamKey)?.abort("stopped");
	controllers.delete(streamKey);
};

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

export const pipeHostedActiveStreamEvents = ({ persister, stream }) =>
	stream.pipeThrough(
		new TransformStream({
			async transform(chunk, controller) {
				if (chunk.type === "text-delta") {
					persister?.append(chunk.delta);
				}

				await persistHostedActiveStreamToolChunk({ chunk, persister });
				controller.enqueue(chunk);
			},
		}),
	);

export const pipeHostedActiveStreamText = pipeHostedActiveStreamEvents;
