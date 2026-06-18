import { getAvatarSrc } from "@/lib/avatar";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type CommentViewer = {
	name: string;
	email: string;
	avatar: string;
};

export type CommentTreeNode<TComment> = {
	comment: TComment;
	children: Array<CommentTreeNode<TComment>>;
};

export type FlattenedThreadComment<TComment> = {
	comment: TComment;
	depth: number;
};

export type ThreadView = "all" | "open" | "resolved";

export type CommentsUiState = {
	view: ThreadView;
	draftBody: string;
	replyBody: string;
	editBody: string;
	expandedThreadId: Id<"noteCommentThreads"> | null;
	editingThreadId: Id<"noteCommentThreads"> | null;
	editingCommentId: Id<"noteComments"> | null;
	threadActionsOpenId: Id<"noteCommentThreads"> | null;
	commentActionsOpenId: Id<"noteComments"> | null;
	filtersOpen: boolean;
};

export const THREAD_VIEW_OPTIONS: Array<{
	value: ThreadView;
	label: string;
}> = [
	{ value: "all", label: "All discussions" },
	{ value: "open", label: "Open discussions" },
	{ value: "resolved", label: "Resolved discussions" },
];

export const INITIAL_COMMENTS_UI_STATE: CommentsUiState = {
	view: "all",
	draftBody: "",
	replyBody: "",
	editBody: "",
	expandedThreadId: null,
	editingThreadId: null,
	editingCommentId: null,
	threadActionsOpenId: null,
	commentActionsOpenId: null,
	filtersOpen: false,
};

type CommentTreeRecord = {
	_id: string;
	parentCommentId?: string | null;
};

export const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error && error.message.trim().length > 0
		? error.message.replace(/\.$/, "")
		: fallback;

export const commentsUiReducer = (
	state: CommentsUiState,
	patch: Partial<CommentsUiState>,
) => ({ ...state, ...patch });

export const getAvatarLabel = (name?: string | null) =>
	(name ?? "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("") || "?";

export const getDisplayName = (name?: string | null) => {
	const trimmed = name?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : "Unknown";
};

export const isUnknownAuthorName = (name?: string | null) => {
	const trimmed = name?.trim().toLowerCase();
	return !trimmed || trimmed === "unknown" || trimmed === "unknown user";
};

export const getNormalizedIdentity = (value?: string | null) =>
	value?.trim().toLowerCase() ?? "";

export const resolveAuthorIdentity = ({
	currentUser,
	name,
}: {
	name?: string | null;
	currentUser: CommentViewer;
}) => {
	const normalizedName = getNormalizedIdentity(name);
	const normalizedCurrentUserName = getNormalizedIdentity(currentUser.name);
	const normalizedCurrentUserEmail = getNormalizedIdentity(currentUser.email);

	if (
		isUnknownAuthorName(name) ||
		normalizedName === normalizedCurrentUserName ||
		normalizedName === normalizedCurrentUserEmail
	) {
		return {
			name: "You",
			avatarSrc: getAvatarSrc(currentUser),
		};
	}

	return {
		name: getDisplayName(name),
		avatarSrc: null,
	};
};

const commentTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const commentDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

export const isSameCalendarDay = (left: Date, right: Date) =>
	left.getFullYear() === right.getFullYear() &&
	left.getMonth() === right.getMonth() &&
	left.getDate() === right.getDate();

export const formatCommentTimestamp = (value: number, now = new Date()) => {
	const timestamp = new Date(value);

	return isSameCalendarDay(timestamp, now)
		? commentTimeFormatter.format(timestamp)
		: commentDateFormatter.format(timestamp);
};

export const formatDiscussionTitle = (
	authorName: string,
	latestCommentIsReply: boolean,
) => `${authorName} ${latestCommentIsReply ? "replied in" : "commented in"}`;

export const buildCommentTree = <TComment extends CommentTreeRecord>(
	comments: TComment[],
) => {
	const nodes = new Map<string, CommentTreeNode<TComment>>();
	const roots: Array<CommentTreeNode<TComment>> = [];

	for (const comment of comments) {
		nodes.set(String(comment._id), {
			comment,
			children: [],
		});
	}

	for (const comment of comments) {
		const node = nodes.get(String(comment._id));

		if (!node) {
			continue;
		}

		if (!comment.parentCommentId) {
			roots.push(node);
			continue;
		}

		const parent = nodes.get(String(comment.parentCommentId));

		if (!parent) {
			roots.push(node);
			continue;
		}

		parent.children.push(node);
	}

	return roots;
};

export const flattenCommentTree = <TComment>(
	nodes: Array<CommentTreeNode<TComment>>,
	depth = 0,
): Array<FlattenedThreadComment<TComment>> => {
	const flattened: Array<FlattenedThreadComment<TComment>> = [];

	for (const node of nodes) {
		flattened.push({
			comment: node.comment,
			depth,
		});
		flattened.push(...flattenCommentTree(node.children, depth + 1));
	}

	return flattened;
};
