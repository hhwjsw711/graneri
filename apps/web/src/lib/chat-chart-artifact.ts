import type { GeneratedChartSpec } from "@workspace/ui/components/generated-chart";
import type { UIMessage } from "ai";
import { z } from "zod";

const chartDataValueSchema = z.union([z.string(), z.number()]);
const chartKeySchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z][A-Za-z0-9_-]*$/u);

const chartArtifactSchema = z
	.object({
		chartType: z.enum(["bar", "line", "area", "pie"]),
		config: z.record(
			chartKeySchema,
			z.object({
				label: z.string().min(1),
				color: z.string().optional(),
			}),
		),
		data: z
			.array(z.record(z.string().min(1), chartDataValueSchema))
			.min(1)
			.max(80),
		description: z.string().optional(),
		title: z.string().optional(),
		type: z.literal("chart").optional(),
		xKey: chartKeySchema.optional(),
		yKeys: z.array(chartKeySchema).min(1).max(5),
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

export type ChatChartArtifact = GeneratedChartSpec;
export type ChatChartArtifactEntry = {
	id: string;
	spec: ChatChartArtifact;
};

const parseChatChartArtifact = (value: unknown): ChatChartArtifact | null => {
	const parsed = chartArtifactSchema.safeParse(value);

	if (!parsed.success) {
		return null;
	}

	const artifact = parsed.data;

	if (artifact.yKeys.some((key) => !(key in artifact.config))) {
		return null;
	}

	return artifact;
};

export const extractChatChartArtifacts = (
	message: UIMessage,
): ChatChartArtifactEntry[] =>
	message.parts.flatMap((part) => {
		if (part.type !== "tool-generate_chart") {
			return [];
		}

		if (!("state" in part) || part.state !== "output-available") {
			return [];
		}

		const chart = parseChatChartArtifact("output" in part ? part.output : null);

		return chart
			? [
					{
						id:
							"toolCallId" in part && typeof part.toolCallId === "string"
								? part.toolCallId
								: `${message.id}:chart`,
						spec: chart,
					},
				]
			: [];
	});
