import { describe, expect, it } from "vitest";
import {
	type AutomationNoteSource,
	areAutomationPromptMentionsEqual,
	filterAutomationNotes,
	filterAutomationTools,
	getInitialAutomationMentions,
	getPromptDocument,
	getPromptMentionsFromContent,
} from "@/components/automations/automation-prompt-mentions";
import type { AutomationDraft } from "@/components/automations/automation-types";
import type { AppSource } from "@/hooks/use-app-sources";
import type { Id } from "../../../convex/_generated/dataModel";

const noteId = (value: string) => value as Id<"notes">;

const noteSources: AutomationNoteSource[] = [
	{
		id: noteId("note-one"),
		title: "Launch plan",
		preview: "Roadmap and milestones",
	},
	{
		id: noteId("note-two"),
		title: "Support log",
		preview: "PostHog escalation notes",
	},
];

const appSources: AppSource[] = [
	{
		id: "app:notion",
		title: "Workspace docs",
		preview: "Knowledge base",
		provider: "notion",
	},
	{
		id: "app:posthog",
		title: "Product events",
		preview: "Funnels and retention",
		provider: "posthog",
	},
];

describe("automation prompt mentions", () => {
	it("filters notes only when the user has entered a query", () => {
		expect(filterAutomationNotes(noteSources, "   ")).toEqual([]);
		expect(filterAutomationNotes(noteSources, "roadmap")).toEqual([
			noteSources[0],
		]);
		expect(filterAutomationNotes(noteSources, "posthog")).toEqual([
			noteSources[1],
		]);
	});

	it("keeps all tools for an empty query and matches provider labels", () => {
		expect(filterAutomationTools(appSources, " ")).toEqual(appSources);
		expect(filterAutomationTools(appSources, "posthog")).toEqual([
			appSources[1],
		]);
		expect(filterAutomationTools(appSources, "knowledge")).toEqual([
			appSources[0],
		]);
	});

	it("builds a prompt document from valid mention ranges", () => {
		expect(
			getPromptDocument("Ask @Notion about @Launch plan", [
				{
					id: "app:notion",
					label: "Notion",
					type: "tool",
					provider: "notion",
					from: 4,
					to: 11,
				},
				{
					id: "note-one",
					label: "Launch plan",
					type: "note",
					from: 18,
					to: 30,
				},
			]),
		).toEqual({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "Ask " },
						{
							type: "mention",
							attrs: {
								id: "app:notion",
								label: "Notion",
								type: "tool",
								provider: "notion",
							},
						},
						{ type: "text", text: " about " },
						{
							type: "mention",
							attrs: {
								id: "note-one",
								label: "Launch plan",
								type: "note",
								provider: undefined,
							},
						},
					],
				},
			],
		});
	});

	it("ignores stale and overlapping mention ranges when building documents", () => {
		expect(
			getPromptDocument("@Notion @Launch", [
				{
					id: "stale",
					label: "PostHog",
					type: "tool",
					provider: "posthog",
					from: 0,
					to: 8,
				},
				{
					id: "app:notion",
					label: "Notion",
					type: "tool",
					provider: "notion",
					from: 0,
					to: 7,
				},
				{
					id: "overlap",
					label: "Launch",
					type: "note",
					from: 6,
					to: 14,
				},
			]),
		).toEqual({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "mention",
							attrs: {
								id: "app:notion",
								label: "Notion",
								type: "tool",
								provider: "notion",
							},
						},
						{ type: "text", text: " @Launch" },
					],
				},
			],
		});
	});

	it("extracts mentions from editor JSON content using plain-text offsets", () => {
		expect(
			getPromptMentionsFromContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "text", text: "Read " },
							{
								type: "mention",
								attrs: {
									id: "app:posthog",
									label: "PostHog",
									type: "tool",
									provider: "posthog",
								},
							},
							{ type: "text", text: " then " },
							{
								type: "mention",
								attrs: {
									id: "note-one",
									label: "Launch",
								},
							},
						],
					},
				],
			}),
		).toEqual([
			{
				id: "app:posthog",
				label: "PostHog",
				from: 5,
				to: 13,
				type: "tool",
				provider: "posthog",
			},
			{
				id: "note-one",
				label: "Launch",
				from: 19,
				to: 26,
				type: "note",
				provider: undefined,
			},
		]);
	});

	it("counts paragraph separators when extracting mention offsets", () => {
		expect(
			getPromptMentionsFromContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "First line" }],
					},
					{
						type: "paragraph",
						content: [
							{ type: "text", text: "Ask " },
							{
								type: "mention",
								attrs: {
									id: "app:posthog",
									label: "PostHog",
									type: "tool",
									provider: "posthog",
								},
							},
						],
					},
				],
			}),
		).toEqual([
			{
				id: "app:posthog",
				label: "PostHog",
				from: 15,
				to: 23,
				type: "tool",
				provider: "posthog",
			},
		]);
	});

	it("hydrates initial prompt mentions from an automation draft", () => {
		const automation: AutomationDraft = {
			title: "Weekly review",
			prompt: "Summarize @PostHog and @Launch. Then compare @PostHog again.",
			model: "gpt-5",
			reasoningEffort: "medium",
			appSources: [
				{
					id: "app:posthog",
					label: "PostHog",
					provider: "posthog",
				},
			],
			webSearchEnabled: false,
			appsEnabled: true,
			schedulePeriod: "weekly",
			scheduledAt: 0,
			timezone: "UTC",
			target: {
				kind: "notes",
				label: "Launch",
				noteIds: [noteId("note-one")],
			},
		};

		expect(getInitialAutomationMentions({ automation })).toEqual([
			{
				id: "app:posthog",
				label: "PostHog",
				type: "tool",
				provider: "posthog",
				from: 10,
				to: 18,
			},
			{
				id: "note-one",
				label: "Launch",
				type: "note",
				from: 23,
				to: 30,
			},
		]);
	});

	it("compares prompt mention arrays by ordered mention identity and range", () => {
		const mentions = [
			{
				id: "app:notion",
				label: "Notion",
				type: "tool" as const,
				provider: "notion" as const,
				from: 0,
				to: 7,
			},
		];

		expect(areAutomationPromptMentionsEqual(mentions, [...mentions])).toBe(
			true,
		);
		expect(
			areAutomationPromptMentionsEqual(mentions, [
				{
					...mentions[0],
					to: 8,
				},
			]),
		).toBe(false);
	});
});
