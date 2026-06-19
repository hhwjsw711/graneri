import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatRequest } from "../server/chat-handler";

const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
const convexMocks = vi.hoisted(() => ({
	query: vi.fn(),
	mutation: vi.fn(),
	action: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		query = convexMocks.query;
		mutation = convexMocks.mutation;
		action = convexMocks.action;
	},
}));

afterEach(() => {
	convexMocks.query.mockReset();
	convexMocks.mutation.mockReset();
	convexMocks.action.mockReset();
	if (previousOpenAiApiKey === undefined) {
		delete process.env.OPENAI_API_KEY;
		return;
	}

	process.env.OPENAI_API_KEY = previousOpenAiApiKey;
});

const postSteerRequestWithMockedConvex = async () => {
	process.env.OPENAI_API_KEY = "test-key";
	convexMocks.query.mockRejectedValue(
		new Error(
			"Could not find public function for 'assistantQueuedMessages:claimReadyForRun'.",
		),
	);

	const server = createServer((request, response) => {
		void handleChatRequest(request, response, { isSteerRoute: true }).catch(
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
			`http://127.0.0.1:${address.port}/api/chat/steer`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: "chat-1",
					workspaceId: "workspace-1",
					convexToken: "token",
					model: "gpt-5",
					continueRunId: "run-1",
					steerQueuedMessageId: "queued-1",
				}),
			},
		);

		return {
			status: response.status,
			body: (await response.json()) as {
				error?: string;
				errorCode?: string;
			},
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

describe("chat Convex deployment skew handling", () => {
	it("returns an actionable out-of-sync error for missing Convex chat functions on steer", async () => {
		await expect(postSteerRequestWithMockedConvex()).resolves.toEqual({
			status: 500,
			body: {
				error: expect.stringContaining(
					"Convex deployment is out of sync with this Graneri checkout.",
				),
				errorCode: "convex_deployment_out_of_sync",
			},
		});
	});
});
