import { DefaultChatTransport } from "ai";
import * as React from "react";
import { prepareChatReconnectToStreamRequest } from "@/lib/chat-resume";
import { FrameBudgetedChatTransport } from "@/lib/frame-budgeted-chat-transport";
import { getChatApiUrl } from "@/lib/runtime-config";

export const useWorkspaceChatTransport = (workspaceId: string | null) =>
	React.useMemo(() => {
		const chatApiUrl = getChatApiUrl();

		const transport = new DefaultChatTransport({
			api: chatApiUrl,
			prepareSendMessagesRequest: ({
				id,
				messages,
				body,
				headers,
				credentials,
				trigger,
				messageId,
			}) => ({
				api: chatApiUrl,
				headers,
				credentials,
				body: {
					...body,
					id,
					message: messages[messages.length - 1],
					trigger,
					messageId,
					workspaceId,
				},
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
