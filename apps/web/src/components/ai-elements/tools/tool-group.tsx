import type { UIMessage } from "ai";
import { memo, useEffect, useMemo, useState } from "react";
import { ToolDetails } from "@/components/ai-elements/tools/tool-details";
import { toToolPartLike } from "@/components/ai-elements/tools/tool-part-like";
import { ToolPreview } from "@/components/ai-elements/tools/tool-preview";
import { hasCustomToolPreview } from "@/components/ai-elements/tools/tool-preview-policy";
import { getToolMeta } from "@/components/ai-elements/tools/tool-registry";
import { ToolRowBase } from "@/components/ai-elements/tools/tool-row-base";
import { getToolStatus } from "@/components/ai-elements/utils/format-tool";
import {
	formatElapsedTime,
	getToolDurationMs,
	getToolStartedAt,
} from "@/components/ai-elements/utils/tool-display";

export type ToolGroupProps = {
	chatStatus: "streaming" | "ready";
	parts: UIMessage["parts"];
};

const formatCallCount = (count: number) =>
	`${count} ${count === 1 ? "call" : "calls"}`;

const getGroupSummary = ({
	failedCount,
	totalCount,
}: {
	failedCount: number;
	totalCount: number;
}) => {
	const segments = [formatCallCount(totalCount)];

	if (failedCount > 0) {
		segments.push(`${failedCount} failed`);
	}

	return segments.join(", ");
};

export const ToolGroup = memo(function ToolGroup({
	chatStatus,
	parts,
}: ToolGroupProps) {
	const [expanded, setExpanded] = useState(false);
	const toolParts = useMemo(() => parts.map(toToolPartLike), [parts]);
	const statuses = useMemo(
		() => toolParts.map((part) => getToolStatus(part, chatStatus)),
		[chatStatus, toolParts],
	);
	const isPending = statuses.some((status) => status.isPending);
	const { completedAt, fallbackStartedAt, now } = useToolTimer(isPending);
	const summary = useMemo(() => {
		let durationMs = 0;
		let failedCount = 0;
		let hasRecordedDuration = false;

		for (const [index, part] of toolParts.entries()) {
			const status = statuses[index];
			if (!status) {
				continue;
			}

			if (status.isError) {
				failedCount += 1;
			}

			const displayDurationMs = getToolDisplayDurationMs({
				completedAt,
				fallbackStartedAt,
				isPending: status.isPending,
				now,
				part,
			});

			if (displayDurationMs !== null) {
				durationMs += displayDurationMs;
				hasRecordedDuration = true;
			}
		}

		const groupFallbackDurationMs = Math.max(
			1,
			(completedAt ?? now) - fallbackStartedAt,
		);
		const resolvedDurationMs = hasRecordedDuration
			? Math.max(1, durationMs)
			: groupFallbackDurationMs;

		return {
			durationLabel: formatElapsedTime(resolvedDurationMs),
			failedCount,
			summary: getGroupSummary({
				failedCount,
				totalCount: toolParts.length,
			}),
		};
	}, [completedAt, fallbackStartedAt, now, statuses, toolParts]);

	return (
		<ToolRowBase
			shimmerLabel="Working"
			completeLabel="Worked"
			isAnimating={isPending}
			detail={summary.summary}
			expandable
			expanded={expanded}
			onToggleExpand={() => setExpanded((value) => !value)}
			trailingContent={
				summary.durationLabel ? (
					<span className="shrink-0 font-normal tabular-nums text-muted-foreground/60">
						{summary.durationLabel}
					</span>
				) : undefined
			}
		>
			<div className="flex flex-col gap-1.5">
				{parts.map((part, index) => (
					<NestedToolRow
						key={getToolPartKey(part, index)}
						part={part}
						chatStatus={chatStatus}
					/>
				))}
			</div>
		</ToolRowBase>
	);
});

const getToolDisplayDurationMs = ({
	completedAt,
	fallbackStartedAt,
	isPending,
	now,
	part,
}: {
	completedAt: number | null;
	fallbackStartedAt: number;
	isPending: boolean;
	now: number;
	part: ReturnType<typeof toToolPartLike>;
}) => {
	const completedDuration = getToolDurationMs(part);
	if (completedDuration !== null && completedDuration > 0) {
		return completedDuration;
	}

	const startedAt = getToolStartedAt(part) ?? fallbackStartedAt;

	if (!isPending && completedAt !== null) {
		return Math.max(1, completedAt - startedAt);
	}

	return isPending ? Math.max(1, now - startedAt) : null;
};

const useToolTimer = (isPending: boolean) => {
	const [fallbackStartedAt] = useState(() => Date.now());
	const [completedAt, setCompletedAt] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!isPending) {
			return;
		}

		setNow(Date.now());
		const interval = window.setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => window.clearInterval(interval);
	}, [isPending]);

	useEffect(() => {
		if (isPending) {
			if (completedAt !== null) {
				setCompletedAt(null);
			}
			return;
		}

		if (completedAt === null) {
			setCompletedAt(Date.now());
		}
	}, [completedAt, isPending]);

	return {
		completedAt,
		fallbackStartedAt,
		now,
	};
};

const getToolPartKey = (part: UIMessage["parts"][number], index: number) =>
	"toolCallId" in part && typeof part.toolCallId === "string"
		? part.toolCallId
		: `${part.type}:${index}`;

const NestedToolRow = memo(function NestedToolRow({
	chatStatus,
	part,
}: {
	chatStatus: "streaming" | "ready";
	part: UIMessage["parts"][number];
}) {
	const toolPart = toToolPartLike(part);
	const { isError, isPending } = getToolStatus(toolPart, chatStatus);
	const { completedAt, fallbackStartedAt, now } = useToolTimer(isPending);
	const durationMs = getToolDisplayDurationMs({
		completedAt,
		fallbackStartedAt,
		isPending,
		now,
		part: toolPart,
	});
	const durationLabel =
		durationMs !== null ? formatElapsedTime(Math.max(1, durationMs)) : "";
	const hasPreview = hasCustomToolPreview({ isError, toolPart });
	const hasDetails = Boolean(
		hasPreview ||
			toolPart.input ||
			toolPart.output ||
			toolPart.result ||
			toolPart.errorText,
	);

	const meta = getToolMeta(toolPart);
	if (!meta) {
		return null;
	}

	const Icon = meta.icon;
	const title = meta.title(toolPart);

	return (
		<ToolRowBase
			icon={
				Icon ? (
					<Icon className="size-full shrink-0 text-muted-foreground" />
				) : undefined
			}
			shimmerLabel={title}
			completeLabel={getNestedLabel({ isError, title })}
			isAnimating={isPending}
			detail={meta.subtitle?.(toolPart)}
			expandable={hasDetails}
			hideChevronUntilHover
			trailingContent={
				durationLabel ? (
					<span className="shrink-0 font-normal tabular-nums text-muted-foreground/60">
						{durationLabel}
					</span>
				) : undefined
			}
		>
			{hasPreview ? (
				<ToolPreview isError={isError} toolPart={toolPart} />
			) : (
				<ToolDetails
					input={toolPart.input}
					output={toolPart.output ?? toolPart.result}
					errorText={toolPart.errorText}
				/>
			)}
		</ToolRowBase>
	);
});

const getNestedLabel = ({
	isError,
	title,
}: {
	isError: boolean;
	title: string;
}) => {
	if (isError) {
		return `${title} failed`;
	}

	return title;
};
