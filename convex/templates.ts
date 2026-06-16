import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const templateSectionValidator = v.object({
	id: v.string(),
	title: v.string(),
	prompt: v.string(),
});

const templateFields = {
	_id: v.id("templates"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	slug: v.string(),
	name: v.string(),
	meetingContext: v.string(),
	sections: v.array(templateSectionValidator),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const templateDocumentValidator = v.object(templateFields);

const templatePayloadValidator = v.object({
	slug: v.string(),
	name: v.string(),
	meetingContext: v.string(),
	sections: v.array(templateSectionValidator),
});

const REMOVE_ALL_TEMPLATES_BATCH_SIZE = 50;
const MAX_TEMPLATES = 20;
const MAX_SECTIONS_PER_TEMPLATE = 12;

const defaultTemplates = [
	{
		slug: "one-to-one",
		name: "1 to 1",
		meetingContext:
			"I am having a 1:1 meeting with someone in my team, please capture these meeting notes in a concise and actionable format. Focus on immediate priorities, progress, challenges, and personal feedback, ensuring the notes are structured for clarity, efficiency and easy follow-up.",
		sections: [
			{
				id: "top-of-mind",
				title: "Top of mind",
				prompt:
					"What's the most pressing issue or priority? Capture the top concerns or focus areas that need immediate attention.",
			},
			{
				id: "updates-and-wins",
				title: "Updates and wins",
				prompt:
					"Highlight recent achievements and progress. What's going well? Document key updates that show momentum.",
			},
			{
				id: "challenges-and-blockers",
				title: "Challenges and blockers",
				prompt:
					"What obstacles are in the way? Note any blockers that are slowing progress.",
			},
			{
				id: "mutual-feedback",
				title: "Mutual feedback",
				prompt:
					"Did they give me any feedback on what I could do differently? Is there anything I should change about our team to make us more successful? Did I share any feedback for them? List it all here.",
			},
			{
				id: "next-milestone",
				title: "Next milestone",
				prompt:
					"Define clear action items and next steps. Who's doing what by when? Ensure accountability and follow-up.",
			},
		],
	},
	{
		slug: "stand-up",
		name: "Stand-up",
		meetingContext:
			"I attended a daily standup meeting. The goal is to document each participant's updates regarding their recent accomplishments, current focus, and any blockers they are facing. Keep these notes short and to-the-point.",
		sections: [
			{
				id: "announcements",
				title: "Announcements",
				prompt:
					"Include any note-worthy points from the small-talk or announcements at the beginning of the call.",
			},
			{
				id: "updates",
				title: "Updates",
				prompt:
					"Break these down into what was achieved yesterday, or accomplishments, what each person is working on today and highlight any blockers that could impact progress.",
			},
			{
				id: "sidebar",
				title: "Sidebar",
				prompt:
					"Summarize any further discussions or issues that were explored after the main updates. Note any collaborative efforts, decisions made, or additional points raised.",
			},
			{
				id: "action-items",
				title: "Action Items",
				prompt:
					"Document and assign next steps from the meeting, summarize immediate tasks, provide reminders, and ensure accountability and clarity on responsibilities.",
			},
		],
	},
	{
		slug: "weekly-team-meeting",
		name: "Weekly team meeting",
		meetingContext:
			"I met with my team to assess our project's health and align our efforts. My aim was to gain a clear understanding of our progress, address any emerging challenges, and ensure each team member is clear on their role in advancing our goals",
		sections: [
			{
				id: "announcements",
				title: "Announcements",
				prompt:
					"Note here any significant announcements made, whether they relate to professional and company-wide updates, or important events in the personal lives of my colleagues.",
			},
			{
				id: "review-of-progress",
				title: "Review of Progress",
				prompt:
					"Capture the discussion on the team's progress towards the overall strategic goals.",
			},
			{
				id: "key-achievements",
				title: "Key Achievements",
				prompt:
					"Summarize the notable achievements and results shared by team members, highlighting significant successes or completed tasks from the past week.",
			},
			{
				id: "challenges-and-adjustments-needed",
				title: "Challenges and Adjustments Needed",
				prompt:
					"Document any challenges the team is facing, including obstacles that have arisen. Note any adjustments or changes in strategy that were discussed to overcome these challenges.",
			},
			{
				id: "action-items-and-accountability",
				title: "Action Items and Accountability for the Week Ahead",
				prompt:
					"Record the action items assigned for the upcoming week, including who is responsible for each task and any deadlines or accountability measures that were agreed upon.",
			},
		],
	},
] as const satisfies ReadonlyArray<{
	slug: string;
	name: string;
	meetingContext: string;
	sections: ReadonlyArray<{
		id: string;
		title: string;
		prompt: string;
	}>;
}>;

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access templates.",
		});
	}

	return identity;
};

