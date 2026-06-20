import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type {
	AutomationDraft,
	AutomationListItem,
} from "@/components/automations/automation-types";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const toAutomationMutationTarget = (target: AutomationDraft["target"]) =>
	target.kind === "notes"
		? {
				kind: "notes" as const,
				noteIds: target.noteIds,
			}
		: {
				kind: "workspace" as const,
			};

const toAutomationMutationInput = (automation: AutomationDraft) => ({
	title: automation.title,
	prompt: automation.prompt,
	model: automation.model,
	reasoningEffort: automation.reasoningEffort,
	webSearchEnabled: automation.webSearchEnabled,
	appsEnabled: automation.appsEnabled,
	appSources: automation.appSources,
	schedulePeriod: automation.schedulePeriod,
	scheduledAt: automation.scheduledAt,
	timezone: automation.timezone,
	target: toAutomationMutationTarget(automation.target),
});

export const useAutomationActions = ({
	openChat,
	workspaceId,
}: {
	openChat: (chatId: string) => void;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const createAutomation = useMutation(api.automations.create);
	const updateAutomation = useMutation(api.automations.update);
	const runAutomationNowMutation = useMutation(api.automations.runNow);
	const toggleAutomationPausedMutation = useMutation(
		api.automations.togglePaused,
	);
	const deleteAutomationMutation = useMutation(api.automations.remove);

	const saveAutomation = React.useCallback(
		async ({
			automation,
			automationChatId,
			editingAutomationId,
		}: {
			automation: AutomationDraft;
			automationChatId: string | null;
			editingAutomationId: Id<"automations"> | null;
		}) => {
			if (!workspaceId) {
				toast.error("Select a workspace before creating an automation");
				return false;
			}

			try {
				const input = toAutomationMutationInput(automation);
				if (editingAutomationId) {
					await updateAutomation({
						automationId: editingAutomationId,
						...input,
					});
					toast.success("Automation updated");
				} else {
					await createAutomation({
						workspaceId,
						chatId: automationChatId ?? undefined,
						...input,
					});
					toast.success("Automation created");
				}

				return true;
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to save automation",
				});
				toast.error("Failed to save automation");
				return false;
			}
		},
		[createAutomation, updateAutomation, workspaceId],
	);

	const runAutomationNow = React.useCallback(
		async (automationId: Id<"automations">) => {
			try {
				const result = await runAutomationNowMutation({ automationId });
				if (result.status === "already_running") {
					toast.info("Automation is already running");
					openChat(result.chatId);
					return;
				}
				if (result.status === "chat_busy") {
					toast.error("Wait for the current chat run to finish first");
					openChat(result.chatId);
					return;
				}
				openChat(result.chatId);
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to run automation",
				});
				toast.error("Failed to run automation");
			}
		},
		[openChat, runAutomationNowMutation],
	);

	const toggleAutomationPaused = React.useCallback(
		async (automationId: Id<"automations">) => {
			try {
				const automation = await toggleAutomationPausedMutation({
					automationId,
				});
				toast.success(
					automation.isPaused ? "Automation paused" : "Automation resumed",
				);
				return automation;
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to update automation",
				});
				toast.error("Failed to update automation");
				return null;
			}
		},
		[toggleAutomationPausedMutation],
	);

	const pauseAutomation = React.useCallback(
		async (automation: AutomationListItem | null) => {
			if (!automation || automation.isPaused) {
				return false;
			}

			const nextAutomation = await toggleAutomationPaused(automation.id);
			return Boolean(nextAutomation);
		},
		[toggleAutomationPaused],
	);

	const deleteAutomation = React.useCallback(
		async (automationId: Id<"automations">) => {
			try {
				await deleteAutomationMutation({ automationId });
				toast.success("Automation deleted");
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to delete automation",
				});
				toast.error("Failed to delete automation");
			}
		},
		[deleteAutomationMutation],
	);

	return React.useMemo(
		() => ({
			deleteAutomation,
			pauseAutomation,
			runAutomationNow,
			saveAutomation,
			toggleAutomationPaused,
		}),
		[
			deleteAutomation,
			pauseAutomation,
			runAutomationNow,
			saveAutomation,
			toggleAutomationPaused,
		],
	);
};
