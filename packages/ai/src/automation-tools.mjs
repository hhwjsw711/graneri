import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { automationAppSourceProviders } from "./capability-metadata.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const automationSchedulePeriodSchema = z.enum([
	"hourly",
	"daily",
	"weekdays",
	"weekly",
]);

const automationAppSourceSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	provider: z.enum(automationAppSourceProviders),
});

const automationIdSchema = z.string().min(1);

const getAvailableAppSourceDescription = (appSources) => {
	if (appSources.length === 0) {
		return "No connected app source ids are available in this chat. Omit appSourceIds.";
	}

	return `Available connected app source ids: ${appSources
		.map((source) => `${source.id} (${source.label})`)
		.join(", ")}. Only use ids from this list.`;
};

const validateSelectedAppSources = ({ appSourceIds, appSources }) => {
	if (!appSourceIds || appSourceIds.length === 0) {
		return null;
	}

	const validAppSourceIds = new Set(appSources.map((source) => source.id));
	const unknownAppSourceIds = appSourceIds.filter(
		(sourceId) => !validAppSourceIds.has(sourceId),
	);

	if (unknownAppSourceIds.length > 0) {
		throw new Error(
			`Unknown automation app source id${unknownAppSourceIds.length === 1 ? "" : "s"}: ${unknownAppSourceIds.join(", ")}`,
		);
	}

	return appSources.filter((source) => appSourceIds.includes(source.id));
};

const toAutomationToolResult = (automation) => ({
	id: automation.id,
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
	target: automation.target,
	nextRunAt: automation.nextRunAt,
	isPaused: automation.isPaused,
	chatId: automation.chatId,
});

const toAutomationListToolResult = (automations) =>
	automations.map(toAutomationToolResult);

const toAutomationMutationTarget = (target) =>
	target?.kind === "notes"
		? {
				kind: "notes",
				noteIds: target.noteIds ?? [],
			}
		: {
				kind: "workspace",
			};

export const buildAutomationCreationInstruction = ({ now, timezone }) =>
	[
		"When the user asks to create, schedule, run, watch, check, summarize, or report on something automatically on a recurring cadence, use the create_automation tool.",
		"When the user asks to list, inspect, edit, update, pause, resume, run now, or delete existing automations, use the matching automation management tool.",
		"Do not merely explain how to manage automations when the user's wording is an instruction to do it.",
		"Only delete an automation when the current user message explicitly asks to delete, remove, or disable it permanently. The delete_automation tool first asks for confirmation; call it with confirmed true only after the user confirms deletion.",
		`Current time for scheduling: ${new Date(now).toISOString()}. User timezone: ${timezone}.`,
		'Convert relative schedules like "every day at 9am", "weekdays at 10", or "every Monday at 15:30" into a schedulePeriod and scheduledAt timestamp in the user\'s timezone.',
		"Use the user's requested task as the automation prompt, omitting the scheduling phrase. Keep titles short and specific.",
	].join("\n");

export const createAutomationTool = ({
	appSources,
	chatId,
	createAutomation,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	webSearchEnabled,
}) =>
	defineAiTool({
		deferLoading: false,
		name: "create_automation",
		description:
			"Create a recurring Graneri automation from the current chat. Use this when the user asks for a task to run automatically on a schedule.",
		inputSchema: z.object({
			title: z.string().min(1).max(80),
			prompt: z
				.string()
				.min(1)
				.describe(
					"The task to run each time, without the scheduling phrase. Include enough context for future runs.",
				),
			schedulePeriod: automationSchedulePeriodSchema,
			scheduledAt: z
				.number()
				.finite()
				.describe(
					"Unix epoch milliseconds representing the requested local time in the user's timezone.",
				),
			appSourceIds: z
				.array(z.string().min(1))
				.optional()
				.describe(
					`Optional selected connected app source ids to attach to the automation. Omit to use the chat's selected app sources. ${getAvailableAppSourceDescription(appSources)}`,
				),
		}),
		policy: {
			access: "write",
			capability: "create",
			provider: "graneri",
		},
		ui: toolUiMetadata.create_automation,
		execute: async ({
			appSourceIds,
			prompt,
			scheduledAt,
			schedulePeriod,
			title,
		}) => {
			const selectedAppSources =
				validateSelectedAppSources({ appSourceIds, appSources }) ?? appSources;
			const automation = await createAutomation({
				title,
				prompt,
				model: defaultModel,
				reasoningEffort: defaultReasoningEffort,
				webSearchEnabled,
				appsEnabled: selectedAppSources.length > 0,
				appSources: selectedAppSources,
				schedulePeriod,
				scheduledAt,
				timezone: defaultTimezone,
				target: {
					kind: "workspace",
				},
				chatId,
			});

			return toAutomationToolResult(automation);
		},
	}).toAITool();

