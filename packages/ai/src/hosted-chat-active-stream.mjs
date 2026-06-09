export const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export const createHostedActiveStreamKey = ({ workspaceId, chatId }) =>
	`${workspaceId}:${chatId}`;

export class HostedActiveChatStreamPersister {
	#appendActiveStreamText;
	#buffer = "";
	#chatId;
	#finishActiveStream;
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
			void this.flush();
		}, HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
	}

	async flush() {
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
				.then(() => undefined)
				.catch((error) => {
					console.error("Failed to persist active chat stream", error);
				});

			this.#flushPromise = flushPromise;
			await flushPromise;

			if (this.#flushPromise === flushPromise) {
				this.#flushPromise = null;
			}
		}

		await this.#flushPromise;
	}

	async finish(status) {
		await this.flush();
		await this.#finishActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			messageId: this.#messageId,
			status,
		}).catch((error) => {
			console.error("Failed to finish active chat stream", error);
		});
	}
}

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
