import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerQueuedMessageIdsHeader,
	hostedChatSteerTurnIdHeader,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import {
	handleChatReconnectRequest,
	handleChatRequest,
	handleChatStopRequest,
} from "../server/chat-handler";

const convexMock = vi.hoisted(() => ({
	mutation: vi.fn(),
	query: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		mutation = convexMock.mutation;
		query = convexMock.query;
	},
}));

const previousConvexUrl = process.env.CONVEX_URL;
const previousOpenAiApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
	process.env.CONVEX_URL = "https://example.convex.cloud";
	process.env.OPENAI_API_KEY = "test-key";
	convexMock.query.mockReset();
	convexMock.mutation.mockReset();
});

afterEach(() => {
	if (previousConvexUrl === undefined) {
		delete process.env.CONVEX_URL;
	} else {
		process.env.CONVEX_URL = previousConvexUrl;
	}

	if (previousOpenAiApiKey === undefined) {
		delete process.env.OPENAI_API_KEY;
	} else {
		process.env.OPENAI_API_KEY = previousOpenAiApiKey;
	}
});

const postChatRequest = async (
	body: Record<string, unknown>,
	options: { includeHeaders?: boolean; isSteerRoute?: boolean } = {},
) => {
	const server = createServer((request, response) => {
		void handleChatRequest(request, response, {
			isSteerRoute: options.isSteerRoute,
		}).catch((error: unknown) => {
			response.statusCode = 500;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected local HTTP server address.");
		}

		const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		const result = {
			status: response.status,
			body: (await response.json()) as { error?: string },
		};
		if (!options.includeHeaders) {
			return result;
		}

		return {
			...result,
			headers: response.headers,
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

const getChatReconnectRequest = async ({
	chatId = "chat_1",
	token = "token_1",
	workspaceId = "workspace_1",
}: {
	chatId?: string;
	token?: string;
	workspaceId?: string;
} = {}) => {
	const server = createServer((request, response) => {
		void handleChatReconnectRequest(request, response).catch(
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

		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/chat/${encodeURIComponent(chatId)}/stream?workspaceId=${encodeURIComponent(workspaceId)}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		);

		return {
			status: response.status,
			body: await response.text(),
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

const postChatStopRequest = async (body: Record<string, unknown>) => {
	const server = createServer((request, response) => {
		void handleChatStopRequest(request, response).catch((error: unknown) => {
			response.statusCode = 500;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected local HTTP server address.");
		}

		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/chat/stop`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);

		return {
			status: response.status,
			body: (await response.json()) as { error?: string; ok?: boolean },
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

describe("chat handler persistence failures", () => {
	it("returns structured queue errors when attachable run lookup fails closed", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			},
		});

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 409,
			body: {
				error: "Chat has multiple active assistant runs.",
				errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			},
		});
	});

	it("returns structured queue errors when replay lookup fails validation", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "QUEUED_MESSAGE_INVALID_PARTS",
				message: "Queued message parts are invalid.",
			},
		});

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error: "Queued message parts are invalid.",
				errorCode: "QUEUED_MESSAGE_INVALID_PARTS",
			},
		});
	});

	it("returns structured lifecycle errors when stop lookup fails closed", async () => {
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			},
		});

		await expect(
			postChatStopRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
			}),
		).resolves.toEqual({
			status: 409,
			body: {
				error: "Chat has multiple active assistant runs.",
				errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			},
		});
	});

	it("returns structured lifecycle errors when reconnect lookup fails closed", async () => {
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			},
		});

		await expect(getChatReconnectRequest()).resolves.toEqual({
			status: 409,
			body: JSON.stringify({
				error: "Chat has multiple active assistant runs.",
				errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			}),
		});
	});

	it("rejects empty direct input before loading chat state", async () => {
		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "   " }],
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: { error: "input must not be empty" },
		});

		expect(convexMock.query).not.toHaveBeenCalled();
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("fails closed instead of starting an assistant stream", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce(new Error("save failed"));

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to persist user chat message." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(1);
	});

	it("fails a started run when active stream startup fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce({ ok: true });
		convexMock.mutation.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
		});
		convexMock.mutation.mockRejectedValueOnce(
			new Error("active stream failed"),
		);
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to start assistant stream." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(4);
		expect(convexMock.mutation.mock.calls[3]?.[1]).toEqual({
			runId: "run_1",
			errorText: "active stream failed",
		});
	});

	it("fails closed when edited branch truncation fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([
			{
				id: "msg-1",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "Original" }]),
			},
			{
				id: "msg-2",
				role: "assistant",
				partsJson: JSON.stringify([{ type: "text", text: "Old answer" }]),
			},
		]);
		convexMock.mutation.mockRejectedValueOnce(new Error("truncate failed"));

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				trigger: "submit-message",
				messageId: "msg-2",
				message: {
					id: "edited-message",
					role: "user",
					parts: [{ type: "text", text: "Edited question" }],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare edited chat branch." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(1);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			messageId: "msg-2",
		});
		expect(convexMock.query).toHaveBeenCalledTimes(3);
	});

	it("prepares replayed queued messages from the claimed queue row before starting a run", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce({
			_id: "queued_1",
			messageId: "message_1",
			partsJson: JSON.stringify([{ type: "text", text: "queued replay" }]),
			metadataJson: undefined,
		});
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce({ ok: true });
		convexMock.mutation.mockRejectedValueOnce(new Error("start failed"));

		const result = await postChatRequest(
			{
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
			},
			{ includeHeaders: true },
		);

		expect(result.status).toBe(500);
		expect(result.body).toEqual({
			error: "Failed to start assistant stream.",
		});
		expect(result.headers.get(hostedChatReplayAcceptedHeader)).toBe("true");
		expect(result.headers.get(hostedChatReplayQueuedMessageIdHeader)).toBe(
			"queued_1",
		);

		expect(convexMock.mutation.mock.calls[0]?.[1]).toMatchObject({
			queuedMessageId: "queued_1",
			message: {
				id: "message_1",
				role: "user",
				text: "queued replay",
			},
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toMatchObject({
			chatId: "chat_1",
		});
	});

	it("rejects a replay request that also includes a client message body", async () => {
		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
				message: {
					id: "client_message_ignored",
					role: "user",
					parts: [{ type: "text", text: "tampered replay" }],
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

		expect(convexMock.query).not.toHaveBeenCalled();
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("discards a claimed steer message when active run interrupt fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockRejectedValueOnce(new Error("interrupt failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to interrupt active assistant run." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("fails closed when claimed steer cleanup fails after active run interrupt failure", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockRejectedValueOnce(new Error("interrupt failed"));
		convexMock.mutation.mockRejectedValueOnce(new Error("discard failed"));

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to clean up claimed steered message." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("discards a claimed steer message when pre-accept preparation fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare steered assistant run." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("fails closed when claimed steer cleanup fails after preparation failure", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockRejectedValueOnce(new Error("discard failed"));

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to clean up claimed steered message." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("does not interrupt a waiting run before accepting queued input", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "waiting_for_user",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare steered assistant run." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(2);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			queuedMessageId: "queued_1",
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("prepares steered input from the claimed queue row without a client message body", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare steered assistant run." },
		});

		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			queuedMessageId: "queued_1",
		});
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("accepts a steered input batch and keeps app-server-style steer acceptance headers when later stream startup fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
			{
				_id: "queued_2",
				messageId: "message_2",
				partsJson: JSON.stringify([
					{ type: "text", text: "queued steer follow-up" },
				]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce(new Error("start failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		const result = await postChatRequest(
			{
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: "gpt-5.4",
				appsEnabled: false,
				continueRunId: "run_1",
				steerQueuedMessageId: "queued_1",
			},
			{ includeHeaders: true, isSteerRoute: true },
		);

		expect(result.status).toBe(500);
		expect(result.body).toEqual({
			error: "Failed to start assistant stream.",
		});
		expect(result.headers.get(hostedChatSteerAcceptedHeader)).toBe("true");
		expect(result.headers.get(hostedChatSteerQueuedMessageIdHeader)).toBe(
			"queued_1",
		);
		expect(result.headers.get(hostedChatSteerQueuedMessageIdsHeader)).toBe(
			"queued_1,queued_2",
		);
		expect(result.headers.get(hostedChatSteerTurnIdHeader)).toBe("run_1");
		expect(convexMock.mutation.mock.calls[2]?.[1]).toMatchObject({
			runId: "run_1",
			messages: [
				expect.objectContaining({
					queuedMessageId: "queued_1",
					message: expect.objectContaining({
						id: "message_1",
						role: "user",
						text: "queued steer",
					}),
				}),
				expect.objectContaining({
					queuedMessageId: "queued_2",
					message: expect.objectContaining({
						id: "message_2",
						role: "user",
						text: "queued steer follow-up",
					}),
				}),
			],
		});
	});

	it("returns the stale steer transition error when cleanup sees an already consumed queue row", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: "gpt-5.4",
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				partsJson: JSON.stringify([{ type: "text", text: "queued steer" }]),
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce({
			data: {
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot accept steered user input.",
			},
		});
		convexMock.mutation.mockRejectedValueOnce({
			data: {
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			},
		});

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: "gpt-5.4",
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 409,
			body: {
				error: "Assistant run cannot accept steered user input.",
				errorCode: "INVALID_ASSISTANT_RUN_TRANSITION",
			},
		});

		expect(convexMock.mutation.mock.calls.at(-1)?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("interrupts orphaned active runs on reconnect when no live stream session exists", async () => {
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValue(null);

		await expect(getChatReconnectRequest()).resolves.toEqual({
			status: 204,
			body: "",
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			stopReason: "cleanup_failed",
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			runId: "run_1",
		});
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			runId: "run_1",
		});
	});

	it("terminalizes manual stops even when active stream cleanup fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce(
			new Error("active stream cleanup failed"),
		);
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatStopRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "active stream cleanup failed" },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			stopReason: "user_requested",
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			runId: "run_1",
		});
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			runId: "run_1",
		});
	});
});