const createListAutomationsTool = ({ listAutomations }) =>
	defineAiTool({
		deferLoading: false,
		name: "list_automations",
		description:
			"List the user's automations in the current workspace. Use this before updating, pausing, resuming, running, or deleting when the target automation is ambiguous.",
		inputSchema: z.object({}),
		policy: {
			access: "read",
			capability: "read",
			provider: "graneri",
		},
		ui: toolUiMetadata.list_automations,
		execute: async () => toAutomationListToolResult(await listAutomations()),
	}).toAITool();

const createGetAutomationTool = ({ getAutomation }) =>
	defineAiTool({
		deferLoading: false,
		name: "get_automation",
		description:
			"Get one automation by id before editing it or when the user asks for its details.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "read",
			capability: "read",
			provider: "graneri",
		},
		ui: toolUiMetadata.get_automation,
		execute: async ({ automationId }) => {
			const automation = await getAutomation({ automationId });
			if (!automation) {
				throw new Error("Automation not found.");
			}

			return toAutomationToolResult(automation);
		},
	}).toAITool();

const createUpdateAutomationTool = ({
	appSources,
	defaultTimezone,
	getAutomation,
	updateAutomation,
}) =>
	defineAiTool({
		deferLoading: false,
		name: "update_automation",
		description:
			"Update an existing recurring Graneri automation. Omitted fields keep their current values.",
		inputSchema: z.object({
			automationId: automationIdSchema,
			title: z.string().min(1).max(80).optional(),
			prompt: z.string().min(1).optional(),
			schedulePeriod: automationSchedulePeriodSchema.optional(),
			scheduledAt: z.number().finite().optional(),
			appSourceIds: z
				.array(z.string().min(1))
				.optional()
				.describe(
					`Optional replacement connected app source ids. Omit to keep current app sources. ${getAvailableAppSourceDescription(appSources)}`,
				),
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.update_automation,
		execute: async ({
			appSourceIds,
			automationId,
			prompt,
			scheduledAt,
			schedulePeriod,
			title,
		}) => {
			const currentAutomation = await getAutomation({ automationId });
			if (!currentAutomation) {
				throw new Error("Automation not found.");
			}

			const selectedAppSources =
				validateSelectedAppSources({ appSourceIds, appSources }) ??
				currentAutomation.appSources;
			const automation = await updateAutomation({
				automationId,
				title: title ?? currentAutomation.title,
				prompt: prompt ?? currentAutomation.prompt,
				model: currentAutomation.model,
				reasoningEffort: currentAutomation.reasoningEffort,
				webSearchEnabled: currentAutomation.webSearchEnabled,
				appsEnabled: selectedAppSources.length > 0,
				appSources: selectedAppSources,
				schedulePeriod: schedulePeriod ?? currentAutomation.schedulePeriod,
				scheduledAt: scheduledAt ?? currentAutomation.scheduledAt,
				timezone: currentAutomation.timezone ?? defaultTimezone,
				target: toAutomationMutationTarget(currentAutomation.target),
			});

			return toAutomationToolResult(automation);
		},
	}).toAITool();

const createPauseAutomationTool = ({ getAutomation, togglePaused }) =>
	defineAiTool({
		deferLoading: false,
		name: "pause_automation",
		description: "Pause an active automation by id.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.pause_automation,
		execute: async ({ automationId }) => {
			const currentAutomation = await getAutomation({ automationId });
			if (!currentAutomation) {
				throw new Error("Automation not found.");
			}
			if (currentAutomation.isPaused) {
				return toAutomationToolResult(currentAutomation);
			}

			return toAutomationToolResult(await togglePaused({ automationId }));
		},
	}).toAITool();

const createResumeAutomationTool = ({ getAutomation, togglePaused }) =>
	defineAiTool({
		deferLoading: false,
		name: "resume_automation",
		description: "Resume a paused automation by id.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.resume_automation,
		execute: async ({ automationId }) => {
			const currentAutomation = await getAutomation({ automationId });
			if (!currentAutomation) {
				throw new Error("Automation not found.");
			}
			if (!currentAutomation.isPaused) {
				return toAutomationToolResult(currentAutomation);
			}

			return toAutomationToolResult(await togglePaused({ automationId }));
		},
	}).toAITool();

const createRunAutomationNowTool = ({ runAutomationNow }) =>
	defineAiTool({
		deferLoading: false,
		name: "run_automation_now",
		description: "Start an automation manual run now by id.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.run_automation_now,
		execute: async ({ automationId }) =>
			await runAutomationNow({ automationId }),
	}).toAITool();

const createDeleteAutomationTool = ({ deleteAutomation }) =>
	defineAiTool({
		deferLoading: false,
		name: "delete_automation",
		description:
			"Delete an automation by id. Only use when the current user message explicitly asks to delete, remove, or permanently disable that automation.",
		inputSchema: z.object({
			automationId: automationIdSchema,
			confirmed: z
				.boolean()
				.optional()
				.describe(
					"Set to true only after the user confirms deletion in the current turn.",
				),
			confirmationText: z
				.string()
				.min(1)
				.describe(
					"The exact current user instruction that explicitly asks to delete, remove, or permanently disable the automation.",
				),
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.delete_automation,
		execute: async ({ automationId, confirmed, confirmationText }) => {
			if (
				!/\b(delete|remove|permanently disable|disable permanently)\b/iu.test(
					confirmationText,
				)
			) {
				throw new Error(
					"Deleting automations requires an explicit delete or remove instruction in the current user message.",
				);
			}

			if (confirmed !== true) {
				return {
					id: automationId,
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
				};
			}

			await deleteAutomation({ automationId });

			return {
				id: automationId,
				deleted: true,
			};
		},
	}).toAITool();

export const buildChatAutomationContext = ({
	appConnections,
	automationActions,
	chatId,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	webSearchEnabled,
}) => {
	if (!chatId || !automationActions?.createAutomation) {
		return {
			instruction: "",
			tools: {},
		};
	}

	const appSources = normalizeAutomationAppSources(appConnections);

	return {
		instruction: buildAutomationCreationInstruction({
			now: Date.now(),
			timezone: defaultTimezone,
		}),
		tools: {
			create_automation: createAutomationTool({
				appSources,
				chatId,
				createAutomation: automationActions.createAutomation,
				defaultModel,
				defaultReasoningEffort,
				defaultTimezone,
				webSearchEnabled,
			}),
			...(automationActions.listAutomations
				? {
						list_automations: createListAutomationsTool({
							listAutomations: automationActions.listAutomations,
						}),
					}
				: {}),
			...(automationActions.getAutomation
				? {
						get_automation: createGetAutomationTool({
							getAutomation: automationActions.getAutomation,
						}),
					}
				: {}),
			...(automationActions.getAutomation && automationActions.updateAutomation
				? {
						update_automation: createUpdateAutomationTool({
							appSources,
							defaultTimezone,
							getAutomation: automationActions.getAutomation,
							updateAutomation: automationActions.updateAutomation,
						}),
					}
				: {}),
			...(automationActions.getAutomation && automationActions.togglePaused
				? {
						pause_automation: createPauseAutomationTool({
							getAutomation: automationActions.getAutomation,
							togglePaused: automationActions.togglePaused,
						}),
						resume_automation: createResumeAutomationTool({
							getAutomation: automationActions.getAutomation,
							togglePaused: automationActions.togglePaused,
						}),
					}
				: {}),
			...(automationActions.runAutomationNow
				? {
						run_automation_now: createRunAutomationNowTool({
							runAutomationNow: automationActions.runAutomationNow,
						}),
					}
				: {}),
			...(automationActions.deleteAutomation
				? {
						delete_automation: createDeleteAutomationTool({
							deleteAutomation: automationActions.deleteAutomation,
						}),
					}
				: {}),
		},
	};
};

export const normalizeAutomationAppSources = (connections) =>
	connections
		.map((connection) => {
			const id = connection.sourceId ?? connection.id;
			const label =
				connection.displayName ?? connection.title ?? connection.provider ?? "";
			const provider = connection.provider;

			if (!id || !label || !provider) {
				return null;
			}

			const parsed = automationAppSourceSchema.safeParse({
				id,
				label,
				provider,
			});

			return parsed.success ? parsed.data : null;
		})
		.filter(Boolean);
