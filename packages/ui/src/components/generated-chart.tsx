import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { cn } from "@workspace/ui/lib/utils";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from "recharts";

const DEFAULT_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
] as const;

export type GeneratedChartSpec = {
	chartType: "bar" | "line" | "area" | "pie";
	config: Record<
		string,
		{
			label: string;
			color?: string;
		}
	>;
	data: Array<Record<string, number | string>>;
	description?: string;
	title?: string;
	type?: "chart";
	xKey?: string;
	yKeys: string[];
};

export function GeneratedChart({
	className,
	spec,
}: {
	className?: string;
	spec: GeneratedChartSpec;
}) {
	const chartConfig = toChartConfig(spec);
	const firstValueKey = spec.yKeys[0];

	if (!firstValueKey || spec.data.length === 0) {
		return null;
	}

	return (
		<div
			className={cn(
				"w-full max-w-[min(100%,620px)] rounded-lg border border-border/60 bg-background p-4 shadow-sm",
				className,
			)}
		>
			{spec.title || spec.description ? (
				<div className="mb-3 flex flex-col gap-1">
					{spec.title ? (
						<div className="font-medium text-foreground text-sm">
							{spec.title}
						</div>
					) : null}
					{spec.description ? (
						<div className="text-muted-foreground text-xs">
							{spec.description}
						</div>
					) : null}
				</div>
			) : null}
			<ChartContainer
				config={chartConfig}
				className="h-[260px] min-h-[220px] w-full"
				initialDimension={{ width: 560, height: 260 }}
			>
				<GeneratedChartBody spec={spec} />
			</ChartContainer>
		</div>
	);
}

function GeneratedChartBody({ spec }: { spec: GeneratedChartSpec }) {
	switch (spec.chartType) {
		case "area":
			return (
				<AreaChart accessibilityLayer data={spec.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey={spec.xKey} tickLine={false} axisLine={false} />
					<YAxis tickLine={false} axisLine={false} width={36} />
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					{spec.yKeys.map((key, index) => (
						<Area
							key={key}
							dataKey={key}
							type="monotone"
							fill={`var(--color-${key})`}
							stroke={`var(--color-${key})`}
							fillOpacity={0.24}
							stackId={spec.yKeys.length > 1 ? "chart" : undefined}
							isAnimationActive={index < 3}
						/>
					))}
				</AreaChart>
			);
		case "bar":
			return (
				<BarChart accessibilityLayer data={spec.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey={spec.xKey} tickLine={false} axisLine={false} />
					<YAxis tickLine={false} axisLine={false} width={36} />
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					{spec.yKeys.map((key) => (
						<Bar
							key={key}
							dataKey={key}
							fill={`var(--color-${key})`}
							radius={[4, 4, 0, 0]}
						/>
					))}
				</BarChart>
			);
		case "line":
			return (
				<LineChart accessibilityLayer data={spec.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey={spec.xKey} tickLine={false} axisLine={false} />
					<YAxis tickLine={false} axisLine={false} width={36} />
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					{spec.yKeys.map((key) => (
						<Line
							key={key}
							dataKey={key}
							type="monotone"
							stroke={`var(--color-${key})`}
							strokeWidth={2}
							dot={false}
						/>
					))}
				</LineChart>
			);
		case "pie":
			return (
				<PieChart accessibilityLayer>
					<ChartTooltip content={<ChartTooltipContent nameKey={spec.xKey} />} />
					<Pie
						data={spec.data}
						dataKey={spec.yKeys[0]}
						nameKey={spec.xKey}
						innerRadius={54}
						outerRadius={92}
						paddingAngle={2}
					>
						{spec.data.map((row, index) => (
							<Cell
								key={JSON.stringify(row)}
								fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
							/>
						))}
					</Pie>
					<ChartLegend content={<ChartLegendContent />} />
				</PieChart>
			);
	}
}

function toChartConfig(spec: GeneratedChartSpec): ChartConfig {
	return Object.fromEntries(
		spec.yKeys.map((key, index) => [
			key,
			{
				label: spec.config[key]?.label ?? key,
				color:
					spec.config[key]?.color ??
					DEFAULT_COLORS[index % DEFAULT_COLORS.length],
			},
		]),
	);
}
