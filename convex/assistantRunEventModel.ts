import { v } from "convex/values";

export const assistantRunEventValidator = v.union(
	v.object({
		type: v.literal("run.started"),
		assistantMessageId: v.string(),
		model: v.string(),
		reasoningEffort: v.optional(
			v.union(
				v.literal("low"),
				v.literal("medium"),
				v.literal("high"),
				v.literal("xhigh"),
			),
		),
	}),
	v.object({
		type: v.literal("message.completed"),
		assistantMessageId: v.string(),
	}),
	v.object({
		type: v.literal("tool.started"),
		toolCallId: v.string(),
		toolName: v.string(),
	}),
	v.object({
		type: v.literal("tool.completed"),
		toolCallId: v.string(),
		status: v.union(
			v.literal("completed"),
			v.literal("failed"),
			v.literal("denied"),
		),
	}),
	v.object({
		type: v.literal("input.requested"),
		decisionType: v.union(
			v.literal("choose_workspace"),
			v.literal("choose_note"),
			v.literal("authorize_source"),
			v.literal("clarify_scope"),
		),
	}),
	v.object({
		type: v.literal("run.completed"),
	}),
	v.object({
		type: v.literal("run.failed"),
		errorText: v.optional(v.string()),
	}),
	v.object({
		type: v.literal("run.stopped"),
		stopReason: v.optional(
			v.union(
				v.literal("user_requested"),
				v.literal("superseded"),
				v.literal("cleanup_failed"),
			),
		),
	}),
);
