import type { UIMessage } from "ai";
import { memo, useEffect, useMemo, useState } from "react";
import { ToolDetails } from "@/components/ai-elements/tools/tool-details";
import { toToolPartLike } from "@/components/ai-elements/tools/tool-part-like";
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
	const [now, setNow] = useState(() => Date.now());
	const summary = useMemo(() => {
		const toolParts = parts.map(toToolPartLike);
		let durationMs = 0;
		let failedCount = 0;
		let hasLiveTimer = false;
		let pendingCount = 0;

		for (const part of toolParts) {
			const status = getToolStatus(part, chatStatus);
			if (status.isError) {
				failedCount += 1;
			}

			if (status.isPending) {
				pendingCount += 1;
				hasLiveTimer ||= getToolStartedAt(part) !== null;
			}

			durationMs += getToolDisplayDurationMs({
				isPending: status.isPending,
				now,
				part,
			});
		}

		return {
			durationLabel: durationMs > 0 ? formatElapsedTime(durationMs) : "",
			failedCount,
			hasLiveTimer,
			isPending: pendingCount > 0,
			summary: getGroupSummary({
				failedCount,
				totalCount: toolParts.length,
			}),
		};
	}, [chatStatus, now, parts]);

	useEffect(() => {
		if (!summary.hasLiveTimer) {
			return;
		}

		setNow(Date.now());
		const interval = window.setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => window.clearInterval(interval);
	}, [summary.hasLiveTimer]);

	return (
		<ToolRowBase
			shimmerLabel="Working"
			completeLabel="Worked"
			isAnimating={summary.isPending}
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
	isPending,
	now,
	part,
}: {
	isPending: boolean;
	now: number;
	part: ReturnType<typeof toToolPartLike>;
}) => {
	const completedDuration = getToolDurationMs(part);
	if (completedDuration !== null) {
		return completedDuration;
	}

	if (!isPending) {
		return 0;
	}

	const startedAt = getToolStartedAt(part);
	return startedAt === null ? 0 : Math.max(0, now - startedAt);
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
	const meta = getToolMeta(toolPart);
	if (!meta) {
		return null;
	}

	const { isError, isPending } = getToolStatus(toolPart, chatStatus);
	const Icon = meta.icon;
	const title = meta.title(toolPart);
	const hasDetails = Boolean(
		toolPart.input || toolPart.output || toolPart.result || toolPart.errorText,
	);

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
		>
			<ToolDetails
				input={toolPart.input}
				output={toolPart.output ?? toolPart.result}
				errorText={toolPart.errorText}
			/>
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
