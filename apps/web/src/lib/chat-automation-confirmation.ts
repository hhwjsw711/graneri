import type { UIMessage } from "ai";
import { extractToolParts } from "@/lib/chat-message";

export type AutomationDeleteConfirmation = {
	automationId: string;
	message: string;
	options: Array<{ id: "confirm" | "cancel"; label: string }>;
	title: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const getToolPartOutput = (part: UIMessage["parts"][number]) => {
	if (!("output" in part)) {
		return null;
	}
	return asRecord(part.output);
};

const getString = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";

const parseOptions = (
	value: unknown,
): AutomationDeleteConfirmation["options"] => {
	if (!Array.isArray(value)) {
		return [
			{ id: "confirm", label: "Delete" },
			{ id: "cancel", label: "Cancel" },
		];
	}

	const options: AutomationDeleteConfirmation["options"] = value.flatMap(
		(item) => {
			const option = asRecord(item);
			const id = option?.id;
			const label = getString(option?.label);
			if ((id !== "confirm" && id !== "cancel") || !label) {
				return [];
			}
			return [{ id, label }];
		},
	);

	return options.length > 0
		? options
		: [
				{ id: "confirm", label: "Delete" },
				{ id: "cancel", label: "Cancel" },
			];
};

const parseAutomationDeleteConfirmation = (
	output: Record<string, unknown> | null,
): AutomationDeleteConfirmation | null => {
	if (output?.requiresConfirmation !== true) {
		return null;
	}

	const confirmation = asRecord(output.confirmation);
	if (confirmation?.kind !== "delete_automation") {
		return null;
	}

	const automationId = getString(output.id);
	const title = getString(confirmation.title) || "Delete automation?";
	const message =
		getString(confirmation.message) ||
		"This automation will stop running and be removed.";
	const options = parseOptions(confirmation.options);

	return automationId ? { automationId, message, options, title } : null;
};

export const getPendingAutomationDeleteConfirmation = (
	messages: UIMessage[],
): AutomationDeleteConfirmation | null => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "user") {
			return null;
		}
		if (message.role !== "assistant") {
			continue;
		}

		const toolParts = extractToolParts(message);
		for (let partIndex = toolParts.length - 1; partIndex >= 0; partIndex -= 1) {
			const confirmation = parseAutomationDeleteConfirmation(
				getToolPartOutput(toolParts[partIndex]),
			);
			if (confirmation) {
				return confirmation;
			}
		}
	}

	return null;
};
