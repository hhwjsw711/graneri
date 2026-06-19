import { DefaultChatTransport } from "ai";
import * as React from "react";
import { prepareChatReconnectToStreamRequest } from "@/lib/chat-resume";
import { FrameBudgetedChatTransport } from "@/lib/frame-budgeted-chat-transport";
import { getChatApiUrl } from "@/lib/runtime-config";
import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerQueuedMessageIdsHeader,
	hostedChatSteerTurnIdHeader,
} from "../../../../packages/ai/src/hosted-chat-runtime.mjs";

export const getWorkspaceChatSendApi = ({
	body,
	chatApiUrl,
}: {
	body: Record<string, unknown> | undefined;
	chatApiUrl: string;
}) =>
	typeof body?.steerQueuedMessageId === "string"
		? `${chatApiUrl}/steer`
		: chatApiUrl;

const isServerOwnedQueuedSend = (body: Record<string, unknown> | undefined) =>
	typeof body?.replayQueuedMessageId === "string" ||
	typeof body?.steerQueuedMessageId === "string";

export const createWorkspaceChatFetch =
	(baseFetch: typeof fetch = globalThis.fetch): typeof fetch =>
	async (input, init) => {
		const response = await baseFetch(input, init);
		const steerAccepted =
			response.headers.get(hostedChatSteerAcceptedHeader) === "true";
		const replayAccepted =
			response.headers.get(hostedChatReplayAcceptedHeader) === "true";
		if (response.ok || (!steerAccepted && !replayAccepted)) {
			return response;
		}

		const headers = new Headers({
			"Content-Type": "text/event-stream",
		});
		if (steerAccepted) {
			headers.set(hostedChatSteerAcceptedHeader, "true");
			const acceptedTurnId = response.headers.get(hostedChatSteerTurnIdHeader);
			if (acceptedTurnId) {
				headers.set(hostedChatSteerTurnIdHeader, acceptedTurnId);
			}
			const acceptedQueuedMessageId = response.headers.get(
				hostedChatSteerQueuedMessageIdHeader,
			);
			if (acceptedQueuedMessageId) {
				headers.set(
					hostedChatSteerQueuedMessageIdHeader,
					acceptedQueuedMessageId,
				);
			}
			const acceptedQueuedMessageIds = response.headers.get(
				hostedChatSteerQueuedMessageIdsHeader,
			);
			if (acceptedQueuedMessageIds) {
				headers.set(
					hostedChatSteerQueuedMessageIdsHeader,
					acceptedQueuedMessageIds,
				);
			}
		}

		if (replayAccepted) {
			headers.set(hostedChatReplayAcceptedHeader, "true");
			const acceptedReplayQueuedMessageId = response.headers.get(
				hostedChatReplayQueuedMessageIdHeader,
			);
			if (acceptedReplayQueuedMessageId) {
				headers.set(
					hostedChatReplayQueuedMessageIdHeader,
					acceptedReplayQueuedMessageId,
				);
			}
		}

		return new Response("", {
			status: 200,
			statusText: "OK",
			headers,
		});
	};

export const prepareWorkspaceChatSendBody = ({
	body,
	id,
	message,
	messageId,
	trigger,
	workspaceId,
}: {
	body: Record<string, unknown> | undefined;
	id: string;
	message: unknown;
	messageId: string | undefined;
	trigger: unknown;
	workspaceId: string | null;
}) => {
	if (isServerOwnedQueuedSend(body)) {
		return {
			...body,
			id,
			workspaceId,
		};
	}

	return {
		...body,
		id,
		message,
		trigger,
		messageId,
		workspaceId,
	};
};

export const useWorkspaceChatTransport = (workspaceId: string | null) =>
	React.useMemo(() => {
		const chatApiUrl = getChatApiUrl();

		const transport = new DefaultChatTransport({
			api: chatApiUrl,
			fetch: createWorkspaceChatFetch(),
			prepareSendMessagesRequest: ({
				id,
				messages,
				body,
				headers,
				credentials,
				trigger,
				messageId,
			}) => ({
				api: getWorkspaceChatSendApi({ body, chatApiUrl }),
				headers,
				credentials,
				body: prepareWorkspaceChatSendBody({
					body,
					id,
					message: messages[messages.length - 1],
					trigger,
					messageId,
					workspaceId,
				}),
			}),
			prepareReconnectToStreamRequest: async ({
				api,
				id,
				headers,
				credentials,
			}) => {
				const request = await prepareChatReconnectToStreamRequest({
					api,
					chatId: id,
					workspaceId,
				});
				const reconnectHeaders = new Headers(headers);
				for (const [key, value] of Object.entries(request.headers ?? {})) {
					reconnectHeaders.set(key, value);
				}

				return {
					...request,
					headers: reconnectHeaders,
					credentials,
				};
			},
		});

		return new FrameBudgetedChatTransport(transport);
	}, [workspaceId]);
