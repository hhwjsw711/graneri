import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { stopActiveChatStreamWithTransport } from "../src/lib/chat-active-stream";

const tokenMocks = vi.hoisted(() => ({
	getCachedConvexToken: vi.fn(),
}));

vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: tokenMocks.getCachedConvexToken,
}));

vi.mock("../src/lib/runtime-config", () => ({
	getChatApiUrl: () => "/api/chat",
}));

const workspaceId = "workspace-1" as Id<"workspaces">;

describe("chat active stream client controls", () => {
	beforeEach(() => {
		tokenMocks.getCachedConvexToken.mockReset();
	});

	it("rejects stop requests before HTTP when the Convex token is missing", async () => {
		const fetchChatStop = vi.fn<typeof fetch>();
		tokenMocks.getCachedConvexToken.mockResolvedValue(null);

		await expect(
			stopActiveChatStreamWithTransport({
				chatId: "chat-1",
				fetchChatStop,
				workspaceId,
			}),
		).rejects.toThrow("Cannot stop chat stream without a Convex token.");

		expect(fetchChatStop).not.toHaveBeenCalled();
	});

	it("sends stop requests with explicit run interruption context", async () => {
		const fetchChatStop = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("{}", {
				status: 200,
			}),
		);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		await stopActiveChatStreamWithTransport({
			chatId: "chat-1",
			fetchChatStop,
			interruptActiveRun: true,
			workspaceId,
		});

		expect(fetchChatStop).toHaveBeenCalledWith("/api/chat/stop", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				id: "chat-1",
				interruptActiveRun: true,
				workspaceId,
				convexToken: "fresh-token",
			}),
		});
	});
});
