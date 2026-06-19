import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleChatRequest } from "../server/chat-handler";

const previousOpenAiApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
	if (previousOpenAiApiKey === undefined) {
		delete process.env.OPENAI_API_KEY;
		return;
	}

	process.env.OPENAI_API_KEY = previousOpenAiApiKey;
});

const postChatRequest = async ({
	body,
	isSteerRoute,
	path = "/api/chat",
}: {
	body: Record<string, unknown>;
	isSteerRoute?: boolean;
	path?: string;
}) => {
	process.env.OPENAI_API_KEY = "test-key";

	const server = createServer((request, response) => {
		void handleChatRequest(request, response, { isSteerRoute }).catch(
			(error: unknown) => {
				response.statusCode = 500;
				response.setHeader("Content-Type", "application/json");
				response.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			},
		);
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected local HTTP server address.");
		}

		const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		return {
			status: response.status,
			body: (await response.json()) as { error?: string },
		};
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
		});
	}
};

describe("chat steer HTTP contract", () => {
	it("rejects steer route requests without the expected active turn id", async () => {
		await expect(
			postChatRequest({
				isSteerRoute: true,
				path: "/api/chat/steer",
				body: { steerQueuedMessageId: "queued-1" },
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error:
					"steerQueuedMessageId and continueRunId are required for chat steering.",
				errorCode: "steer_context_missing",
			},
		});
	});

	it("rejects queued steering on the ordinary chat route", async () => {
		await expect(
			postChatRequest({
				body: {
					continueRunId: "run-1",
					steerQueuedMessageId: "queued-1",
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error: "Queued message steering must use /api/chat/steer.",
				errorCode: "steer_route_required",
			},
		});
	});

	it("rejects requests that mix queued replay and steering", async () => {
		await expect(
			postChatRequest({
				isSteerRoute: true,
				path: "/api/chat/steer",
				body: {
					continueRunId: "run-1",
					replayQueuedMessageId: "queued-replay-1",
					steerQueuedMessageId: "queued-steer-1",
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error:
					"Queued message replay and steering cannot be requested together.",
				errorCode: "queued_message_mode_conflict",
			},
		});
	});

	it("rejects queued replay against an active run", async () => {
		await expect(
			postChatRequest({
				body: {
					continueRunId: "run-1",
					replayQueuedMessageId: "queued-replay-1",
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error: "Queued message replay cannot continue an active assistant run.",
				errorCode: "queued_replay_active_run_conflict",
			},
		});
	});

	it("rejects queued replay requests that also send a client message", async () => {
		await expect(
			postChatRequest({
				body: {
					message: {
						id: "client-message-1",
						role: "user",
						parts: [{ type: "text", text: "ignore me" }],
					},
					replayQueuedMessageId: "queued-replay-1",
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error:
					"Queued message replay and steering must not include a client message body.",
				errorCode: "queued_message_body_conflict",
			},
		});
	});

	it("rejects queued steering requests that also send a client message", async () => {
		await expect(
			postChatRequest({
				isSteerRoute: true,
				path: "/api/chat/steer",
				body: {
					continueRunId: "run-1",
					message: {
						id: "client-message-1",
						role: "user",
						parts: [{ type: "text", text: "ignore me" }],
					},
					steerQueuedMessageId: "queued-steer-1",
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error:
					"Queued message replay and steering must not include a client message body.",
				errorCode: "queued_message_body_conflict",
			},
		});
	});

	it("rejects malformed active turn ids before state lookup", async () => {
		await expect(
			postChatRequest({
				isSteerRoute: true,
				path: "/api/chat/steer",
				body: {
					continueRunId: "",
					steerQueuedMessageId: "queued-1",
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error: "continueRunId must be a non-empty string.",
				errorCode: "continue_run_id_invalid",
			},
		});
	});

	it("rejects malformed queued steer ids before state lookup", async () => {
		await expect(
			postChatRequest({
				isSteerRoute: true,
				path: "/api/chat/steer",
				body: {
					continueRunId: "run-1",
					steerQueuedMessageId: {},
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error: "steerQueuedMessageId must be a non-empty string.",
				errorCode: "steer_queued_message_id_invalid",
			},
		});
	});
});
