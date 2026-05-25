import type React from "react";
import type {
	ChatChartArtifact,
	ChatChartArtifactEntry,
} from "@/lib/chat-chart-artifact";
import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";

const GeneratedChartEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<{
			GeneratedChart: React.ComponentType<{
				spec: ChatChartArtifact;
			}>;
		}>("../../../../../packages/ui/src/components/generated-chart.tsx"),
	),
	(module) => module.GeneratedChart,
);

export function ChatChartArtifacts({
	charts,
}: {
	charts: ChatChartArtifactEntry[];
}) {
	if (charts.length === 0) {
		return null;
	}

	return (
		<div className="mb-3 flex w-full flex-col gap-3 first:mt-0">
			{charts.map((chart) => (
				<div
					key={chart.id}
					className="min-h-[294px] w-full max-w-[min(100%,620px)]"
				>
					<GeneratedChartEntry spec={chart.spec} />
				</div>
			))}
		</div>
	);
}
