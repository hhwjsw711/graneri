import assert from "node:assert/strict";
import test from "node:test";
import {
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerQueuedMessageIdsHeader,
	hostedChatSteerTurnIdHeader,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import { startLocalServer } from "../src/local-server.mjs";

const textPartsJson = (text) => JSON.stringify([{ type: "text", text }]);

const queuedSteerMessage = ({ id, messageId, text }) => ({
	_id: id,
	messageId,
	partsJson: textPartsJson(text),
	metadataJson: undefined,
});

test("local chat steer preserves accepted batch headers after stream start failure", async () => {
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	const originalConvexUrl = process.env.CONVEX_URL;
	const calls = [];
	let server = null;

	process.env.OPENAI_API_KEY = "test-openai-key";
	process.env.CONVEX_URL = "https://example.convex.cloud";

	try {
		server = await startLocalServer({
			createConvexClient: (convexToken) => ({
				async query(_functionRef, args) {
					calls.push({ args, convexToken, kind: "query" });
					if (calls.length === 1) {
						return {
							model: "gpt-5.4",
							title: "Existing chat",
						};
					}
					if (calls.length === 2) {
						return {
							_id: "run_1",
							status: "running",
							assistantMessageId: "assistant_1",
						};
					}
					return [];
				},
				async mutation(_functionRef, args) {
					calls.push({ args, convexToken, kind: "mutation" });
					if ("queuedMessageId" in args && "runId" in args) {
						return [
							queuedSteerMessage({
								id: "queued_1",
								messageId: "message_1",
								text: "queued steer",
							}),
							queuedSteerMessage({
								id: "queued_2",
								messageId: "message_2",
								text: "queued steer follow-up",
							}),
						];
					}
					if ("assistantMessageId" in args && "runId" in args) {
						throw new Error("start failed");
					}
					return null;
				},
			}),
		});

		const response = await fetch(`${server.origin}/api/chat/steer`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "test-convex-token",
				model: "gpt-5.4",
				appsEnabled: false,
				continueRunId: "run_1",
				steerQueuedMessageId: "queued_1",
			}),
		});

		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), {
			error: "Failed to start assistant stream.",
		});
		assert.equal(response.headers.get(hostedChatSteerAcceptedHeader), "true");
		assert.equal(
			response.headers.get(hostedChatSteerQueuedMessageIdHeader),
			"queued_1",
		);
		assert.equal(
			response.headers.get(hostedChatSteerQueuedMessageIdsHeader),
			"queued_1,queued_2",
		);
		assert.equal(response.headers.get(hostedChatSteerTurnIdHeader), "run_1");

		const acceptedSteerCall = calls.find(
			(call) =>
				call.kind === "mutation" &&
				Array.isArray(call.args.messages) &&
				call.args.runId === "run_1",
		);
		assert.ok(acceptedSteerCall);
		assert.deepEqual(
			acceptedSteerCall.args.messages.map(({ queuedMessageId, message }) => {
				assert.equal(typeof message.createdAt, "number");
				return {
					queuedMessageId,
					id: message.id,
					role: message.role,
					partsJson: message.partsJson,
					metadataJson: message.metadataJson,
					text: message.text,
				};
			}),
			[
				{
					queuedMessageId: "queued_1",
					id: "message_1",
					role: "user",
					partsJson: textPartsJson("queued steer"),
					metadataJson: undefined,
					text: "queued steer",
				},
				{
					queuedMessageId: "queued_2",
					id: "message_2",
					role: "user",
					partsJson: textPartsJson("queued steer follow-up"),
					metadataJson: undefined,
					text: "queued steer follow-up",
				},
			],
		);
	} finally {
		await server?.close();

		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}

		if (originalConvexUrl === undefined) {
			delete process.env.CONVEX_URL;
		} else {
			process.env.CONVEX_URL = originalConvexUrl;
		}
	}
});
