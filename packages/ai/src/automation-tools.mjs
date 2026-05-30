import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { automationAppSourceProviders } from "./app-source-providers.mjs";
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

const getAvailableAppSourceDescription = (appSources) => {
	if (appSources.length === 0) {
		return "No connected app source ids are available in this chat. Omit appSourceIds.";
	}

	return `Available connected app source ids: ${appSources
		.map((source) => `${source.id} (${source.label})`)
		.join(", ")}. Only use ids from this list.`;
};

export const buildAutomationCreationInstruction = ({ now, timezone }) =>
	[
		"When the user asks to create, schedule, run, watch, check, summarize, or report on something automatically on a recurring cadence, use the create_automation tool.",
		"Do not merely explain how to create an automation when the user's wording is an instruction to schedule one.",
		`Current time for scheduling: ${new Date(now).toISOString()}. User timezone: ${timezone}.`,
		'Convert relative schedules like "every day at 9am", "weekdays at 10", or "every Monday at 15:30" into a schedulePeriod and scheduledAt timestamp in the user\'s timezone.',
		"Use the user's requested task as the automation prompt, omitting the scheduling phrase. Keep the title short and specific.",
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
			if (appSourceIds && appSourceIds.length > 0) {
				const validAppSourceIds = new Set(
					appSources.map((source) => source.id),
				);
				const unknownAppSourceIds = appSourceIds.filter(
					(sourceId) => !validAppSourceIds.has(sourceId),
				);

				if (unknownAppSourceIds.length > 0) {
					throw new Error(
						`Unknown automation app source id${unknownAppSourceIds.length === 1 ? "" : "s"}: ${unknownAppSourceIds.join(", ")}`,
					);
				}
			}

			const selectedAppSources =
				appSourceIds && appSourceIds.length > 0
					? appSources.filter((source) => appSourceIds.includes(source.id))
					: appSources;
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

			return {
				id: automation.id,
				title: automation.title,
				prompt: automation.prompt,
				schedulePeriod: automation.schedulePeriod,
				scheduledAt: automation.scheduledAt,
				timezone: automation.timezone,
				nextRunAt: automation.nextRunAt,
				chatId: automation.chatId,
			};
		},
	}).toAITool();

export const buildChatAutomationContext = ({
	appConnections,
	chatId,
	createAutomation,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	webSearchEnabled,
}) => {
	if (!chatId || !createAutomation) {
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
				createAutomation,
				defaultModel,
				defaultReasoningEffort,
				defaultTimezone,
				webSearchEnabled,
			}),
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
