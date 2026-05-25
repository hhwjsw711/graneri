import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { extractTextFromUIMessage } from "./local-path-references.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const CHART_GENERATION_TOOL_NAME = "generate_chart";

export const shouldEnableChartGeneration = (message) =>
	Boolean(
		message &&
			/\b(chart|graph|plot|visuali[sz]e|trend|breakdown|comparison|compare|bar chart|line chart|area chart|pie chart)\b/iu.test(
				extractTextFromUIMessage(message),
			),
	);

export const buildChartGenerationPrepareStep =
	() =>
	({ stepNumber }) =>
		stepNumber === 0
			? {
					toolChoice: {
						type: "tool",
						toolName: CHART_GENERATION_TOOL_NAME,
					},
				}
			: { toolChoice: "auto" };

const chartDataValueSchema = z.union([z.string(), z.number()]);
const chartKeySchema = z
	.string()
	.min(1)
	.max(64)
	.regex(
		/^[A-Za-z][A-Za-z0-9_-]*$/u,
		"Chart keys must start with a letter and contain only letters, numbers, underscores, or dashes.",
	);

const chartDataRowSchema = z
	.record(z.string().min(1), chartDataValueSchema)
	.refine(
		(row) => Object.keys(row).length <= 16,
		"Chart rows can contain at most 16 fields.",
	);

const chartSeriesConfigSchema = z.object({
	label: z.string().min(1).max(80),
	color: z.string().max(80).optional(),
});

const chartSpecSchema = z
	.object({
		chartType: z.enum(["bar", "line", "area", "pie"]),
		title: z.string().min(1).max(120).optional(),
		description: z.string().min(1).max(240).optional(),
		xKey: chartKeySchema.optional(),
		yKeys: z.array(chartKeySchema).min(1).max(5),
		data: z.array(chartDataRowSchema).min(1).max(80),
		config: z
			.record(chartKeySchema, chartSeriesConfigSchema)
			.optional()
			.default({}),
	})
	.refine(
		(spec) => spec.chartType === "pie" || Boolean(spec.xKey),
		"Bar, line, and area charts require xKey.",
	)
	.refine(
		(spec) => spec.chartType !== "pie" || spec.yKeys.length === 1,
		"Pie charts support exactly one numeric value key.",
	)
	.refine(
		(spec) =>
			spec.data.every((row) => {
				if (spec.xKey && !(spec.xKey in row)) {
					return false;
				}

				return spec.yKeys.every(
					(key) => typeof row[key] === "number" && Number.isFinite(row[key]),
				);
			}),
		"Every row must include the xKey and finite numeric yKey values.",
	);

export const buildChartGenerationInstruction = () =>
	[
		"When the user asks for a chart, graph, trend, breakdown, comparison, or visualization, use the generate_chart tool.",
		"Do not answer chart requests with Mermaid, markdown code fences, ASCII charts, or raw JSON.",
		"Use rows shaped like { xKey: label, valueKey: number }, set xKey to the label field, set yKeys to numeric value fields, and prefer config labels over custom colors.",
		"For pie charts, use exactly one numeric yKey such as value or count, and put each category in the xKey field.",
		"Use only data provided by the user, available in the conversation, or clearly derived from note context.",
		"If there is not enough data to chart, ask a concise follow-up instead of inventing values.",
		"After using the tool, briefly summarize the chart insight in text.",
	].join(" ");

const isSafeChartColor = (color) =>
	typeof color === "string" &&
	(/^var\(--chart-[1-5]\)$/u.test(color) ||
		/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(color));

const normalizeChartConfig = (spec) =>
	Object.fromEntries(
		spec.yKeys.map((key, index) => {
			const config = spec.config[key] ?? {};
			const color = isSafeChartColor(config.color)
				? config.color
				: `var(--chart-${(index % 5) + 1})`;

			return [
				key,
				{
					label: config.label || key,
					color,
				},
			];
		}),
	);

export const createChartGenerationTool = () =>
	defineAiTool({
		deferLoading: false,
		name: CHART_GENERATION_TOOL_NAME,
		description:
			"Create a chart artifact from structured data supplied in the conversation or note context. Use this for bar, line, area, and pie charts.",
		inputSchema: chartSpecSchema,
		policy: {
			access: "read",
			capability: "generate",
			provider: "openai",
		},
		ui: toolUiMetadata.generate_chart,
		execute: async (spec) => ({
			...spec,
			config: normalizeChartConfig(spec),
			type: "chart",
		}),
	}).toAITool();
