import { describe, expect, it, vi } from "vitest";
import { stopOrphanedHostedAssistantRun } from "../../../packages/ai/src/hosted-chat-orphaned-run.mjs";

describe("hosted chat orphaned run cleanup", () => {
	it("terminalizes orphaned runs even when active stream cleanup fails", async () => {
		const calls: string[] = [];
		const requestStopAssistantRun = vi.fn(async () => {
			calls.push("requestStopAssistantRun");
		});
		const stopActiveStream = vi.fn(async () => {
			calls.push("stopActiveStream");
			throw new Error("active stream cleanup failed");
		});
		const finishStoppedAssistantRun = vi.fn(async () => {
			calls.push("finishStoppedAssistantRun");
		});

		await expect(
			stopOrphanedHostedAssistantRun({
				chatId: "chat-1",
				finishStoppedAssistantRun,
				logLatency: vi.fn(),
				requestStopAssistantRun,
				runId: "run-1",
				stopActiveStream,
				workspaceId: "workspace-1",
			}),
		).rejects.toThrow("active stream cleanup failed");

		expect(calls).toEqual([
			"requestStopAssistantRun",
			"stopActiveStream",
			"finishStoppedAssistantRun",
		]);
		expect(finishStoppedAssistantRun).toHaveBeenCalledWith({
			runId: "run-1",
		});
	});
});
