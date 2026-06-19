import { describe, expect, it } from "vitest";
import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerTurnIdHeader,
} from "../../../packages/ai/src/hosted-chat-runtime.mjs";
import {
	createWorkspaceChatFetch,
	getWorkspaceChatSendApi,
	prepareWorkspaceChatSendBody,
} from "../src/hooks/use-workspace-chat-transport";

describe("getWorkspaceChatSendApi", () => {
	it("uses the steer endpoint for server-owned queued follow-up steering", () => {
		expect(
			getWorkspaceChatSendApi({
				chatApiUrl: "/api/chat",
				body: { steerQueuedMessageId: "queued-1" },
			}),
		).toBe("/api/chat/steer");
	});

	it("uses the normal chat endpoint for ordinary sends", () => {
		expect(
			getWorkspaceChatSendApi({
				chatApiUrl: "/api/chat",
				body: { continueRunId: "run-1" },
			}),
		).toBe("/api/chat");
	});

	it("omits client message bodies for queued replay requests", () => {
		expect(
			prepareWorkspaceChatSendBody({
				body: {
					convexToken: "fresh-token",
					model: "gpt-5",
					replayQueuedMessageId: "queued-1",
				},
				id: "chat-1",
				message: { role: "user", parts: [{ type: "text", text: "client" }] },
				messageId: "client-message-1",
				trigger: "submit-message",
				workspaceId: "workspace-1",
			}),
		).toEqual({
			convexToken: "fresh-token",
			id: "chat-1",
			model: "gpt-5",
			replayQueuedMessageId: "queued-1",
			workspaceId: "workspace-1",
		});
	});

	it("omits client message bodies for queued steer requests", () => {
		expect(
			prepareWorkspaceChatSendBody({
				body: {
					continueRunId: "run-1",
					convexToken: "fresh-token",
					model: "gpt-5",
					steerQueuedMessageId: "queued-1",
				},
				id: "chat-1",
				message: { role: "user", parts: [{ type: "text", text: "client" }] },
				messageId: "client-message-1",
				trigger: "submit-message",
				workspaceId: "workspace-1",
			}),
		).toEqual({
			continueRunId: "run-1",
			convexToken: "fresh-token",
			id: "chat-1",
			model: "gpt-5",
			steerQueuedMessageId: "queued-1",
			workspaceId: "workspace-1",
		});
	});

	it("includes client message bodies for ordinary sends", () => {
		const message = {
			role: "user",
			parts: [{ type: "text", text: "direct" }],
		};

		expect(
			prepareWorkspaceChatSendBody({
				body: { convexToken: "fresh-token", model: "gpt-5" },
				id: "chat-1",
				message,
				messageId: "client-message-1",
				trigger: "submit-message",
				workspaceId: "workspace-1",
			}),
		).toEqual({
			convexToken: "fresh-token",
			id: "chat-1",
			message,
			messageId: "client-message-1",
			model: "gpt-5",
			trigger: "submit-message",
			workspaceId: "workspace-1",
		});
	});
});

describe("createWorkspaceChatFetch", () => {
	it("converts accepted steer failures into empty successful streams", async () => {
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(JSON.stringify({ error: "stream failed" }), {
					status: 500,
					headers: {
						[hostedChatSteerAcceptedHeader]: "true",
						[hostedChatSteerTurnIdHeader]: "run-1",
						[hostedChatSteerQueuedMessageIdHeader]: "queued-1",
					},
				}),
		);

		const response = await fetch("/api/chat/steer", {
			method: "POST",
			body: JSON.stringify({ steerQueuedMessageId: "queued-1" }),
		});

		expect(response.ok).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get(hostedChatSteerAcceptedHeader)).toBe("true");
		expect(response.headers.get(hostedChatSteerTurnIdHeader)).toBe("run-1");
		expect(response.headers.get(hostedChatSteerQueuedMessageIdHeader)).toBe(
			"queued-1",
		);
		expect(await response.text()).toBe("");
	});

	it("leaves pre-accept steer failures untouched", async () => {
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(JSON.stringify({ error: "no active turn" }), {
					status: 409,
				}),
		);

		const response = await fetch("/api/chat/steer", {
			method: "POST",
			body: JSON.stringify({ steerQueuedMessageId: "queued-1" }),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "no active turn" });
	});

	it("converts accepted replay failures into empty successful streams", async () => {
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(JSON.stringify({ error: "stream failed" }), {
					status: 500,
					headers: {
						[hostedChatReplayAcceptedHeader]: "true",
						[hostedChatReplayQueuedMessageIdHeader]: "queued-1",
					},
				}),
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({ replayQueuedMessageId: "queued-1" }),
		});

		expect(response.ok).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get(hostedChatReplayAcceptedHeader)).toBe("true");
		expect(response.headers.get(hostedChatReplayQueuedMessageIdHeader)).toBe(
			"queued-1",
		);
		expect(await response.text()).toBe("");
	});
});
