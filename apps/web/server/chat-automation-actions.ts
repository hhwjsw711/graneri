import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
	AutomationActions,
	AutomationToolInput,
} from "../../../packages/ai/src/automation-tools.mjs";

type AutomationToolTarget = AutomationToolInput["target"];
type AutomationToolUpdateInput = AutomationToolInput & { automationId: string };
type AutomationMutationAppSourceProvider =
	| "context7"
	| "figma"
	| "google-calendar"
	| "google-drive"
	| "jira"
	| "jira-mcp"
	| "linear"
	| "notion"
	| "posthog"
	| "yandex-calendar"
	| "yandex-tracker"
	| "zoom";

const automationMutationAppSourceProviders = new Set<string>([
	"context7",
	"figma",
	"google-calendar",
	"google-drive",
	"jira",
	"jira-mcp",
	"linear",
	"notion",
	"posthog",
	"yandex-calendar",
	"yandex-tracker",
	"zoom",
]);

const toAutomationId = (automationId: string) =>
	automationId as Id<"automations">;

const toNoteId = (noteId: string) => noteId as Id<"notes">;

const toAutomationMutationAppSourceProvider = (
	provider: string,
): AutomationMutationAppSourceProvider => {
	if (!automationMutationAppSourceProviders.has(provider)) {
		throw new Error(`Unsupported automation app source: ${provider}`);
	}

	return provider as AutomationMutationAppSourceProvider;
};

const toAutomationAppSourceMutationInput = (
	appSources: AutomationToolInput["appSources"],
) =>
	appSources.map((source) => ({
		id: source.id,
		label: source.label,
		provider: toAutomationMutationAppSourceProvider(source.provider),
	}));

const toAutomationTargetMutationInput = (target: AutomationToolTarget) => {
	if (target.kind === "notes") {
		return {
			kind: "notes" as const,
			label: target.label,
			noteIds: target.noteIds.map(toNoteId),
		};
	}
	return {
		kind: "workspace" as const,
		label: target.label,
	};
};

const toAutomationCreateMutationInput = (automation: AutomationToolInput) => ({
	...automation,
	appSources: toAutomationAppSourceMutationInput(automation.appSources),
	target: toAutomationTargetMutationInput(automation.target),
});

const toAutomationUpdateMutationInput = (
	automation: AutomationToolUpdateInput,
) => ({
	...toAutomationCreateMutationInput(automation),
	automationId: toAutomationId(automation.automationId),
});

export const createHostedChatAutomationActions = ({
	convexClient,
	workspaceId,
}: {
	convexClient: ConvexHttpClient;
	workspaceId: Id<"workspaces">;
}): AutomationActions => ({
	createAutomation: async (automation) =>
		await convexClient.mutation(api.automations.create, {
			workspaceId,
			...toAutomationCreateMutationInput(automation),
		}),
	deleteAutomation: async ({ automationId }) =>
		await convexClient.mutation(api.automations.remove, {
			automationId: toAutomationId(automationId),
		}),
	getAutomation: async ({ automationId }) =>
		await convexClient.query(api.automations.get, {
			automationId: toAutomationId(automationId),
		}),
	listAutomations: async () =>
		await convexClient.query(api.automations.list, { workspaceId }),
	runAutomationNow: async ({ automationId }) =>
		await convexClient.mutation(api.automations.runNow, {
			automationId: toAutomationId(automationId),
		}),
	togglePaused: async ({ automationId }) =>
		await convexClient.mutation(api.automations.togglePaused, {
			automationId: toAutomationId(automationId),
		}),
	updateAutomation: async (automation) =>
		await convexClient.mutation(
			api.automations.update,
			toAutomationUpdateMutationInput(automation),
		),
});
