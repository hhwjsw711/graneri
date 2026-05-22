import { memo } from "react";
import { ToolDetails } from "@/components/ai-elements/tools/tool-details";
import { ToolRowBase } from "@/components/ai-elements/tools/tool-row-base";
import {
	formatElapsedTime,
	getToolDurationMs,
} from "@/components/ai-elements/utils/tool-display";

export type GenericToolProps = {
	icon?: React.ComponentType<{ className?: string }>;
	durationLabel?: string;
	errorTitle?: string;
	isError?: boolean;
	isPending: boolean;
	part?: {
		errorText?: string;
		input?: unknown;
		output?: Record<string, unknown>;
		result?: Record<string, unknown>;
	};
	subtitle?: string;
	title: string;
};

export const GenericTool = memo(function GenericTool({
	durationLabel,
	errorTitle,
	icon,
	isError,
	isPending,
	part,
	subtitle,
	title,
}: GenericToolProps) {
	const Icon = icon;
	const duration = part ? getToolDurationMs(part) : null;
	const resolvedDurationLabel =
		durationLabel ?? (duration ? formatElapsedTime(duration) : "");
	const hasDetails = Boolean(
		part?.input || part?.output || part?.result || part?.errorText,
	);

	return (
		<ToolRowBase
			icon={
				Icon ? (
					<Icon className="size-full shrink-0 text-muted-foreground" />
				) : undefined
			}
			shimmerLabel={title}
			completeLabel={isError ? (errorTitle ?? `${title} failed`) : title}
			isAnimating={isPending}
			detail={subtitle}
			expandable={hasDetails}
			trailingContent={
				resolvedDurationLabel ? (
					<span className="shrink-0 font-normal tabular-nums text-muted-foreground/60">
						{resolvedDurationLabel}
					</span>
				) : undefined
			}
		>
			{part ? (
				<ToolDetails
					input={part.input}
					output={part.output ?? part.result}
					errorText={part.errorText}
				/>
			) : null}
		</ToolRowBase>
	);
});
