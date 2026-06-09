export const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export const createHostedActiveStreamKey = ({ workspaceId, chatId }) =>
	`${workspaceId}:${chatId}`;

export class HostedActiveChatStreamPersister {
	#appendActiveStreamText;
	#buffer = "";
	#chatId;
	#finishActiveStream;
	#flushError = null;
	#flushPromise = null;
	#flushTimer = null;
	#messageId;
	#startActiveStream;
	#workspaceId;

	constructor({
		appendActiveStreamText,
		chatId,
		finishActiveStream,
		messageId,
		startActiveStream,
		workspaceId,
	}) {
		this.#appendActiveStreamText = appendActiveStreamText;
		this.#chatId = chatId;
		this.#finishActiveStream = finishActiveStream;
		this.#messageId = messageId;
		this.#startActiveStream = startActiveStream;
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

export const pipeHostedActiveStreamText = ({ persister, stream }) =>
	stream.pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (chunk.type === "text-delta") {
					persister?.append(chunk.delta);
				}

				controller.enqueue(chunk);
			},
		}),
	);
