import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { getPendingAutomationDeleteConfirmation } from "@/lib/chat-automation-confirmation";

const assistantWithDeleteConfirmation = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{
			type: "tool-delete_automation",
			state: "output-available",
			toolCallId: "tool-1",
			input: {
				automationId: "automation-1",
				confirmationText: "delete this automation",
			},
			output: {
				id: "automation-1",
				requiresConfirmation: true,
				confirmation: {
					kind: "delete_automation",
					title: "Delete automation?",
					message: "This automation will stop running and be removed.",
					options: [
						{ id: "confirm", label: "Delete" },
						{ id: "cancel", label: "Cancel" },
					],
				},
			},
		},
	],
} satisfies UIMessage;

describe("chat automation confirmation", () => {
	it("finds the latest unanswered delete confirmation", () => {
		expect(
			getPendingAutomationDeleteConfirmation([assistantWithDeleteConfirmation]),
		).toEqual({
			automationId: "automation-1",
			title: "Delete automation?",
			message: "This automation will stop running and be removed.",
			options: [
				{ id: "confirm", label: "Delete" },
				{ id: "cancel", label: "Cancel" },
			],
		});
	});

	it("clears after a user response", () => {
		expect(
			getPendingAutomationDeleteConfirmation([
				assistantWithDeleteConfirmation,
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Cancel deletion." }],
				},
			]),
		).toBeNull();
	});
});
