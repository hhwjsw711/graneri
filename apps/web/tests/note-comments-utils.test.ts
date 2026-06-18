import { describe, expect, it } from "vitest";
import {
	buildCommentTree,
	commentsUiReducer,
	flattenCommentTree,
	formatDiscussionTitle,
	getAvatarLabel,
	getDisplayName,
	getErrorMessage,
	INITIAL_COMMENTS_UI_STATE,
	resolveAuthorIdentity,
	THREAD_VIEW_OPTIONS,
} from "@/components/note/note-comments-utils";

type TestComment = {
	_id: string;
	parentCommentId?: string | null;
	body: string;
};

const currentUser = {
	name: "Ada Lovelace",
	email: "ada@example.com",
	avatar: "https://example.com/avatar.png",
};

describe("note comments utilities", () => {
	it("formats author labels and display names", () => {
		expect(getAvatarLabel("Ada Lovelace")).toBe("AL");
		expect(getAvatarLabel(" single ")).toBe("S");
		expect(getAvatarLabel("")).toBe("?");
		expect(getDisplayName("  Grace  ")).toBe("Grace");
		expect(getDisplayName("   ")).toBe("Unknown");
	});

	it("resolves current user and unknown authors to You", () => {
		expect(
			resolveAuthorIdentity({
				name: "ADA@EXAMPLE.COM",
				currentUser,
			}),
		).toEqual({
			name: "You",
			avatarSrc: currentUser.avatar,
		});

		expect(
			resolveAuthorIdentity({
				name: "Unknown user",
				currentUser,
			}),
		).toEqual({
			name: "You",
			avatarSrc: currentUser.avatar,
		});

		expect(
			resolveAuthorIdentity({
				name: "Grace Hopper",
				currentUser,
			}),
		).toEqual({
			name: "Grace Hopper",
			avatarSrc: null,
		});
	});

	it("formats discussion titles", () => {
		expect(formatDiscussionTitle("Ada", false)).toBe("Ada commented in");
		expect(formatDiscussionTitle("Ada", true)).toBe("Ada replied in");
	});

	it("normalizes thrown error messages for comment actions", () => {
		expect(getErrorMessage(new Error("Failed to reply."), "Fallback")).toBe(
			"Failed to reply",
		);
		expect(getErrorMessage(new Error("  "), "Fallback")).toBe("Fallback");
		expect(getErrorMessage("unknown", "Fallback")).toBe("Fallback");
	});

	it("defines comment thread filter options in display order", () => {
		expect(THREAD_VIEW_OPTIONS).toEqual([
			{ value: "all", label: "All discussions" },
			{ value: "open", label: "Open discussions" },
			{ value: "resolved", label: "Resolved discussions" },
		]);
	});

	it("patches comments UI state without resetting unrelated fields", () => {
		expect(
			commentsUiReducer(INITIAL_COMMENTS_UI_STATE, {
				draftBody: "Looks good",
				filtersOpen: true,
				view: "open",
			}),
		).toEqual({
			...INITIAL_COMMENTS_UI_STATE,
			draftBody: "Looks good",
			filtersOpen: true,
			view: "open",
		});
	});

	it("builds and flattens comment trees while preserving orphan replies", () => {
		const comments: TestComment[] = [
			{ _id: "root", parentCommentId: null, body: "root" },
			{ _id: "reply", parentCommentId: "root", body: "reply" },
			{ _id: "nested", parentCommentId: "reply", body: "nested" },
			{ _id: "orphan", parentCommentId: "missing", body: "orphan" },
		];

		const flattened = flattenCommentTree(buildCommentTree(comments));

		expect(flattened.map((item) => [item.comment._id, item.depth])).toEqual([
			["root", 0],
			["reply", 1],
			["nested", 2],
			["orphan", 0],
		]);
	});
});