const requireOwnedWorkspace = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const workspace = await ctx.db.get(workspaceId);

	if (!workspace || workspace.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "WORKSPACE_NOT_FOUND",
			message: "Workspace not found.",
		});
	}
};

const normalizeWhitespace = (value: string) => value.trim();

const normalizeTemplatePayload = (
	template:
		| (typeof defaultTemplates)[number]
		| {
				slug: string;
				name: string;
				meetingContext: string;
				sections: Array<{ id: string; title: string; prompt: string }>;
		  },
) => ({
	slug: template.slug,
	name: normalizeWhitespace(template.name),
	meetingContext: normalizeWhitespace(template.meetingContext),
	sections: template.sections
		.slice(0, MAX_SECTIONS_PER_TEMPLATE)
		.map((section) => ({
			id: normalizeWhitespace(section.id),
			title: normalizeWhitespace(section.title),
			prompt: normalizeWhitespace(section.prompt),
		})),
});

export const seedDefaultTemplatesForWorkspace = async ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
	now,
}: {
	ctx: MutationCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
	now: number;
}) => {
	await Promise.all(
		defaultTemplates.map((template) => {
			const normalizedTemplate = normalizeTemplatePayload(template);

			return ctx.db.insert("templates", {
				ownerTokenIdentifier,
				workspaceId,
				slug: normalizedTemplate.slug,
				name: normalizedTemplate.name,
				meetingContext: normalizedTemplate.meetingContext,
				sections: normalizedTemplate.sections,
				createdAt: now,
				updatedAt: now,
			});
		}),
	);
};

const deleteTemplateBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const templates = await ctx.db
		.query("templates")
		.withIndex("by_ownerTokenIdentifier_and_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_TEMPLATES_BATCH_SIZE);

	await Promise.all(templates.map((template) => ctx.db.delete(template._id)));

	return {
		deletedCount: templates.length,
		hasMore: templates.length === REMOVE_ALL_TEMPLATES_BATCH_SIZE,
	};
};

const deleteTemplateBatchForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const templates = await ctx.db
		.query("templates")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(REMOVE_ALL_TEMPLATES_BATCH_SIZE);

	await Promise.all(templates.map((template) => ctx.db.delete(template._id)));

	return {
		deletedCount: templates.length,
		hasMore: templates.length === REMOVE_ALL_TEMPLATES_BATCH_SIZE,
	};
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(templatePayloadValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const templates = await ctx.db
			.query("templates")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", identity.tokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(MAX_TEMPLATES);

		return templates.map((template) =>
			normalizeTemplatePayload({
				slug: template.slug,
				name: template.name,
				meetingContext: template.meetingContext,
				sections: template.sections,
			}),
		);
	},
});

export const saveAll = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		templates: v.array(templatePayloadValidator),
	},
	returns: v.array(templatePayloadValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const nextTemplates = args.templates
			.slice(0, MAX_TEMPLATES)
			.map(normalizeTemplatePayload);

		const seenSlugs = new Set<string>();
		for (const template of nextTemplates) {
			if (!template.slug) {
				throw new ConvexError({
					code: "INVALID_TEMPLATE",
					message: "Template slug is required.",
				});
			}

			if (!template.name) {
				throw new ConvexError({
					code: "INVALID_TEMPLATE",
					message: "Template name is required.",
				});
			}

			for (const section of template.sections) {
				if (!section.id) {
					throw new ConvexError({
						code: "INVALID_TEMPLATE_SECTION",
						message: "Template section id is required.",
					});
				}
			}

			if (seenSlugs.has(template.slug)) {
				throw new ConvexError({
					code: "DUPLICATE_TEMPLATE",
					message: "Template slugs must be unique.",
				});
			}
			seenSlugs.add(template.slug);
		}

		const existingTemplates = await ctx.db
			.query("templates")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.take(MAX_TEMPLATES);

		await Promise.all(
			existingTemplates.map((template) => ctx.db.delete(template._id)),
		);

		const now = Date.now();
		for (const template of nextTemplates) {
			await ctx.db.insert("templates", {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				slug: template.slug,
				name: template.name,
				meetingContext: template.meetingContext,
				sections: template.sections,
				createdAt: now,
				updatedAt: now,
			});
		}

		return nextTemplates;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteTemplateBatch(ctx, args.ownerTokenIdentifier);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.templates.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteTemplateBatchForWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.templates.removeAllForWorkspace,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
				},
			);
		}

		return null;
	},
});

export const templateValidator = templateDocumentValidator;
