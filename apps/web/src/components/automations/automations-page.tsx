"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { cn } from "@workspace/ui/lib/utils";
import {
	Clock,
	MoreHorizontal,
	Pause,
	Pencil,
	Play,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { PageTitle } from "@/components/layout/page-title";
import {
	groupItemsByRelativeDate,
	RELATIVE_DATE_GROUP_SECTIONS,
} from "@/lib/group-by-relative-date";
import type { AutomationListItem } from "./automation-types";
import { getAutomationSchedulePeriodLabel } from "./automation-utils";

export type AutomationsPageProps = {
	automations: AutomationListItem[] | undefined;
	isDesktopMac: boolean;
	onCreateAutomation: () => void;
	onDeleteAutomation: (automationId: AutomationListItem["id"]) => void;
	onEditAutomation: (automationId: AutomationListItem["id"]) => void;
	onOpenAutomation: (automation: AutomationListItem) => void;
	onRunAutomationNow: (automationId: AutomationListItem["id"]) => void;
	onToggleAutomationPaused: (automationId: AutomationListItem["id"]) => void;
};

export function AutomationsPage({
	automations,
	isDesktopMac,
	onCreateAutomation,
	onDeleteAutomation,
	onEditAutomation,
	onOpenAutomation,
	onRunAutomationNow,
	onToggleAutomationPaused,
}: AutomationsPageProps) {
	return (
		<div className="flex flex-1 justify-center px-4 pb-6 md:px-6">
			<div
				className={cn(
					"flex w-full max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full max-w-xl space-y-6">
					<PageTitle isDesktopMac={isDesktopMac}>Automated work</PageTitle>
					<Card className="overflow-hidden rounded-lg border-border py-0 shadow-sm">
						<CardContent
							aria-busy={automations === undefined}
							className="flex items-start justify-between gap-4 p-5"
						>
							<div>
								{automations !== undefined ? (
									<p className="text-5xl leading-none tracking-tight tabular-nums">
										{automations.length}
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>
				</section>
				<section className="flex justify-center py-4">
					{automations === undefined ? null : automations.length > 0 ? (
						<AutomationsList
							automations={automations}
							onDeleteAutomation={onDeleteAutomation}
							onEditAutomation={onEditAutomation}
							onOpenAutomation={onOpenAutomation}
							onRunAutomationNow={onRunAutomationNow}
							onToggleAutomationPaused={onToggleAutomationPaused}
						/>
					) : (
						<Empty className="max-w-xl">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<Clock className="size-4" />
								</EmptyMedia>
								<EmptyTitle>No automations yet</EmptyTitle>
								<EmptyDescription>
									Create a scheduled prompt and it will show up here
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button type="button" onClick={onCreateAutomation}>
									New automation
								</Button>
							</EmptyContent>
						</Empty>
					)}
				</section>
			</div>
		</div>
	);
}

function AutomationsList({
	automations,
	onDeleteAutomation,
	onEditAutomation,
	onOpenAutomation,
	onRunAutomationNow,
	onToggleAutomationPaused,
}: {
	automations: AutomationListItem[];
	onDeleteAutomation: (automationId: AutomationListItem["id"]) => void;
	onEditAutomation: (automationId: AutomationListItem["id"]) => void;
	onOpenAutomation: (automation: AutomationListItem) => void;
	onRunAutomationNow: (automationId: AutomationListItem["id"]) => void;
	onToggleAutomationPaused: (automationId: AutomationListItem["id"]) => void;
}) {
	const groupedAutomations = groupItemsByRelativeDate(
		automations,
		(automation) => automation.createdAt,
	);
	const sections = RELATIVE_DATE_GROUP_SECTIONS.map((section) => ({
		...section,
		automations: groupedAutomations[section.key],
	}));

	return (
		<div className="w-full max-w-xl space-y-1">
			{sections.map((section) => {
				if (section.automations.length === 0) {
					return null;
				}

				return (
					<div key={section.key} className="space-y-2">
						<div className="flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium text-foreground/70">
							{section.label}
						</div>
						<div className="space-y-2">
							{section.automations.map((automation) => (
								<AutomationListItemRow
									key={automation.id}
									automation={automation}
									onDeleteAutomation={onDeleteAutomation}
									onEditAutomation={onEditAutomation}
									onOpenAutomation={onOpenAutomation}
									onRunAutomationNow={onRunAutomationNow}
									onToggleAutomationPaused={onToggleAutomationPaused}
								/>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function AutomationListItemRow({
	automation,
	onDeleteAutomation,
	onEditAutomation,
	onOpenAutomation,
	onRunAutomationNow,
	onToggleAutomationPaused,
}: {
	automation: AutomationListItem;
	onDeleteAutomation: (automationId: AutomationListItem["id"]) => void;
	onEditAutomation: (automationId: AutomationListItem["id"]) => void;
	onOpenAutomation: (automation: AutomationListItem) => void;
	onRunAutomationNow: (automationId: AutomationListItem["id"]) => void;
	onToggleAutomationPaused: (automationId: AutomationListItem["id"]) => void;
}) {
	const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
	const authorName = automation.authorName?.trim() || "Unknown user";

	return (
		<>
			<div className="group flex items-center rounded-lg p-1 transition-colors hover:bg-accent has-[[data-automation-actions]:focus-visible]:bg-transparent has-[[data-automation-actions]:hover]:bg-transparent">
				<button
					type="button"
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-1 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => onOpenAutomation(automation)}
				>
					<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
						{automation.isPaused ? (
							<Pause className="size-4" />
						) : (
							<Clock className="size-4" />
						)}
					</div>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">
							{automation.title}
						</div>
						<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
							<span className="truncate">{authorName}</span>
							<span aria-hidden="true">·</span>
							<span className="truncate">
								{getAutomationSchedulePeriodLabel(automation)}
							</span>
						</div>
					</div>
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							data-automation-actions
							className="flex aspect-square size-5 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 outline-hidden transition-[color,opacity] group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 data-[state=open]:text-foreground"
							aria-label={`Open actions for ${automation.title}`}
						>
							<MoreHorizontal className="size-4" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => onEditAutomation(automation.id)}>
							<Pencil className="size-4" />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => onRunAutomationNow(automation.id)}
						>
							<Play className="size-4" />
							Run now
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => onToggleAutomationPaused(automation.id)}
						>
							<Pause className="size-4" />
							{automation.isPaused ? "Resume" : "Pause"}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => setConfirmDeleteOpen(true)}
						>
							<Trash2 className="size-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will delete your automation.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => onDeleteAutomation(automation.id)}
							className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
